import { test, expect } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { resolveWorkspacePath } from '../src/core/workspace';
import { SessionStore } from '../src/server/sessions';
import { ContextCompactor } from '../src/core/compactor';
import { ContextManager } from '../src/core/context';
import { terminalTool } from '../src/tools/terminal';
import { FileTransactionManager } from '../src/core/snapshot';
import { patchFileTool } from '../src/tools/file-ops';

test('workspace rejects traversal and junction escape, including newly created paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alisa-path-'));
  try {
    fs.mkdirSync(path.join(root, 'project')); fs.mkdirSync(path.join(root, 'outside'));
    fs.symlinkSync(path.join(root, 'outside'), path.join(root, 'project', 'link'), 'junction');
    expect(() => resolveWorkspacePath(path.join(root, 'project'), '../outside/secret')).toThrow();
    expect(() => resolveWorkspacePath(path.join(root, 'project'), 'link/new/file')).toThrow();
    expect(resolveWorkspacePath(path.join(root, 'project'), 'new/file')).toBe(path.join(root, 'project/new/file'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('new chats preserve history, survive restart and are scoped to their project', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alisa-sessions-'));
  try {
    const store = new SessionStore(root);
    const first = store.get('project-a');
    first.messages.push({ id: 'u1', role: 'user', content: 'Fix a bug', timestamp: 1 });
    store.save(first);
    const second = store.create('project-a');
    expect(second.messages).toEqual([]);
    expect(new SessionStore(root).get('project-a', first.id).messages).toHaveLength(1);
    expect(() => store.get('project-b', first.id)).toThrow();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('compaction does not orphan tool results', () => {
  const messages: any[] = [{ id: 'user', role: 'user', content: 'goal', timestamp: 0 }];
  for (let i = 0; i < 12; i++) {
    messages.push({ id: `a${i}`, role: 'assistant', content: '', tool_calls: [{ id: `t${i}`, type: 'function', function: { name: 'read', arguments: '{}' } }], timestamp: i });
    messages.push({ id: `r${i}`, role: 'tool', tool_call_id: `t${i}`, content: 'x'.repeat(100), timestamp: i });
  }
  const result = new ContextCompactor({ maxCharBudget: 100, preserveFirstN: 2, preserveLastN: 5 }).compactMessages(messages);
  for (let i = 0; i < result.compacted.length; i++) {
    const m = result.compacted[i];
    if (m.role === 'tool') expect(result.compacted.slice(0, i).some(a => a.tool_calls?.some(tc => tc.id === m.tool_call_id))).toBe(true);
    for (const tc of m.tool_calls || []) expect(result.compacted.some(r => r.tool_call_id === tc.id)).toBe(true);
  }
});

test('interrupted persisted tool calls receive an explicit recovery result before the next user turn', () => {
  const context = new ContextManager();
  const messages = context.prepareMessages([
    { id: 'a', role: 'assistant', content: '', timestamp: 1, tool_calls: [{ id: 'pending', type: 'function', function: { name: 'write_file', arguments: '{}' } }] },
    { id: 'u', role: 'user', content: 'Continue', timestamp: 2 },
  ]);
  expect(messages[2].tool_call_id).toBe('pending');
  expect(messages[2].content).toContain('side effects are unknown');
  expect(messages[3].content).toBe('Continue');
});

test('abort terminates a running terminal process without waiting for its timeout', async () => {
  const controller = new AbortController();
  const start = Date.now();
  const run = terminalTool.execute({ command: process.platform === 'win32' ? 'ping -n 30 127.0.0.1' : 'sleep 30', timeout_s: 40 }, { cwd: process.cwd(), sessionId: 'test', env: {}, emitEvent() {}, signal: controller.signal });
  setTimeout(() => controller.abort(), 150);
  const result = await run;
  expect(result.exitCode).toBe(-1);
  expect(result.output).toContain('Cancelled');
  expect(Date.now() - start).toBeLessThan(5000);
});

test('rollback survives restart and refuses to overwrite later user edits', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alisa-rollback-'));
  try {
    const file = path.join(root, 'file.txt');
    fs.writeFileSync(file, 'original');
    await new FileTransactionManager(root).writeFile(file, 'agent edit');
    const restored = new FileTransactionManager(root);
    fs.writeFileSync(file, 'user edit');
    expect((await restored.rollbackLatest()).success).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe('user edit');
    fs.writeFileSync(file, 'agent edit');
    expect((await restored.rollbackLatest()).success).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('original');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('patch refuses ambiguous edits and preserves Windows line endings', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alisa-patch-'));
  try {
    const file = path.join(root, 'file.txt'); fs.writeFileSync(file, 'same\r\nsame\r\nend\r\n');
    const context = { cwd: root, sessionId: 'test', env: {}, emitEvent() {} };
    await expect(patchFileTool.execute({ path: 'file.txt', old_string: 'same', new_string: 'new' }, context)).rejects.toThrow('Multiple matches');
    await patchFileTool.execute({ path: 'file.txt', old_string: 'same\nend', new_string: 'changed\nend' }, context);
    expect(fs.readFileSync(file, 'utf8')).toBe('same\r\nchanged\r\nend\r\n');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
