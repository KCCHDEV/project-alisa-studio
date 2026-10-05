import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnnotationStore, formatAnnotationsForAgent } from '../src/server/annotations.ts';

function newStore() {
  const dir = mkdtempSync(join(tmpdir(), 'alisa-anno-'));
  return { dir, store: new AnnotationStore(dir) };
}

test('annotations are stored per worktree and listed in file/line order', () => {
  const { dir, store } = newStore();
  try {
    store.add({ worktreeId: 'wt-1', filePath: 'src/b.ts', line: 12, comment: 'handle the empty case' });
    store.add({ worktreeId: 'wt-1', filePath: 'src/a.ts', line: 40, comment: 'this leaks a handle' });
    store.add({ worktreeId: 'wt-1', filePath: 'src/a.ts', line: 4, comment: 'typo in the name' });
    store.add({ worktreeId: 'wt-2', filePath: 'other.ts', line: 1, comment: 'different worktree' });

    const listed = store.list('wt-1');
    expect(listed.map(entry => `${entry.filePath}:${entry.line}`)).toEqual([
      'src/a.ts:4', 'src/a.ts:40', 'src/b.ts:12',
    ]);
    expect(store.list('wt-2')).toHaveLength(1);
    expect(store.open('wt-1')).toHaveLength(3);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('resolving, editing and deleting annotations works and persists', () => {
  const { dir, store } = newStore();
  try {
    const created = store.add({ worktreeId: 'wt-1', filePath: 'a.ts', line: 3, comment: 'fix this', side: 'old' });
    expect(created.resolved).toBe(false);
    expect(created.side).toBe('old');

    const resolved = store.update(created.id, { resolved: true });
    expect(resolved.resolved).toBe(true);
    expect(store.open('wt-1')).toHaveLength(0);
    expect(store.list('wt-1')).toHaveLength(1);

    const edited = store.update(created.id, { comment: 'reworded', line: 9 });
    expect(edited.comment).toBe('reworded');
    expect(edited.line).toBe(9);

    // A new store over the same directory must see the persisted state.
    const reopened = new AnnotationStore(dir);
    expect(reopened.list('wt-1')).toHaveLength(1);
    expect(reopened.list('wt-1')[0].comment).toBe('reworded');

    expect(store.remove(created.id)).toBe(true);
    expect(store.remove(created.id)).toBe(false);
    expect(new AnnotationStore(dir).list('wt-1')).toHaveLength(0);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('invalid annotation input is rejected', () => {
  const { dir, store } = newStore();
  try {
    const base = { worktreeId: 'wt-1', filePath: 'a.ts', line: 1, comment: 'x' };
    expect(() => store.add({ ...base, worktreeId: '' })).toThrow();
    expect(() => store.add({ ...base, filePath: '' })).toThrow();
    expect(() => store.add({ ...base, filePath: '/etc/passwd' })).toThrow(/relative/);
    expect(() => store.add({ ...base, filePath: 'C:\\Windows\\system32' })).toThrow(/relative/);
    expect(() => store.add({ ...base, filePath: '../escape.ts' })).toThrow(/cannot leave/);
    expect(() => store.add({ ...base, filePath: 'a/../../escape.ts' })).toThrow(/cannot leave/);
    expect(() => store.add({ ...base, comment: '' })).toThrow();
    expect(() => store.add({ ...base, comment: 'x'.repeat(5000) })).toThrow(/too long/);
    expect(() => store.add({ ...base, line: 0 })).toThrow();
    expect(() => store.add({ ...base, line: 1.5 })).toThrow();
    expect(() => store.add({ ...base, line: -3 })).toThrow();
    expect(() => store.update('missing', { resolved: true })).toThrow('Unknown annotation');
    expect(store.add({ ...base, filePath: 'nested/ok.ts', comment: 'nested paths are fine' }).filePath).toBe('nested/ok.ts');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('clear removes every annotation for one worktree only', () => {
  const { dir, store } = newStore();
  try {
    store.add({ worktreeId: 'wt-1', filePath: 'a.ts', line: 1, comment: 'one' });
    store.add({ worktreeId: 'wt-1', filePath: 'b.ts', line: 2, comment: 'two' });
    store.add({ worktreeId: 'wt-2', filePath: 'c.ts', line: 3, comment: 'three' });

    expect(store.clear('wt-1')).toBe(2);
    expect(store.list('wt-1')).toHaveLength(0);
    expect(store.list('wt-2')).toHaveLength(1);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('formatAnnotationsForAgent groups notes per file and skips resolved ones', () => {
  const { dir, store } = newStore();
  try {
    const resolved = store.add({ worktreeId: 'wt-1', filePath: 'src/a.ts', line: 5, comment: 'already fixed' });
    store.update(resolved.id, { resolved: true });
    store.add({ worktreeId: 'wt-1', filePath: 'src/a.ts', line: 30, comment: 'still wrong' });
    store.add({ worktreeId: 'wt-1', filePath: 'src/b.ts', line: 2, side: 'old', comment: 'regression' });

    const prompt = formatAnnotationsForAgent(store.open('wt-1'), { title: 'Fix login' });
    expect(prompt).toContain('A reviewer left notes');
    expect(prompt).toContain('Task: Fix login');
    expect(prompt).toContain('## src/a.ts');
    expect(prompt).toContain('- line 30 (after): still wrong');
    expect(prompt).toContain('## src/b.ts');
    expect(prompt).toContain('- line 2 (before): regression');
    expect(prompt).not.toContain('already fixed');
    // Files are grouped, not interleaved.
    expect(prompt.indexOf('## src/a.ts')).toBeLessThan(prompt.indexOf('## src/b.ts'));

    expect(formatAnnotationsForAgent([])).toBe('');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});