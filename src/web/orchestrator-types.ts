/** Shapes mirrored from the backend orchestrator for the dashboard UI. */

export type RunStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';
export type WorktreeEngine = 'alisa' | 'cli';

export interface RunSnapshot {
  id: string;
  label: string;
  workspace: string;
  worktreeId?: string;
  cwd: string;
  engine: WorktreeEngine;
  status: RunStatus;
  detail: string;
  model: string;
  mode: string;
  prompt: string;
  sessionId: string;
  swarm: boolean;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
}

export interface WorktreeFileStatus {
  path: string;
  status: string;
  staged: boolean;
}

export interface WorktreeStatus {
  path: string;
  branch: string | null;
  head: string | null;
  files: WorktreeFileStatus[];
  dirtyCount: number;
  stagedCount: number;
  ahead: number;
  behind: number;
  lastCommit: { hash: string; subject: string; author: string; date: number } | null;
  missing: boolean;
}

export interface WorktreeRecord {
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
  status: WorktreeStatus;
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

export interface WorktreeOverview {
  repo: WorktreeRepoInfo;
  worktrees: WorktreeRecord[];
  runs: RunSnapshot[];
  capacity: number;
}

export interface ChangedFileDiff {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  binary: boolean;
  diff: string;
}

export interface DiffAnnotation {
  id: string;
  worktreeId: string;
  filePath: string;
  line: number;
  side: 'new' | 'old';
  comment: string;
  createdAt: number;
  updatedAt: number;
  resolved: boolean;
}

export interface CliAgentAvailability {
  id: string;
  label: string;
  command: string;
  docsUrl: string;
  path: string | null;
  installed: boolean;
  version?: string;
  /** Whether this build knows which flags let the CLI run unattended. */
  yoloFlagsDeclared: boolean;
  /** Whether those flags were found in the installed CLI's own help text. */
  yoloVerified: boolean | null;
  yoloArgs: string[];
}

export type RunBadgeTone = 'idle' | 'busy' | 'good' | 'warn' | 'bad';

export function runTone(status: RunStatus): RunBadgeTone {
  if (status === 'running' || status === 'queued') return 'busy';
  if (status === 'done') return 'good';
  if (status === 'error') return 'bad';
  return 'warn';
}

export function statusTone(status: WorktreeStatus, run?: RunSnapshot): RunBadgeTone {
  if (status.missing) return 'bad';
  if (run && (run.status === 'running' || run.status === 'queued')) return 'busy';
  if (run?.status === 'error') return 'bad';
  if (status.dirtyCount > 0 || status.ahead > 0) return 'warn';
  return 'idle';
}