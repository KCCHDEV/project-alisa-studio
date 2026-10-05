import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { validateBranchName, validateRefName } from '../core/worktree.ts';

const exec = promisify(execFile);

const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;

export interface GitCommandResult {
  stdout: string;
  stderr: string;
}

export class GitCommandError extends Error {
  readonly args: string[];
  readonly stderr: string;
  readonly code?: string;

  constructor(args: string[], stderr: string, message: string, code?: string) {
    super(message);
    this.name = 'GitCommandError';
    this.args = args;
    this.stderr = stderr;
    this.code = code;
  }
}

/**
 * Run git with an explicit argument array. No shell is involved, so a branch or
 * path can never be reinterpreted as another command.
 */
export async function runGit(cwd: string, args: string[], timeout = GIT_TIMEOUT_MS): Promise<GitCommandResult> {
  try {
    const { stdout, stderr } = await exec('git', args, {
      cwd,
      windowsHide: true,
      timeout,
      maxBuffer: GIT_MAX_BUFFER,
    });
    return { stdout, stderr };
  } catch (error: any) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
    const stdout = typeof error?.stdout === 'string' ? error.stdout : '';
    const detail = (stderr || stdout).trim().split('\n').slice(0, 4).join(' ').trim();
    const reason = detail || (error instanceof Error ? error.message : 'git command failed');
    throw new GitCommandError(args, detail, `git ${args[0]} failed: ${reason}`, error?.code);
  }
}

export interface WorktreeGitEntry {
  path: string;
  branch: string | null;
  head: string | null;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
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

export interface ChangedFileDiff {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  binary: boolean;
  diff: string;
}

/** Absolute path of the repository that contains `workspace`, or null when it is not a repo. */
export async function resolveRepoRoot(workspace: string): Promise<string | null> {
  try {
    const { stdout } = await runGit(workspace, ['rev-parse', '--show-toplevel']);
    const root = stdout.trim();
    return root ? path.resolve(root) : null;
  } catch {
    return null;
  }
}

export async function currentBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const branch = stdout.trim();
    return branch && branch !== 'HEAD' ? branch : null;
  } catch {
    return null;
  }
}

export async function hasCommits(cwd: string): Promise<boolean> {
  try {
    await runGit(cwd, ['rev-parse', '--verify', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

export async function listBranches(repoRoot: string): Promise<string[]> {
  const { stdout } = await runGit(repoRoot, [
    'for-each-ref',
    '--sort=-committerdate',
    '--format=%(refname:short)',
    'refs/heads',
  ]);
  return stdout.split('\n').map(line => line.trim()).filter(Boolean);
}

/** The ref new worktrees branch from by default: the checked out branch, else HEAD. */
export async function defaultBaseRef(repoRoot: string): Promise<string> {
  return (await currentBranch(repoRoot)) ?? 'HEAD';
}

export async function branchExists(repoRoot: string, branch: string): Promise<boolean> {
  const ref = `refs/heads/${validateBranchName(branch)}`;
  try {
    await runGit(repoRoot, ['show-ref', '--verify', '--quiet', ref]);
    return true;
  } catch {
    return false;
  }
}

export async function refExists(cwd: string, ref: string): Promise<boolean> {
  try {
    await runGit(cwd, ['rev-parse', '--verify', '--quiet', `${validateRefName(ref)}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function parseWorktreeList(porcelain: string): WorktreeGitEntry[] {
  const entries: WorktreeGitEntry[] = [];
  let current: Partial<WorktreeGitEntry> | null = null;

  const flush = () => {
    if (!current?.path) return;
    entries.push({
      path: path.resolve(current.path),
      branch: current.branch ?? null,
      head: current.head ?? null,
      detached: current.detached ?? false,
      bare: current.bare ?? false,
      locked: current.locked ?? false,
      prunable: current.prunable ?? false,
    });
    current = null;
  };

  for (const rawLine of porcelain.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) {
      flush();
      continue;
    }
    const spaceIndex = line.indexOf(' ');
    const key = spaceIndex === -1 ? line : line.slice(0, spaceIndex);
    const value = spaceIndex === -1 ? '' : line.slice(spaceIndex + 1);
    if (key === 'worktree') {
      flush();
      current = { path: value };
    } else if (!current) {
      continue;
    } else if (key === 'HEAD') {
      current.head = value;
    } else if (key === 'branch') {
      current.branch = value.replace(/^refs\/heads\//, '');
    } else if (key === 'detached') {
      current.detached = true;
    } else if (key === 'bare') {
      current.bare = true;
    } else if (key === 'locked') {
      current.locked = true;
    } else if (key === 'prunable') {
      current.prunable = true;
    }
  }
  flush();
  return entries;
}

export async function listWorktreeEntries(repoRoot: string): Promise<WorktreeGitEntry[]> {
  const { stdout } = await runGit(repoRoot, ['worktree', 'list', '--porcelain']);
  return parseWorktreeList(stdout);
}

/**
 * Git still lists worktrees whose directory was deleted by hand. Callers use
 * this to tell "not created yet" apart from "created but gone".
 */
export function* existingWorktreeDirectories(entries: WorktreeGitEntry[]): Generator<WorktreeGitEntry> {
  for (const entry of entries) {
    if (entry.prunable) continue;
    yield entry;
  }
}

export async function createWorktree(options: {
  repoRoot: string;
  targetPath: string;
  branch: string;
  baseRef: string;
}): Promise<WorktreeGitEntry> {
  const branch = validateBranchName(options.branch);
  const baseRef = validateRefName(options.baseRef);
  // Plain `add` performs a real checkout so the agent starts with a populated
  // working tree; `--no-checkout` would leave an empty directory behind.
  await runGit(options.repoRoot, ['worktree', 'add', '-b', branch, options.targetPath, baseRef]);
  const entries = await listWorktreeEntries(options.repoRoot);
  const created = entries.find(entry => path.resolve(entry.path) === path.resolve(options.targetPath));
  if (!created) throw new Error('Git did not register the new worktree');
  return created;
}

export async function removeWorktree(options: {
  repoRoot: string;
  worktreePath: string;
  force?: boolean;
}): Promise<void> {
  const args = ['worktree', 'remove'];
  if (options.force !== false) args.push('--force');
  args.push(options.worktreePath);
  await runGit(options.repoRoot, args);
}

export async function pruneWorktrees(repoRoot: string): Promise<void> {
  await runGit(repoRoot, ['worktree', 'prune']);
}

export async function deleteBranch(repoRoot: string, branch: string): Promise<boolean> {
  const name = validateBranchName(branch);
  try {
    await runGit(repoRoot, ['branch', '-D', name]);
    return true;
  } catch {
    return false;
  }
}

function parsePorcelainStatus(porcelain: string): WorktreeFileStatus[] {
  const files: WorktreeFileStatus[] = [];
  for (const rawLine of porcelain.split('\n')) {
    if (!rawLine.trim()) continue;
    // `XY path` where X is the index status and Y the working tree status.
    const index = rawLine[0];
    const worktree = rawLine[1];
    const rest = rawLine.slice(3);
    if (!rest) continue;
    const renamed = rest.includes(' -> ');
    const filePath = renamed ? rest.slice(0, rest.indexOf(' -> ')) : rest;
    files.push({
      path: filePath,
      status: `${index}${worktree}`,
      staged: index !== ' ' && index !== '?',
    });
  }
  return files;
}

async function countAheadBehind(worktreePath: string, baseRef: string): Promise<{ ahead: number; behind: number }> {
  try {
    const { stdout } = await runGit(worktreePath, ['rev-list', '--left-right', '--count', `${baseRef}...HEAD`]);
    const [behind = '0', ahead = '0'] = stdout.trim().split(/\s+/);
    return { ahead: Number(ahead) || 0, behind: Number(behind) || 0 };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

async function readLastCommit(worktreePath: string): Promise<WorktreeStatus['lastCommit']> {
  try {
    const { stdout } = await runGit(worktreePath, [
      'log',
      '-1',
      '--format=%H%x1f%s%x1f%an%x1f%at',
    ]);
    const line = stdout.trim();
    if (!line) return null;
    const [hash = '', subject = '', author = '', timestamp = '0'] = line.split('\x1f');
    return { hash, subject, author, date: Number(timestamp) * 1000 };
  } catch {
    return null;
  }
}

export async function worktreeStatus(worktreePath: string, baseRef?: string): Promise<WorktreeStatus> {
  const base = baseRef ? validateRefName(baseRef) : 'HEAD';
  const [branch, files, lastCommit, counts] = await Promise.all([
    currentBranch(worktreePath),
    runGit(worktreePath, ['status', '--porcelain=v1', '--untracked-files=all'])
      .then(result => parsePorcelainStatus(result.stdout))
      .catch(() => [] as WorktreeFileStatus[]),
    readLastCommit(worktreePath),
    countAheadBehind(worktreePath, base),
  ]);
  return {
    path: path.resolve(worktreePath),
    branch,
    head: lastCommit?.hash ?? null,
    files,
    dirtyCount: files.length,
    stagedCount: files.filter(file => file.staged).length,
    ahead: counts.ahead,
    behind: counts.behind,
    lastCommit,
    missing: false,
  };
}

export async function missingWorktreeStatus(entry: WorktreeGitEntry, baseRef?: string): Promise<WorktreeStatus> {
  return {
    path: entry.path,
    branch: entry.branch,
    head: entry.head,
    files: [],
    dirtyCount: 0,
    stagedCount: 0,
    ahead: 0,
    behind: 0,
    lastCommit: null,
    missing: true,
  };
}

function countDiffLines(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }
  return { additions, deletions };
}

const NAME_STATUS_LABELS: Record<string, string> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'typechange',
};

/** Per-file diff of a worktree against its base ref, used by the review UI. */
export async function worktreeFileDiffs(options: {
  worktreePath: string;
  baseRef: string;
  paths?: string[];
  maxBytes?: number;
}): Promise<ChangedFileDiff[]> {
  const baseRef = validateRefName(options.baseRef);
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const pathFilter = options.paths?.length ? options.paths : undefined;

  // `git diff <base>` covers committed and staged edits but never untracked
  // files, which is exactly what a fresh agent produces, so merge both sources.
  const tracked = await changedPathList(options.worktreePath, baseRef, pathFilter);
  const untracked = await untrackedPathList(options.worktreePath, pathFilter);
  const files: ChangedFileDiff[] = [];

  for (const entry of tracked) {
    const diff = await capped(await patchForTrackedFile(options.worktreePath, baseRef, entry.path), maxBytes);
    const counts = countDiffLines(diff);
    files.push({
      path: entry.path,
      status: entry.status,
      additions: counts.additions,
      deletions: counts.deletions,
      binary: entry.binary,
      diff,
    });
  }

  for (const filePath of untracked) {
    const patch = await newFilePatch(options.worktreePath, filePath, maxBytes);
    if (patch.binary) {
      files.push({ path: filePath, status: 'added', additions: 0, deletions: 0, binary: true, diff: '' });
      continue;
    }
    const counts = countDiffLines(patch.diff);
    files.push({
      path: filePath,
      status: 'added',
      additions: counts.additions,
      deletions: counts.deletions,
      binary: false,
      diff: patch.diff,
    });
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function capped(value: string, maxBytes: number): Promise<string> {
  return value.length > maxBytes ? `${value.slice(0, maxBytes)}\n… truncated …\n` : value;
}

interface ChangedPath {
  path: string;
  status: string;
  binary: boolean;
}

async function changedPathList(worktreePath: string, baseRef: string, pathFilter?: string[]): Promise<ChangedPath[]> {
  const args = ['diff', '--no-ext-diff', '--no-textconv', '--find-renames', '--name-status', '-z', baseRef, '--'];
  if (pathFilter?.length) args.push(...pathFilter);
  const { stdout } = await runGit(worktreePath, args);
  const tokens = stdout.split('\0').filter(token => token.length > 0);
  const entries: ChangedPath[] = [];

  for (let index = 0; index < tokens.length;) {
    const code = tokens[index];
    index += 1;
    if (!code) break;
    const statusLetter = code[0];
    // Rename and copy statuses carry the source path as an extra NUL field.
    const isPair = statusLetter === 'R' || statusLetter === 'C';
    const filePath = isPair ? tokens[index + 1] : tokens[index];
    index += isPair ? 2 : 1;
    if (!filePath) continue;
    entries.push({ path: filePath, status: NAME_STATUS_LABELS[statusLetter] || 'modified', binary: false });
  }

  const binaryPaths = await binaryPathList(worktreePath, baseRef, pathFilter);
  for (const entry of entries) if (binaryPaths.has(entry.path)) entry.binary = true;
  return entries;
}

async function binaryPathList(worktreePath: string, baseRef: string, pathFilter?: string[]): Promise<Set<string>> {
  const args = ['diff', '--no-ext-diff', '--no-textconv', '--find-renames', '--numstat', '-z', baseRef, '--'];
  if (pathFilter?.length) args.push(...pathFilter);
  try {
    const { stdout } = await runGit(worktreePath, args);
    const tokens = stdout.split('\0').filter(token => token.length > 0);
    const binaries = new Set<string>();
    for (let index = 0; index < tokens.length; index += 1) {
      const additions = tokens[index];
      const deletions = tokens[index + 1];
      const filePath = tokens[index + 2];
      if (filePath && (additions === '-' || deletions === '-')) binaries.add(filePath);
    }
    return binaries;
  } catch {
    return new Set();
  }
}

async function untrackedPathList(worktreePath: string, pathFilter?: string[]): Promise<string[]> {
  const args = ['ls-files', '--others', '--exclude-standard', '-z'];
  if (pathFilter?.length) args.push('--', ...pathFilter);
  try {
    const { stdout } = await runGit(worktreePath, args);
    return stdout.split('\0').filter(token => token.length > 0).slice(0, 500);
  } catch {
    return [];
  }
}

async function patchForTrackedFile(worktreePath: string, baseRef: string, filePath: string): Promise<string> {
  try {
    const { stdout } = await runGit(worktreePath, [
      'diff', '--no-ext-diff', '--no-textconv', '--find-renames', baseRef, '--', filePath,
    ]);
    return stdout;
  } catch {
    return '';
  }
}

function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8000).includes(0);
}

/**
 * Build a new-file unified diff by hand.
 *
 * The usual trick (`git add --intent-to-add`) mutates the user's index, which is
 * not acceptable for a read-only review action.
 */
async function newFilePatch(worktreePath: string, filePath: string, maxBytes: number): Promise<{ diff: string; binary: boolean }> {
  let content: Buffer;
  try {
    content = await fs.promises.readFile(path.join(worktreePath, filePath));
  } catch {
    return { diff: '', binary: false };
  }
  if (looksBinary(content)) return { diff: '', binary: true };

  const text = content.toString('utf8');
  const endsWithNewline = text.endsWith('\n');
  const body = endsWithNewline ? text.slice(0, -1) : text;
  const lines = body.length ? body.split('\n') : [];
  if (text.length > maxBytes) {
    const header = `diff --git a/${filePath} b/${filePath}\nnew file mode 100644\n--- /dev/null\n+++ b/${filePath}\n`;
    return { diff: `${header}@@ -0,0 +1,${lines.length} @@\n… truncated …\n`, binary: false };
  }
  const header = [
    `diff --git a/${filePath} b/${filePath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
  ].join('\n');
  const added = lines.map(line => `+${line}`).join('\n');
  const tail = endsWithNewline ? '\n' : '\n\\ No newline at end of file\n';
  return { diff: `${header}\n${added}${tail}`, binary: false };
}

export async function commitWorktree(options: {
  worktreePath: string;
  message: string;
  paths?: string[];
}): Promise<{ hash: string; subject: string }> {
  const message = options.message.trim();
  if (!message) throw new Error('Commit message is required');
  if (message.length > 4000) throw new Error('Commit message is too long');
  if (options.paths?.length) await runGit(options.worktreePath, ['add', '--', ...options.paths]);
  else await runGit(options.worktreePath, ['add', '-A']);
  await runGit(options.worktreePath, ['commit', '-m', message]);
  // `git commit` prints "[branch hash] subject", so ask for the hash directly.
  const { stdout } = await runGit(options.worktreePath, ['rev-parse', 'HEAD']);
  const commit = await readLastCommit(options.worktreePath);
  return { hash: stdout.trim(), subject: commit?.subject || message };
}

export interface MergeResult {
  merged: boolean;
  conflicted: boolean;
  alreadyUpToDate: boolean;
  message: string;
}

export async function isWorktreeClean(cwd: string): Promise<boolean> {
  const { stdout } = await runGit(cwd, ['status', '--porcelain=v1']);
  return stdout.trim().length === 0;
}

/**
 * Merge an orchestrator branch back into the main worktree.
 *
 * Refuses to touch a dirty main worktree: a merge there can interleave with
 * uncommitted user edits in ways that are hard to recover.
 */
export async function mergeBranch(options: {
  repoRoot: string;
  mainWorktreePath: string;
  branch: string;
  message?: string;
}): Promise<MergeResult> {
  const branch = validateBranchName(options.branch);
  if (!(await isWorktreeClean(options.mainWorktreePath))) {
    throw new Error('Commit or discard the changes in the main workspace before merging');
  }
  if (!(await refExists(options.repoRoot, branch))) {
    throw new Error(`Branch ${branch} no longer exists`);
  }
  const targetBranch = await currentBranch(options.mainWorktreePath);
  const args = ['merge', '--no-ff', '-m', options.message?.trim() || `Merge ${branch} into ${targetBranch ?? 'main'}`, branch];
  try {
    const { stdout } = await runGit(options.mainWorktreePath, args);
    const text = stdout.trim();
    if (/already up to date/i.test(text)) return { merged: false, conflicted: false, alreadyUpToDate: true, message: text };
    return { merged: true, conflicted: false, alreadyUpToDate: false, message: text };
  } catch (error) {
    if (error instanceof GitCommandError && /conflict/i.test(error.stderr)) {
      return { merged: false, conflicted: true, alreadyUpToDate: false, message: error.stderr };
    }
    throw error;
  }
}

export async function abortMerge(mainWorktreePath: string): Promise<void> {
  await runGit(mainWorktreePath, ['merge', '--abort']);
}

export async function conflictedFiles(cwd: string): Promise<string[]> {
  const { stdout } = await runGit(cwd, ['diff', '--name-only', '--diff-filter=U']);
  return stdout.split('\n').map(line => line.trim()).filter(Boolean);
}
