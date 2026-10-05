import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import {
  assertWorktreeRootOutsideRepo,
  defaultWorktreeRoot,
  isOrchestratorBranch,
  resolveInsideRoot,
  slugifyTitle,
  validateBranchName,
  validateBranchSegment,
  validateRefName,
  worktreeBranchName,
} from '../src/core/worktree.ts';
import { WorktreeRegistry } from '../src/server/worktrees.ts';
import {
  listWorktreeEntries,
  worktreeFileDiffs,
  worktreeStatus,
  commitWorktree,
  conflictedFiles,
  mergeBranch,
  abortMerge,
} from '../src/server/worktree-git.ts';

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
}

function makeRepo(parent: string): string {
  const root = join(parent, 'repo');
  mkdirSync(root, { recursive: true });
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Alisa Test');
  writeFileSync(join(root, 'README.md'), '# base\n');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'index.ts'), 'export const value = 1;\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-m', 'initial commit');
  return root;
}

/**
 * Each test gets its own sandbox parent so the sibling `.alisa-worktrees`
 * directory is never shared.
 *
 * Cleanup is best effort: on Windows git can still hold handles on a linked
 * worktree, and a leaked temp directory must never fail an otherwise green
 * test. Registered worktrees are removed through git first so the repository
 * metadata does not keep pointing at deleted directories.
 */
function withRepo<T>(fn: (repo: string, runtime: string) => Promise<T> | T): Promise<T> {
  const sandbox = mkdtempSync(join(tmpdir(), 'alisa-wt-'));
  const repo = makeRepo(sandbox);
  const runtime = join(sandbox, 'runtime');
  mkdirSync(runtime, { recursive: true });
  const cleanup = () => {
    try {
      for (const entry of git(repo, 'worktree', 'list', '--porcelain').split('\n')) {
        if (!entry.startsWith('worktree ')) continue;
        const target = entry.slice('worktree '.length).trim();
        if (!target || target === repo) continue;
        execFileSync('git', ['worktree', 'remove', '--force', target], { cwd: repo, windowsHide: true, stdio: 'ignore' });
      }
      execFileSync('git', ['worktree', 'prune'], { cwd: repo, windowsHide: true, stdio: 'ignore' });
    } catch {
      // Fall through to the filesystem cleanup below.
    }
    try {
      rmSync(sandbox, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    } catch {
      // Best effort only.
    }
  };
  try {
    const result = fn(repo, runtime);
    if (result instanceof Promise) {
      return result.finally(cleanup);
    }
    cleanup();
    return Promise.resolve(result);
  } catch (error) {
    cleanup();
    throw error;
  }
}

test('slugifyTitle keeps ascii titles readable and gives non-latin titles a stable digest', () => {
  expect(slugifyTitle('Fix login bug')).toBe('fix-login-bug');
  expect(slugifyTitle('  Refactor   the   Editor  ')).toBe('refactor-the-editor');
  expect(slugifyTitle('Add OAuth + PKCE flow')).toBe('add-oauth-pkce-flow');
  expect(slugifyTitle('a'.repeat(200))).toHaveLength(48);

  const thai = slugifyTitle('แก้บั๊กล็อกอิน');
  expect(thai).toMatch(/^task-[0-9a-f]{10}$/);
  expect(slugifyTitle('แก้บั๊กล็อกอิน')).toBe(thai);
});

test('branch names follow git ref rules and reject injection-prone values', () => {
  expect(validateBranchName('alisa/fix-login')).toBe('alisa/fix-login');
  expect(worktreeBranchName('fix-login')).toBe('alisa/fix-login');
  expect(isOrchestratorBranch('alisa/fix-login')).toBe(true);
  expect(isOrchestratorBranch('main')).toBe(false);

  for (const invalid of [
    '',
    '   ',
    '-leading-dash',
    'has space',
    'has~tilde',
    'has^caret',
    'has:colon',
    'has?question',
    'has*star',
    'has[bracket',
    'has\\backslash',
    'double//slash',
    'trailing/',
    '/leading',
    'ends.with.dot.',
    'ends.lock',
    'double..dot',
    'has@{brace',
    '@',
    'x'.repeat(201),
  ]) {
    expect(() => validateBranchName(invalid)).toThrow();
  }

  expect(() => validateBranchSegment('nested/segment')).toThrow();
  expect(() => validateBranchSegment('fine-segment')).not.toThrow();
  expect(() => validateRefName('--upload-pack=evil')).toThrow();
  expect(() => validateRefName('main')).not.toThrow();
});

test('resolveInsideRoot blocks traversal and symlink escapes but allows new paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'alisa-wt-root-'));
  try {
    expect(resolveInsideRoot(root, 'child/leaf')).toBe(resolve(root, 'child/leaf'));
    expect(resolveInsideRoot(root, resolve(root, 'explicit'))).toBe(resolve(root, 'explicit'));
    expect(() => resolveInsideRoot(root, '../outside')).toThrow();
    expect(() => resolveInsideRoot(root, resolve(root, '..', 'outside'))).toThrow();
    expect(() => resolveInsideRoot(root, join(root, 'a', '..', '..', 'b'))).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('worktree root must live outside the repository', () => {
  const repo = resolve(join(tmpdir(), 'alisa-repo-x'));
  expect(assertWorktreeRootOutsideRepo(repo, join(repo, '..', '.alisa-worktrees', 'alisa-repo-x')))
    .toBe(join(repo, '..', '.alisa-worktrees', 'alisa-repo-x'));
  expect(() => assertWorktreeRootOutsideRepo(repo, repo)).toThrow();
  expect(() => assertWorktreeRootOutsideRepo(repo, join(repo, '.worktrees'))).toThrow();
  expect(() => assertWorktreeRootOutsideRepo(repo, join(repo, 'nested', 'wt'))).toThrow();
  expect(defaultWorktreeRoot(repo)).toContain(sep + '.alisa-worktrees' + sep);
  expect(defaultWorktreeRoot(repo, '/custom/root')).toBe(resolve('/custom/root'));
});

test('registry reports when a workspace is not a git repository', async () => {
  await withRepo(async (_repo, runtime) => {
    const plain = mkdtempSync(join(tmpdir(), 'alisa-wt-plain-'));
    try {
      const registry = new WorktreeRegistry({ runtimeDir: runtime });
      const info = await registry.repoInfo(plain);
      expect(info.available).toBe(false);
      expect(info.repoRoot).toBeNull();
      expect(info.reason).toContain('not a Git repository');
      expect(await registry.list(plain)).toEqual([]);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

test('creating two worktrees with the same title produces distinct branches and directories', async () => {
  await withRepo(async (repo, runtime) => {
    const registry = new WorktreeRegistry({ runtimeDir: runtime });
    const first = await registry.create({ workspace: repo, title: 'Fix login', prompt: 'one' });
    const second = await registry.create({ workspace: repo, title: 'Fix login', prompt: 'two' });

    expect(first.branch).toBe('alisa/fix-login');
    expect(second.branch).toBe('alisa/fix-login-2');
    expect(first.path).not.toBe(second.path);
    expect(existsSync(join(first.path, 'README.md'))).toBe(true);

    // The new worktrees must not pollute the main repository status.
    expect(git(repo, 'status', '--porcelain').trim()).toBe('');

    const entries = await listWorktreeEntries(repo);
    expect(entries.map(entry => entry.path).sort()).toEqual([repo, first.path, second.path].sort());
  });
});

test('worktree status reports dirty files, commits and divergence from the base ref', async () => {
  await withRepo(async (repo, runtime) => {
    const registry = new WorktreeRegistry({ runtimeDir: runtime });
    const record = await registry.create({ workspace: repo, title: 'Editor work' });

    writeFileSync(join(record.path, 'src', 'index.ts'), 'export const value = 2;\n');
    writeFileSync(join(record.path, 'new-file.ts'), 'export const added = true;\n');

    const dirty = await worktreeStatus(record.path, record.baseRef);
    expect(dirty.dirtyCount).toBe(2);
    expect(dirty.branch).toBe('alisa/editor-work');
    expect(dirty.files.map(file => file.path).sort()).toEqual(['new-file.ts', 'src/index.ts']);

    const committed = await commitWorktree({ worktreePath: record.path, message: 'Bump value' });
    expect(committed.hash).toHaveLength(40);

    const afterCommit = await worktreeStatus(record.path, record.baseRef);
    expect(afterCommit.dirtyCount).toBe(0);
    expect(afterCommit.ahead).toBe(1);
    expect(afterCommit.behind).toBe(0);
    expect(afterCommit.lastCommit?.subject).toBe('Bump value');
  });
});

test('worktreeFileDiffs returns per-file patches including untracked files', async () => {
  await withRepo(async (repo, runtime) => {
    const registry = new WorktreeRegistry({ runtimeDir: runtime });
    const record = await registry.create({ workspace: repo, title: 'Diff review' });

    writeFileSync(join(record.path, 'src', 'index.ts'), 'export const value = 42;\n');
    writeFileSync(join(record.path, 'docs.md'), '# New doc\n');
    git(record.path, 'add', '-A');
    git(record.path, 'commit', '-m', 'change files');

    const files = await worktreeFileDiffs({ worktreePath: record.path, baseRef: record.baseRef });
    const byPath = new Map(files.map(file => [file.path, file]));
    expect([...byPath.keys()].sort()).toEqual(['docs.md', 'src/index.ts']);
    expect(byPath.get('src/index.ts')?.status).toBe('modified');
    expect(byPath.get('src/index.ts')?.additions).toBeGreaterThan(0);
    expect(byPath.get('src/index.ts')?.diff).toContain('export const value = 42;');
    expect(byPath.get('docs.md')?.diff).toContain('# New doc');

    const scoped = await worktreeFileDiffs({ worktreePath: record.path, baseRef: record.baseRef, paths: ['docs.md'] });
    expect(scoped.map(file => file.path)).toEqual(['docs.md']);
  });
});

test('merge brings a worktree branch back and refuses to run over uncommitted work', async () => {
  await withRepo(async (repo, runtime) => {
    const registry = new WorktreeRegistry({ runtimeDir: runtime });
    const record = await registry.create({ workspace: repo, title: 'Mergeable' });
    writeFileSync(join(record.path, 'src', 'index.ts'), 'export const merged = true;\n');
    await commitWorktree({ worktreePath: record.path, message: 'Mergeable change' });

    writeFileSync(join(repo, 'README.md'), '# locally edited, not committed\n');
    await expect(mergeBranch({ repoRoot: repo, mainWorktreePath: repo, branch: record.branch }))
      .rejects.toThrow(/Commit or discard/);
    git(repo, 'checkout', '--', 'README.md');

    const result = await mergeBranch({ repoRoot: repo, mainWorktreePath: repo, branch: record.branch });
    expect(result.merged).toBe(true);
    expect(result.conflicted).toBe(false);
    expect(readMerged(repo)).toContain('export const merged = true;');

    const second = await mergeBranch({ repoRoot: repo, mainWorktreePath: repo, branch: record.branch });
    expect(second.alreadyUpToDate).toBe(true);
  });
});

test('a conflicting merge is reported instead of throwing, and can be aborted', async () => {
  await withRepo(async (repo, runtime) => {
    const registry = new WorktreeRegistry({ runtimeDir: runtime });
    const record = await registry.create({ workspace: repo, title: 'Conflicting' });

    writeFileSync(join(repo, 'src', 'index.ts'), 'export const value = "main";\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'main change');

    writeFileSync(join(record.path, 'src', 'index.ts'), 'export const value = "worktree";\n');
    await commitWorktree({ worktreePath: record.path, message: 'worktree change' });

    const result = await mergeBranch({ repoRoot: repo, mainWorktreePath: repo, branch: record.branch });
    expect(result.conflicted).toBe(true);
    expect(await conflictedFiles(repo)).toContain('src/index.ts');

    await abortMerge(repo);
    expect(git(repo, 'status', '--porcelain').trim()).toBe('');
  });
});

test('resolvePath rejects unknown ids and never trusts a caller supplied path', async () => {
  await withRepo(async (repo, runtime) => {
    const registry = new WorktreeRegistry({ runtimeDir: runtime });
    const record = await registry.create({ workspace: repo, title: 'Guarded' });

    await expect(registry.resolvePath(repo, record.id)).resolves.toMatchObject({ meta: { id: record.id } });
    await expect(registry.resolvePath(repo, '../../../etc')).rejects.toThrow('Unknown worktree');
    await expect(registry.resolvePath(repo, '')).rejects.toThrow('Unknown worktree');

    // A record whose path was tampered with on disk must not be usable.
    const tampered = new WorktreeRegistry({ runtimeDir: runtime });
    void tampered;
    writeFileSync(
      join(runtime, '.alisa-worktrees.json'),
      JSON.stringify({
        version: 1,
        worktrees: [{ ...record, id: 'tampered', path: repo }],
      }),
    );
    const forged = new WorktreeRegistry({ runtimeDir: runtime });
    await expect(forged.resolvePath(repo, 'tampered')).rejects.toThrow(/outside the worktree root|no longer registered/);
  });
});

test('remove deletes the worktree, optionally its branch, and prunes metadata', async () => {
  await withRepo(async (repo, runtime) => {
    const registry = new WorktreeRegistry({ runtimeDir: runtime });
    const record = await registry.create({ workspace: repo, title: 'Temporary' });

    const kept = await registry.remove({ workspace: repo, id: record.id, deleteBranch: false });
    expect(kept.removed).toBe(true);
    expect(kept.branchDeleted).toBe(false);
    expect(existsSync(record.path)).toBe(false);
    expect(await registry.list(repo)).toEqual([]);
    expect(git(repo, 'branch', '--list', record.branch).trim()).not.toBe('');

    const second = await registry.create({ workspace: repo, title: 'Temporary two' });
    const removed = await registry.remove({ workspace: repo, id: second.id, deleteBranch: true });
    expect(removed.branchDeleted).toBe(true);
    expect(git(repo, 'branch', '--list', second.branch).trim()).toBe('');
  });
});

test('reconcile drops records whose directories were deleted outside the app', async () => {
  await withRepo(async (repo, runtime) => {
    const registry = new WorktreeRegistry({ runtimeDir: runtime });
    const record = await registry.create({ workspace: repo, title: 'Vanishing' });
    expect((await registry.list(repo))).toHaveLength(1);

    rmSync(record.path, { recursive: true, force: true });
    git(repo, 'worktree', 'prune');

    const stale = await registry.list(repo);
    expect(stale).toHaveLength(1);
    expect(stale[0].orphaned).toBe(true);
    expect(stale[0].status.missing).toBe(true);

    const { dropped } = await registry.reconcile(repo);
    expect(dropped).toBe(1);
    expect(await registry.list(repo)).toEqual([]);
  });
});

function readMerged(repo: string): string {
  return execFileSync('node', ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(join(repo, 'src', 'index.ts'))},'utf8'))`], { encoding: 'utf8' });
}