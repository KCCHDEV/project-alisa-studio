import { expect, test } from 'bun:test';
import { TerminalSessionManager, shellQuote, validateSshTarget } from '../src/server/terminal-sessions.ts';

test('local terminal sessions keep stdin open and stream output', async () => {
  const manager = new TerminalSessionManager({ shell: '/bin/bash', idleTimeoutMs: 10_000 });
  const output: string[] = [];
  let exitCode: number | null | undefined;
  let resolveExit!: () => void;
  const exited = new Promise<void>(resolve => { resolveExit = resolve; });
  const session = manager.start({ kind: 'local', cwd: process.cwd() }, {
    onOutput: (_id, data) => output.push(data),
    onExit: (_id, code) => { exitCode = code; resolveExit(); },
    onError: (_id, error) => { throw error; },
  });

  try {
    manager.write(session.id, 'printf "ALISA_LOCAL_TERMINAL_OK\\n"\nexit\n');
    await Promise.race([
      exited,
      new Promise((_, reject) => setTimeout(() => reject(new Error('terminal did not exit')), 4000)),
    ]);
    expect(output.join('')).toContain('ALISA_LOCAL_TERMINAL_OK');
    expect(exitCode).toBe(0);
  } finally {
    manager.disposeAll();
  }
});

test('ssh target validation blocks unsafe host and username input', () => {
  expect(() => validateSshTarget({ kind: 'ssh', host: 'host name', username: 'dev', port: 22 })).toThrow();
  expect(() => validateSshTarget({ kind: 'ssh', host: 'example.com', username: 'dev;rm', port: 22 })).toThrow();
  expect(shellQuote("/tmp/a'b")).toBe("'/tmp/a'\\''b'");
});
