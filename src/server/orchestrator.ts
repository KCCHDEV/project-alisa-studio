import { randomUUID } from 'node:crypto';
import type { AgentMode } from '../core/types.ts';

export type RunStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export type RunEngine = 'alisa' | 'cli';

export interface RunSnapshot {
  id: string;
  label: string;
  workspace: string;
  worktreeId?: string;
  cwd: string;
  engine: RunEngine;
  status: RunStatus;
  detail: string;
  model: string;
  mode: AgentMode;
  prompt: string;
  sessionId: string;
  swarm: boolean;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
}

export type RunListener = (event: OrchestratorEvent) => void;

export type OrchestratorEvent =
  | { type: 'orchestrator_snapshot'; runs: RunSnapshot[] }
  | { type: 'orchestrator_run_started'; run: RunSnapshot }
  | { type: 'orchestrator_run_updated'; run: RunSnapshot }
  | { type: 'orchestrator_run_finished'; run: RunSnapshot };

export interface StartRunOptions {
  workspace: string;
  cwd: string;
  sessionId: string;
  prompt: string;
  model: string;
  mode: AgentMode;
  engine: RunEngine;
  label?: string;
  worktreeId?: string;
  swarm?: boolean;
  /**
   * Legacy single-flight guard. The main workspace keeps one run at a time so
   * the existing `start_task` contract is unchanged, while each worktree gets
   * its own slot.
   */
  exclusiveWorkspace?: boolean;
  runner: (context: RunContext) => Promise<RunOutcome>;
}

export interface RunContext {
  runId: string;
  signal: AbortSignal;
  /** Publish a status/detail update for this run without finishing it. */
  update: (status: RunStatus, detail: string) => void;
}

export interface RunOutcome {
  status: RunStatus;
  detail: string;
}

export interface StartRunResult {
  run: RunSnapshot;
  finished: Promise<RunSnapshot>;
}

interface ActiveRun {
  snapshot: RunSnapshot;
  controller: AbortController;
  listeners: Set<RunListener>;
  promise: Promise<RunSnapshot>;
}

const DEFAULT_MAX_PARALLEL = 3;
const MAX_RECENT_RUNS = 50;

/**
 * Owns every agent run in the process.
 *
 * The previous design kept the task lifecycle inside a single WebSocket
 * closure, which capped the app at one agent at a time and killed progress on
 * reconnect. Runs are independent here and subscribers are attached per run, so
 * the dashboard can watch many agents at once and a UI reload does not interrupt
 * them.
 */
export class OrchestratorRegistry {
  private readonly runs = new Map<string, ActiveRun>();
  private readonly byWorkspace = new Map<string, Set<string>>();
  private readonly globalListeners = new Set<RunListener>();
  private readonly history: RunSnapshot[] = [];
  private readonly maxParallel: number;

  constructor(options: { maxParallel?: number } = {}) {
    this.maxParallel = Math.max(1, Math.floor(options.maxParallel ?? DEFAULT_MAX_PARALLEL));
  }

  get activeCount(): number {
    let count = 0;
    for (const run of this.runs.values()) if (run.snapshot.status === 'running' || run.snapshot.status === 'queued') count += 1;
    return count;
  }

  get capacity(): number {
    return this.maxParallel;
  }

  /** Runs that are still going, newest first. */
  active(): RunSnapshot[] {
    return [...this.runs.values()]
      .filter(run => run.snapshot.status === 'running' || run.snapshot.status === 'queued')
      .map(run => ({ ...run.snapshot }))
      .sort((left, right) => right.startedAt - left.startedAt);
  }

  recent(limit = MAX_RECENT_RUNS): RunSnapshot[] {
    return this.history.slice(0, limit).map(run => ({ ...run }));
  }

  has(runId: string): boolean {
    return this.runs.has(runId);
  }

  snapshot(runId: string): RunSnapshot | undefined {
    const run = this.runs.get(runId);
    return run ? { ...run.snapshot } : undefined;
  }

  isWorkspaceBusy(workspace: string): boolean {
    const ids = this.byWorkspace.get(workspace);
    if (!ids) return false;
    for (const id of ids) {
      const run = this.runs.get(id);
      if (run && (run.snapshot.status === 'running' || run.snapshot.status === 'queued')) return true;
    }
    return false;
  }

  /**
   * Start a run and return immediately with a snapshot plus a promise that
   * settles when the run finishes. Throws when the engine is saturated or the
   * exclusive workspace already has a run.
   */
  start(options: StartRunOptions): StartRunResult {
    if (this.activeCount >= this.maxParallel) {
      throw new Error(`All ${this.maxParallel} agent slots are busy. Wait for a run to finish or raise the limit.`);
    }
    if (options.exclusiveWorkspace && this.isWorkspaceBusy(options.workspace)) {
      throw new Error('A task is already running in this workspace');
    }

    const runId = randomUUID();
    const snapshot: RunSnapshot = {
      id: runId,
      label: options.label?.trim() || 'Main workspace',
      workspace: options.workspace,
      worktreeId: options.worktreeId,
      cwd: options.cwd,
      engine: options.engine,
      status: 'running',
      detail: 'Starting task',
      model: options.model,
      mode: options.mode,
      prompt: options.prompt,
      sessionId: options.sessionId,
      swarm: options.swarm === true,
      startedAt: Date.now(),
    };

    const controller = new AbortController();
    const listeners = new Set<RunListener>();
    const record: ActiveRun = {
      snapshot,
      controller,
      listeners,
      promise: Promise.resolve(snapshot),
    };
    this.runs.set(runId, record);
    this.trackWorkspace(options.workspace, runId);
    this.emit({ type: 'orchestrator_run_started', run: { ...snapshot } }, runId);

    const context: RunContext = {
      runId,
      signal: controller.signal,
      update: (status, detail) => {
        const current = this.runs.get(runId);
        if (!current || current.snapshot.status === 'done' || current.snapshot.status === 'error' || current.snapshot.status === 'cancelled') return;
        current.snapshot = { ...current.snapshot, status, detail };
        this.emit({ type: 'orchestrator_run_updated', run: { ...current.snapshot } }, runId);
      },
    };

    record.promise = (async () => {
      // `finish` releases the slot and removes the run, so the final snapshot
      // has to be captured here rather than read back from the map.
      let final: RunSnapshot = snapshot;
      try {
        const outcome = await options.runner(context);
        final = this.finish(runId, outcome.status, outcome.detail) ?? final;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        final = this.finish(runId, context.signal.aborted ? 'cancelled' : 'error', message) ?? final;
      }
      return { ...final };
    })();

    // Keep the handle reachable for callers that never await `finished`.
    record.promise.catch(() => undefined);

    return { run: { ...snapshot }, finished: record.promise };
  }

  /**
   * Attach a listener to one run, or to every run when no id is given.
   * Returns a detach function.
   */
  subscribe(listener: RunListener, runId?: string): () => void {
    if (runId) {
      const run = this.runs.get(runId);
      if (!run) return () => undefined;
      run.listeners.add(listener);
      return () => { run.listeners.delete(listener); };
    }
    return this.subscribeGlobal(listener);
  }

  /**
   * Listen to every run, including runs started after subscribing. The
   * dashboard uses this so it stays live without re-registering per task.
   */
  subscribeGlobal(listener: RunListener): () => void {
    this.globalListeners.add(listener);
    return () => { this.globalListeners.delete(listener); };
  }

  /** Subscribe globally and immediately receive the current list of runs. */
  attach(listener: RunListener, runIds: Iterable<string> = []): () => void {
    const detachByRun = [...runIds].map(runId => this.subscribe(listener, runId));
    const detachGlobal = this.subscribeGlobal(listener);
    listener({ type: 'orchestrator_snapshot', runs: this.active() });
    return () => {
      for (const detach of detachByRun) detach();
      detachGlobal();
    };
  }

  abort(runId: string, reason = 'Stopped by user'): boolean {
    const run = this.runs.get(runId);
    if (!run) return false;
    if (run.snapshot.status === 'done' || run.snapshot.status === 'error' || run.snapshot.status === 'cancelled') return false;
    run.controller.abort(new Error(reason));
    // The runner resolves through its own abort handling; mark the detail now so
    // the dashboard shows the cancellation immediately.
    run.snapshot = { ...run.snapshot, detail: reason };
    this.emit({ type: 'orchestrator_run_updated', run: { ...run.snapshot } }, runId);
    return true;
  }

  abortAll(reason = 'Backend disconnected'): number {
    let count = 0;
    for (const runId of [...this.runs.keys()]) if (this.abort(runId, reason)) count += 1;
    return count;
  }

  private finish(runId: string, status: RunStatus, detail: string): RunSnapshot | undefined {
    const run = this.runs.get(runId);
    if (!run) return undefined;
    const completedAt = Date.now();
    run.snapshot = {
      ...run.snapshot,
      status,
      detail,
      completedAt,
      durationMs: Math.max(0, completedAt - run.snapshot.startedAt),
    };
    this.emit({ type: 'orchestrator_run_finished', run: { ...run.snapshot } }, runId);
    this.untrackWorkspace(run.snapshot.workspace, runId);
    this.history.unshift({ ...run.snapshot });
    if (this.history.length > MAX_RECENT_RUNS) this.history.length = MAX_RECENT_RUNS;
    // Release the slot but keep the snapshot available for late subscribers.
    this.runs.delete(runId);
    return { ...run.snapshot };
  }

  private trackWorkspace(workspace: string, runId: string) {
    const set = this.byWorkspace.get(workspace) ?? new Set<string>();
    set.add(runId);
    this.byWorkspace.set(workspace, set);
  }

  private untrackWorkspace(workspace: string, runId: string) {
    const set = this.byWorkspace.get(workspace);
    if (!set) return;
    set.delete(runId);
    if (set.size === 0) this.byWorkspace.delete(workspace);
  }

  private emit(event: OrchestratorEvent, runId: string) {
    const perRun = this.runs.get(runId)?.listeners;
    if (!perRun?.size && !this.globalListeners.size) return;
    for (const listener of [...(perRun ?? []), ...this.globalListeners]) {
      try {
        listener(event);
      } catch {
        // A failing UI subscriber must not take down the run.
      }
    }
  }
}