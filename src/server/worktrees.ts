import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  assertWorktreeRootOutsideRepo,
  defaultWorktreeRoot,
  resolveInsideRoot,
  slugifyTitle,
  validateBranchName,
  validateRefName,
  worktreeBranchName,
} from '../core/worktree.ts';
import { AtomicJsonStore } from './config-store.ts';
import {
  branchExists,
  createWorktree,
  currentBranch,
  defaultBaseRef,
  listBranches,
  deleteBranch,
  listWorktreeEntries,
  pruneWorktrees,
  refExists,
  removeWorktree,
  worktreeStatus,
  type WorktreeGitEntry,
  type WorktreeStatus,
} from './worktree-git.ts';

export type WorktreeEngine = 'alisa' | 'cli';

export interface WorktreeMeta {
  id: string;
  title: string;
  prompt: string;
  path: string;
  branch: string;
  baseRef: string;
  engine: WorktreeEngine;
  cliAgentId?: string;
  sessionId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorktreeRecord extends WorktreeMeta {
  status: WorktreeStatus;
  /** Registered by Alisa but no longer listed by git (deleted by hand). */
  orphaned: boolean;
}

export interface WorktreeRepoInfo {
  repoRoot: string | null;
  worktreeRoot: string | null;
  baseRef: string | null;
  branches: string[];
  available: boolean;
  reason?: string;
}

interface WorktreeStoreShape {
  version: number;
  worktrees: WorktreeMeta[];
}

const MAX_TITLE_LENGTH = 200;
const MAX_PROMPT_LENGTH = 20_000;
const MAX_TRACKED_WORKTREES = 24;

export class WorktreeRegistry {
  private readonly store: AtomicJsonStore<WorktreeStoreShape>;
  private cache: WorktreeMeta[];

  constructor(options: { runtimeDir: string; worktreeRootOverride?: string }) {
    this.store = new AtomicJsonStore<WorktreeStoreShape>(
      path.join(path.resolve(options.runtimeDir), '.alisa-worktrees.json'),
      { backupCount: 2 },
    );
    this.worktreeRootOverride = options.worktreeRootOverride;
    const read = this.store.read();
    this.cache = normalizeWorktreeList(read.value?.worktrees);
  }

  private readonly worktreeRootOverride?: string;

  /**
   * Persisted metadata is the only trustworthy mapping from a UI id to a real
   * directory. Everything the client sends back is re-validated against git's
   * own worktree list before use.
   */
  private load(): WorktreeMeta[] {
    return this.cache;
  }

  private persist(worktrees: WorktreeMeta[]) {
    this.cache = normalizeWorktreeList(worktrees);
    this.store.write({ version: 1, worktrees: this.cache });
  }

  private upsert(meta: WorktreeMeta) {
    const worktrees = this.load();
    const index = worktrees.findIndex(entry => entry.id === meta.id);
    if (index >= 0) worktrees[index] = meta;
    else worktrees.push(meta);
    this.persist(worktrees);
  }

  async repoInfo(workspace: string): Promise<WorktreeRepoInfo> {
    const entries = await listWorktreeEntries(workspace).catch(() => null);
    if (!entries?.length) {
      return {
        repoRoot: null,
        worktreeRoot: null,
        baseRef: null,
        branches: [],
        available: false,
        reason: 'The active workspace is not a Git repository with at least one commit.',
      };
    }
    const main = entries.find(entry => !entry.bare) ?? entries[0];
    const branches = await listBranches(workspace).catch(() => [] as string[]);
    let baseRef: string | null = null;
    let worktreeRoot: string | null = null;
    let reason: string | undefined;
    try {
      baseRef = await defaultBaseRef(main.path);
      worktreeRoot = assertWorktreeRootOutsideRepo(
        main.path,
        defaultWorktreeRoot(main.path, this.worktreeRootOverride),
      );
    } catch (error) {
      reason = error instanceof Error ? error.message : 'Worktrees are not available for this repository.';
    }
    return { repoRoot: main.path, worktreeRoot, baseRef, branches, available: Boolean(worktreeRoot), reason };
  }

  async list(workspace: string): Promise<WorktreeRecord[]> {
    const info = await this.repoInfo(workspace);
    if (!info.repoRoot) return [];
    const entries = await listWorktreeEntries(info.repoRoot).catch(() => []);
    const registered = this.load();
    const records: WorktreeRecord[] = [];

    for (const meta of registered) {
      const entry = entries.find(candidate => samePath(candidate.path, meta.path));
      const status = entry && !entry.prunable
        ? await worktreeStatus(meta.path, meta.baseRef).catch(() => fallbackStatus(meta, entry))
        : orphanedStatus(meta, entry ?? null);
      records.push({ ...meta, status, orphaned: !entry || entry.prunable });
    }

    return records.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  get(id: string): WorktreeMeta | undefined {
    if (typeof id !== 'string' || !id.trim()) return undefined;
    return this.load().find(entry => entry.id === id);
  }

  /**
   * Resolve an id to a directory that git still agrees exists.
   *
   * The lookup goes through registered metadata and `git worktree list`, so a
   * crafted path from the client cannot reach an arbitrary directory.
   */
  async resolvePath(workspace: string, id: string): Promise<{ meta: WorktreeMeta; entry: WorktreeGitEntry }> {
    const meta = this.get(id);
    if (!meta) throw new Error('Unknown worktree');
    const info = await this.repoInfo(workspace);
    if (!info.repoRoot || !info.worktreeRoot) throw new Error('Git worktrees are not available for this workspace');
    // Defence in depth: the stored path must still sit inside the current root.
    let resolved: string;
    try {
      resolved = resolveInsideRoot(info.worktreeRoot, meta.path);
    } catch {
      throw new Error('Worktree path is outside the worktree root');
    }
    if (!samePath(resolved, meta.path)) throw new Error('Worktree path is outside the worktree root');
    const entries = await listWorktreeEntries(info.repoRoot);
    const entry = entries.find(candidate => !candidate.prunable && samePath(candidate.path, meta.path));
    if (!entry) throw new Error('Worktree is no longer registered with Git');
    if (!fs.existsSync(meta.path)) throw new Error('Worktree directory no longer exists');
    return { meta, entry };
  }

  async create(options: {
    workspace: string;
    title: string;
    prompt?: string;
    baseRef?: string;
    engine?: WorktreeEngine;
    cliAgentId?: string;
    sessionId?: string;
  }): Promise<WorktreeRecord> {
    const info = await this.repoInfo(options.workspace);
    if (!info.repoRoot || !info.worktreeRoot) {
      throw new Error(info.reason ?? 'Git worktrees are not available for this workspace');
    }
    const tracked = this.load();
    if (tracked.length >= MAX_TRACKED_WORKTREES) {
      throw new Error(`Only ${MAX_TRACKED_WORKTREES} worktrees can be tracked at once. Remove one first.`);
    }

    const title = options.title.trim().slice(0, MAX_TITLE_LENGTH);
    if (!title) throw new Error('Worktree title is required');
    const prompt = (options.prompt ?? '').slice(0, MAX_PROMPT_LENGTH);
    const baseRef = validateRefName(options.baseRef?.trim() || info.baseRef || 'HEAD');
    if (!(await refExists(info.repoRoot, baseRef))) throw new Error(`Base ref ${baseRef} does not exist`);

    const { branch, targetPath } = await this.allocateSlot(info.repoRoot, info.worktreeRoot, tracked, title);
    fs.mkdirSync(info.worktreeRoot, { recursive: true });
    const entry = await createWorktree({
      repoRoot: info.repoRoot,
      targetPath,
      branch,
      baseRef,
    });

    const meta: WorktreeMeta = {
      id: randomUUID(),
      title,
      prompt,
      path: path.resolve(targetPath),
      branch,
      baseRef,
      engine: options.engine === 'cli' ? 'cli' : 'alisa',
      cliAgentId: options.engine === 'cli' ? options.cliAgentId : undefined,
      sessionId: options.sessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.upsert(meta);
    const status = await worktreeStatus(meta.path, baseRef).catch(() => fallbackStatus(meta, entry));
    return { ...meta, status, orphaned: false };
  }

  async update(id: string, patch: Partial<Pick<WorktreeMeta, 'title' | 'prompt' | 'sessionId' | 'cliAgentId' | 'engine'>>): Promise<WorktreeMeta> {
    const existing = this.get(id);
    if (!existing) throw new Error('Unknown worktree');
    const next: WorktreeMeta = { ...existing, ...patch, updatedAt: Date.now() };
    if (patch.title !== undefined) {
      const title = patch.title.trim().slice(0, MAX_TITLE_LENGTH);
      if (!title) throw new Error('Worktree title is required');
      next.title = title;
    }
    if (patch.prompt !== undefined) next.prompt = patch.prompt.slice(0, MAX_PROMPT_LENGTH);
    this.upsert(next);
    return next;
  }

  async remove(options: { workspace: string; id: string; deleteBranch?: boolean }): Promise<{ removed: boolean; branchDeleted: boolean }> {
    const { meta } = await this.resolvePath(options.workspace, options.id);
    const info = await this.repoInfo(options.workspace);
    if (!info.repoRoot) throw new Error('Git worktrees are not available for this workspace');

    await removeWorktree({ repoRoot: info.repoRoot, worktreePath: meta.path, force: true });
    await pruneWorktrees(info.repoRoot).catch(() => undefined);

    let branchDeleted = false;
    if (options.deleteBranch && meta.branch.startsWith('alisa/')) {
      branchDeleted = await deleteBranch(info.repoRoot, meta.branch);
    }
    this.persist(this.load().filter(entry => entry.id !== options.id));
    return { removed: true, branchDeleted };
  }

  /**
   * Drop metadata for worktrees whose directory is gone so the dashboard does
   * not accumulate dead tiles forever.
   */
  async reconcile(workspace: string): Promise<{ dropped: number }> {
    const info = await this.repoInfo(workspace);
    if (!info.repoRoot) return { dropped: 0 };
    const entries = await listWorktreeEntries(info.repoRoot).catch(() => []);
    const kept = this.load().filter(meta => {
      const entry = entries.find(candidate => samePath(candidate.path, meta.path));
      if (entry && !entry.prunable) return true;
      // Keep the record when the directory still exists; it may be a worktree
      // git has not re-scanned yet.
      return fs.existsSync(meta.path);
    });
    const dropped = this.load().length - kept.length;
    if (dropped > 0) this.persist(kept);
    await pruneWorktrees(info.repoRoot).catch(() => undefined);
    return { dropped };
  }

  /** Find a free directory/branch pair derived from the task title. */
  private async allocateSlot(
    repoRoot: string,
    worktreeRoot: string,
    tracked: WorktreeMeta[],
    title: string,
  ): Promise<{ branch: string; targetPath: string }> {
    const baseSlug = slugifyTitle(title);
    const takenBranches = new Set(tracked.map(entry => entry.branch));
    const takenPaths = new Set(tracked.map(entry => path.resolve(entry.path)));

    for (let attempt = 1; attempt <= 50; attempt += 1) {
      const slug = attempt === 1 ? baseSlug : `${baseSlug}-${attempt}`;
      const branch = worktreeBranchName(slug);
      const targetPath = path.join(worktreeRoot, slug);
      if (takenPaths.has(path.resolve(targetPath))) continue;
      if (takenBranches.has(branch)) continue;
      if (await branchExists(repoRoot, branch)) continue;
      if (fs.existsSync(targetPath)) continue;
      return { branch, targetPath };
    }
    throw new Error('Could not allocate a free worktree name for this task');
  }
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function normalizeWorktreeList(value: unknown): WorktreeMeta[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: WorktreeMeta[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Partial<WorktreeMeta>;
    if (typeof candidate.id !== 'string' || !candidate.id) continue;
    if (typeof candidate.path !== 'string' || !candidate.path) continue;
    if (typeof candidate.branch !== 'string' || !candidate.branch) continue;
    if (seen.has(candidate.id)) continue;
    try {
      validateBranchName(candidate.branch);
    } catch {
      continue;
    }
    seen.add(candidate.id);
    result.push({
      id: candidate.id,
      title: typeof candidate.title === 'string' ? candidate.title : candidate.branch,
      prompt: typeof candidate.prompt === 'string' ? candidate.prompt : '',
      path: path.resolve(candidate.path),
      branch: candidate.branch,
      baseRef: typeof candidate.baseRef === 'string' && candidate.baseRef ? candidate.baseRef : 'HEAD',
      engine: candidate.engine === 'cli' ? 'cli' : 'alisa',
      cliAgentId: typeof candidate.cliAgentId === 'string' ? candidate.cliAgentId : undefined,
      sessionId: typeof candidate.sessionId === 'string' ? candidate.sessionId : undefined,
      createdAt: Number(candidate.createdAt) || Date.now(),
      updatedAt: Number(candidate.updatedAt) || Number(candidate.createdAt) || Date.now(),
    });
  }
  return result;
}

function fallbackStatus(meta: WorktreeMeta, entry: WorktreeGitEntry | null): WorktreeStatus {
  return {
    path: meta.path,
    branch: entry?.branch ?? meta.branch,
    head: entry?.head ?? null,
    files: [],
    dirtyCount: 0,
    stagedCount: 0,
    ahead: 0,
    behind: 0,
    lastCommit: null,
    missing: !fs.existsSync(meta.path),
  };
}

function orphanedStatus(meta: WorktreeMeta, entry: WorktreeGitEntry | null): WorktreeStatus {
  return {
    path: meta.path,
    branch: entry?.branch ?? meta.branch,
    head: entry?.head ?? null,
    files: [],
    dirtyCount: 0,
    stagedCount: 0,
    ahead: 0,
    behind: 0,
    lastCommit: null,
    missing: true,
  };
}

export { currentBranch };