import * as fs from 'node:fs';
import * as path from 'node:path';
import { COORDINATOR_TOOLS } from '../core/coordinator.ts';
import { runVerification, summarizeVerification, verificationCommands } from '../core/test-runner.ts';
import { commitWorktree, mergeBranch, worktreeFileDiffs } from './worktree-git.ts';
import type {
  CoordinatorBridge,
  DelegateRequest,
  MergeReport,
  MergeRequest,
  VerifyReport,
  VerifyRequest,
  WorkerHandle,
  WorkerReport,
} from '../core/types.ts';
import type { WorktreeRegistry, WorktreeRecord } from './worktrees.ts';

export interface CoordinatorBridgeOptions {
  /** Only used when `resolveWorkspace` is absent. */
  workspace?: string;
  /** Preferred over `workspace` so a project switch mid-run is picked up. */
  resolveWorkspace?: () => string;
  worktrees: WorktreeRegistry;
  /** Runs one agent in a worktree and resolves when it finishes. */
  startWorker: (request: DelegateRequest & { worktreeId: string }) => { runId: string; finished: Promise<void> };
  /** Current snapshot of a run, used to report worker state. */
  inspectRun: (runId: string) => { status: WorkerHandle['status']; detail: string; startedAt: number; completedAt?: number } | undefined;
  /** Final assistant text of a run, used as the worker report. */
  readRunSummary: (runId: string) => string;
  onEvent?: (event: unknown) => void;
}

interface TrackedWorker extends WorkerHandle {
  runId: string;
}

/**
 * The coordinator's view of the orchestrator.
 *
 * This is the only place that knows how to turn "the model asked for a subtask"
 * into a worktree plus a running agent, and how to turn the result back into
 * something the model can judge. Keeping it behind an interface means the
 * coordinator tools stay testable and the agent loop stays ignorant of git.
 */
export class CoordinatorService implements CoordinatorBridge {
  private readonly options: CoordinatorBridgeOptions;
  private readonly workers = new Map<string, TrackedWorker>();
  /** Active workspace, read per call so switching projects mid-run is safe. */
  private readonly workspace: () => string;

  constructor(options: CoordinatorBridgeOptions) {
    this.options = options;
    const fallback = options.workspace;
    this.workspace = options.resolveWorkspace ?? (() => fallback ?? '');
  }

  private get currentWorkspace(): string {
    const resolved = this.workspace();
    if (resolved) return resolved;
    throw new Error('No workspace is selected, so there is nothing to coordinate.');
  }

  listWorkers(): WorkerHandle[] {
    return [...this.workers.values()].map(worker => this.snapshot(worker));
  }

  private snapshot(worker: TrackedWorker): WorkerHandle {
    const live = this.options.inspectRun(worker.runId);
    const { runId, ...handle } = worker;
    void runId;
    return {
      ...handle,
      status: live?.status ?? worker.status,
      detail: live?.detail ?? worker.detail,
      startedAt: live?.startedAt ?? worker.startedAt,
      completedAt: live?.completedAt ?? worker.completedAt,
      durationMs: (live?.completedAt ?? worker.completedAt ?? Date.now()) - (live?.startedAt ?? worker.startedAt),
    };
  }

  async delegate(request: DelegateRequest): Promise<WorkerHandle> {
    if (!request.title?.trim()) throw new Error('A subtask needs a title');
    if (!request.prompt?.trim()) throw new Error('A subtask needs instructions');
    if (request.engine === 'cli' && !request.cliAgentId) {
      throw new Error('engine "cli" needs a cliAgentId; use engine "alisa" if no external CLI is available');
    }

    let worktree: WorktreeRecord;
    if (request.reuseWorktreeId) {
      const resolved = await this.options.worktrees.resolvePath(this.currentWorkspace, request.reuseWorktreeId);
      await this.options.worktrees.update(resolved.meta.id, {
        prompt: request.prompt,
        engine: request.engine,
        cliAgentId: request.cliAgentId,
      });
      worktree = { ...resolved.meta, status: await this.statusOf(resolved.meta.path, resolved.meta.baseRef), orphaned: false };
    } else {
      worktree = await this.options.worktrees.create({
        workspace: this.currentWorkspace,
        title: request.title,
        prompt: request.prompt,
        engine: request.engine,
        cliAgentId: request.cliAgentId,
      });
    }

    const started = this.options.startWorker({
      ...request,
      worktreeId: worktree.id,
    });

    const worker: TrackedWorker = {
      id: started.runId,
      runId: started.runId,
      worktreeId: worktree.id,
      title: worktree.title,
      engine: request.engine,
      cliAgentId: request.cliAgentId,
      branch: worktree.branch,
      status: 'running',
      detail: 'Starting task',
      startedAt: Date.now(),
      changedFiles: 0,
      additions: 0,
      deletions: 0,
    };
    this.workers.set(worker.id, worker);

    // Refresh the file counters as the worker progresses so `check_workers`
    // shows something useful even before it finishes.
    const poll = setInterval(() => { void this.refresh(worker); }, 2000);
    poll.unref?.();
    void started.finished
      .catch(() => undefined)
      .then(async () => {
        clearInterval(poll);
        await this.refresh(worker, true);
      });

    this.options.onEvent?.({ type: 'coordinator_worker_started', worker: this.snapshot(worker) });
    return this.snapshot(worker);
  }

  getWorker(id: string): WorkerHandle | undefined {
    const worker = this.workers.get(id);
    return worker ? this.snapshot(worker) : undefined;
  }

  async collectWorker(id: string): Promise<WorkerReport> {
    const worker = this.workers.get(id);
    if (!worker) throw new Error(`Unknown worker: ${id}`);
    const live = this.snapshot(worker);
    const changedFiles = await this.changedFiles(worker.worktreeId);
    return {
      id,
      title: worker.title,
      status: live.status,
      detail: live.detail,
      branch: worker.branch,
      summary: this.options.readRunSummary(worker.runId).trim() || live.detail,
      changedFiles,
    };
  }

  async mergeWorker(request: MergeRequest): Promise<MergeReport> {
    const { meta } = await this.options.worktrees.resolvePath(this.currentWorkspace, request.id);

    if (request.commitMessage) {
      // Only stage what actually exists; committing nothing is not an error the
      // coordinator should have to interpret.
      await commitWorktree({ worktreePath: meta.path, message: request.commitMessage });
    }

    const info = await this.options.worktrees.repoInfo(this.currentWorkspace);
    if (!info.repoRoot) throw new Error('Git worktrees are not available for this workspace');
    const result = await mergeBranch({
      repoRoot: info.repoRoot,
      mainWorktreePath: info.repoRoot,
      branch: meta.branch,
      message: request.message,
    });
    this.options.onEvent?.({ type: 'coordinator_worker_merged', workerId: request.id, result });
    return { ...result, branch: meta.branch };
  }

  async removeWorker(id: string, deleteBranch: boolean): Promise<void> {
    const worker = this.workers.get(id);
    await this.options.worktrees.remove({ workspace: this.currentWorkspace, id, deleteBranch });
    if (worker) this.workers.delete(id);
    this.options.onEvent?.({ type: 'coordinator_worker_discarded', workerId: id });
  }

  /**
   * Run the project's own checks.
   *
   * Defaults to the main workspace so a coordinator verifies the merged result,
   * and accepts a worktree id to check one worker before merging it.
   */
  async verify(request: VerifyRequest): Promise<VerifyReport> {
    const cwd = request.worktreeId
      ? (await this.options.worktrees.resolvePath(this.currentWorkspace, request.worktreeId)).meta.path
      : this.currentWorkspace;

    const scripts = readPackageScripts(cwd);
    const commands = verificationCommands(scripts, request.includeBuild === true);
    const checks: VerifyReport['checks'] = [];
    const failures: string[] = [];

    for (const command of commands) {
      const result = await runVerification(command.kind, { cwd, timeoutMs: request.timeoutMs }, command);
      const summary = summarizeVerification(result);
      checks.push({ kind: command.kind, passed: result.passed, summary });
      if (!result.passed) {
        for (const failure of result.failures) failures.push(`${command.kind}: ${failure.name}`);
        for (const line of summary.split('\n')) {
          if (/error TS\d+|Timed out|could not run|FAILED/.test(line)) failures.push(`${command.kind}: ${line.trim()}`);
        }
      }
      this.options.onEvent?.({ type: 'coordinator_verification', kind: command.kind, passed: result.passed, summary });
      // Tests failing already invalidates the change; a typecheck on top of that
      // would only repeat the same news and burn minutes.
      if (!result.passed && command.kind === 'test') break;
    }

    const passed = checks.every(check => check.passed);
    return {
      worktreeId: request.worktreeId ?? 'main',
      passed,
      checks,
      overall: checks.map(check => `${check.kind}: ${check.passed ? 'PASSED' : 'FAILED'}${check.passed ? '' : `\n${check.summary}`}`).join('\n'),
      failures: [...new Set(failures)],
    };
  }

  stopAll(): number {
    let count = 0;
    for (const worker of this.workers.values()) {
      if (worker.status === 'running') count += 1;
    }
    return count;
  }

  private async refresh(worker: TrackedWorker, final = false): Promise<void> {
    const live = this.options.inspectRun(worker.runId);
    if (live) {
      worker.status = live.status;
      worker.detail = live.detail;
      worker.completedAt = live.completedAt ?? worker.completedAt;
    }
    if (final && worker.status === 'running') worker.status = 'cancelled';
    try {
      const files = await this.changedFiles(worker.worktreeId);
      worker.changedFiles = files.length;
    } catch {
      // The worktree may already be gone; the counters simply stay as they were.
    }
    this.options.onEvent?.({ type: 'coordinator_worker_updated', worker: this.snapshot(worker) });
  }

  private async changedFiles(worktreeId: string): Promise<string[]> {
    try {
      const { meta } = await this.options.worktrees.resolvePath(this.currentWorkspace, worktreeId);
      const files = await worktreeFileDiffs({ worktreePath: meta.path, baseRef: meta.baseRef, maxBytes: 200_000 });
      return files.map(file => file.path);
    } catch {
      return [];
    }
  }

  private async statusOf(worktreePath: string, baseRef: string): Promise<WorktreeRecord['status']> {
    const { worktreeStatus } = await import('./worktree-git.ts');
    return worktreeStatus(worktreePath, baseRef);
  }
}

/** Read `scripts` from package.json so renamed scripts are still found. */
export function readPackageScripts(cwd: string): Record<string, string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    return parsed.scripts ?? {};
  } catch {
    return {};
  }
}

/** Registry holding only the coordination tools, kept separate from worker tools. */
export function createCoordinatorRegistry(baseRegistry: { getAll: () => Array<{ name: string }> }) {
  const names = new Set(baseRegistry.getAll().map(tool => tool.name));
  return COORDINATOR_TOOLS.filter(tool => !names.has(tool.name));
}