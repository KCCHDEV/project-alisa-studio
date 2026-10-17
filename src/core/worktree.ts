import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Branch namespace owned by the orchestrator so user branches are never touched by accident. */
export const WORKTREE_BRANCH_PREFIX = 'alisa';

const MAX_SLUG_LENGTH = 48;

/**
 * Filesystem and branch safe slug for a worktree.
 *
 * Titles are frequently non-latin (the UI is Thai), so an ascii-only result
 * falls back to a stable digest instead of an empty string. That keeps the
 * slug deterministic for the same title and avoids every task colliding on
 * `task`.
 */
export function slugifyTitle(title: string): string {
  const normalized = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
  if (normalized) return normalized;
  const digest = createHash('sha1').update(title || 'task').digest('hex').slice(0, 10);
  return `task-${digest}`;
}

/** Reject anything that is not a single ref path segment. */
export function validateBranchSegment(segment: string): string {
  const trimmed = segment.trim();
  if (!trimmed) throw new Error('Branch segment cannot be empty');
  if (trimmed.length > 100) throw new Error('Branch segment is too long');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(trimmed)) {
    throw new Error('Branch segment contains unsupported characters');
  }
  if (trimmed.endsWith('.') || trimmed.endsWith('.lock') || trimmed.endsWith('..')) {
    throw new Error('Branch segment has an invalid ending');
  }
  return trimmed;
}

/**
 * Validate a full git ref name using the rules git itself enforces, so a bad
 * value is rejected before it reaches the argument list.
 */
export function validateBranchName(branch: string): string {
  const trimmed = branch.trim();
  if (!trimmed) throw new Error('Branch name cannot be empty');
  if (trimmed.length > 200) throw new Error('Branch name is too long');
  if (/[\s~^:?*[\\]/.test(trimmed) || /[\x00-\x1f\x7f]/.test(trimmed)) {
    throw new Error('Branch name contains unsupported characters');
  }
  if (trimmed === '@' || trimmed.startsWith('-')) throw new Error('Branch name is not a valid ref');
  if (trimmed.includes('..') || trimmed.includes('@{')) throw new Error('Branch name has an invalid sequence');
  if (trimmed.startsWith('/') || trimmed.endsWith('/') || trimmed.includes('//')) {
    throw new Error('Branch name has an invalid slash position');
  }
  if (trimmed.endsWith('.') || trimmed.endsWith('.lock')) throw new Error('Branch name has an invalid ending');
  return trimmed;
}

export function worktreeBranchName(slug: string): string {
  return `${WORKTREE_BRANCH_PREFIX}/${validateBranchSegment(slug)}`;
}

export function isOrchestratorBranch(branch: string): boolean {
  return branch.startsWith(`${WORKTREE_BRANCH_PREFIX}/`);
}

/** Default location for worktrees: a sibling of the repository, never inside it. */
export function defaultWorktreeRoot(repoRoot: string, override?: string): string {
  if (override && override.trim()) return path.resolve(override.trim());
  const resolvedRepo = path.resolve(repoRoot);
  return path.join(path.dirname(resolvedRepo), '.alisa-worktrees', path.basename(resolvedRepo));
}

/**
 * Worktrees must never live inside the repository they branch from, otherwise
 * every agent's untracked files show up in the user's `git status`.
 */
export function assertWorktreeRootOutsideRepo(repoRoot: string, worktreeRoot: string): string {
  const repo = path.resolve(repoRoot);
  const root = path.resolve(worktreeRoot);
  if (root === repo) throw new Error('Worktree root cannot be the repository itself');
  const relative = path.relative(repo, root);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    throw new Error('Worktree root must live outside the repository');
  }
  return root;
}

function realpathDeepest(target: string): string {
  let ancestor = path.resolve(target);
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) return path.resolve(target);
    ancestor = parent;
  }
  try {
    return fs.realpathSync(ancestor);
  } catch {
    return ancestor;
  }
}

/**
 * Resolve a client supplied path against a trusted root without letting
 * symlinks, junctions or `..` escape it. The root itself does not need to
 * exist yet, which matters because the worktree root is created on demand.
 */
export function resolveInsideRoot(root: string, requested: string): string {
  const absoluteRoot = realpathDeepest(root);
  const target = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(absoluteRoot, requested);
  const existingAncestor = realpathDeepest(target);
  const resolved = path.resolve(existingAncestor, path.relative(existingAncestor, target));
  const relative = path.relative(absoluteRoot, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Path is outside the allowed root');
  }
  return resolved;
}

/** Accept only refs we can hand to `git` without letting flags through as options. */
export function validateRefName(ref: string): string {
  const trimmed = ref.trim();
  if (!trimmed) throw new Error('Git ref cannot be empty');
  if (trimmed.startsWith('-')) throw new Error('Git ref cannot start with a dash');
  if (trimmed.length > 300) throw new Error('Git ref is too long');
  if (/[\x00-\x1f\x7f]/.test(trimmed)) throw new Error('Git ref contains control characters');
  return trimmed;
}