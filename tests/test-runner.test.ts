import { test, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { parseBunTestOutput, parseTypecheckOutput, summarizeVerification, verificationCommands, type VerificationResult } from '../src/core/test-runner.ts';

test('parses the bun test summary counters', () => {
  const output = [
    'bun test v1.4.2',
    '',
    ' 12 pass',
    ' 2 fail',
    ' 1 skip',
    ' 93 expect() calls',
    'Ran 14 tests across 3 files. [1.20s]',
  ].join('\n');
  const parsed = parseBunTestOutput(output);
  expect(parsed.passedCount).toBe(12);
  expect(parsed.failedCount).toBe(2);
  expect(parsed.total).toBe(14);
});

test('collects failing test names with their durations', () => {
  const output = [
    '(fail) the runner really passes YOLO flags [199.33ms]',
    '(fail) resolveExecutable finds a real binary',
    ' 88 pass',
    ' 2 fail',
  ].join('\n');
  const parsed = parseBunTestOutput(output);
  expect(parsed.failures).toHaveLength(2);
  expect(parsed.failures[0]).toEqual({ name: 'the runner really passes YOLO flags', durationMs: 199.33 });
  expect(parsed.failures[1]!.name).toBe('resolveExecutable finds a real binary');
  expect(parsed.failures[1]!.durationMs).toBeUndefined();
});

test('ignores lines that only look like counters', () => {
  const parsed = parseBunTestOutput('Ran 5 tests across 1 file.\nexecuted 3 pass 9 fail statements in 1s');
  expect(parsed.failedCount).toBeUndefined();
  expect(parsed.passedCount).toBeUndefined();
  expect(parsed.failures).toEqual([]);
});

test('typecheck output yields compiler errors only', () => {
  const output = [
    'src/a.ts(3,5): error TS2322: Type string is not assignable to number.',
    'src/b.ts(9,1): error TS2345: Argument type mismatch.',
    'Found 2 errors in 2 files.',
  ].join('\n');
  expect(parseTypecheckOutput(output)).toEqual([
    'src/a.ts(3,5): error TS2322: Type string is not assignable to number.',
    'src/b.ts(9,1): error TS2345: Argument type mismatch.',
  ]);
  expect(parseTypecheckOutput('')).toEqual([]);
  expect(parseTypecheckOutput('all good')).toEqual([]);
});

test("verification commands prefer the project's own test runner", () => {
  // No script: fall back to Bun's runner.
  expect(verificationCommands({})).toEqual([{ kind: 'test', command: 'bun', args: ['test'] }]);
  // A project using vitest or jest must not be verified with `bun test`.
  expect(verificationCommands({ test: 'vitest run' })).toEqual([{ kind: 'test', command: 'bun', args: ['run', 'test'] }]);
  expect(verificationCommands({ typecheck: 'tsc --noEmit', build: 'x' })).toEqual([
    { kind: 'test', command: 'bun', args: ['test'] },
    { kind: 'typecheck', command: 'bun', args: ['run', 'typecheck'] },
  ]);
  expect(verificationCommands({ typecheck: 'tsc --noEmit', build: 'x' }, true)).toHaveLength(3);
});

/** Minimal stand-in for a child process so no real command runs in tests. */
function fakeSpawn(exitCode: number | null, stdout = '', stderr = '') {
  const calls: Array<{ command: string; args: string[]; options: any }> = [];
  const spawnFn = ((command: string, args: string[], options: any) => {
    calls.push({ command, args, options });
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setTimeout(() => {
      if (stdout) child.stdout.emit('data', stdout);
      if (stderr) child.stderr.emit('data', stderr);
      child.emit('close', exitCode);
    }, 5);
    return child;
  }) as any;
  return { spawnFn, calls };
}

test('a failing run becomes data instead of an exception', async () => {
  const { spawnFn, calls } = fakeSpawn(1, ' 3 pass\n 1 fail\n(fail) broken thing [10ms]\nRan 4 tests across 1 file.\n');
  const { runVerification } = await import('../src/core/test-runner.ts');
  const result = await runVerification('test', { cwd: process.cwd(), spawnFn }, { kind: 'test', command: 'bun', args: ['test'] });

  expect(result.passed).toBe(false);
  expect(result.exitCode).toBe(1);
  expect(result.failedCount).toBe(1);
  expect(result.failures[0]!.name).toBe('broken thing');
  expect(result.timedOut).toBe(false);
  // Colour codes are disabled so the model reads clean text.
  expect(calls[0]!.options.env.FORCE_COLOR).toBe('0');
});

test('a passing run is recognised', async () => {
  const { spawnFn } = fakeSpawn(0, ' 9 pass\n 0 fail\nRan 9 tests across 2 files.\n');
  const { runVerification } = await import('../src/core/test-runner.ts');
  const result = await runVerification('test', { cwd: process.cwd(), spawnFn }, { kind: 'test', command: 'bun', args: ['test'] });
  expect(result.passed).toBe(true);
  expect(result.failedCount).toBe(0);
  expect(result.failures).toEqual([]);
});

test('a command that cannot start reports an error rather than hanging', async () => {
  const { spawnFn } = fakeSpawn(null);
  const spawnThatThrows = ((command: string) => { throw new Error('ENOENT'); }) as any;
  const { runVerification } = await import('../src/core/test-runner.ts');
  const result = await runVerification('test', { cwd: process.cwd(), spawnFn: spawnThatThrows }, { kind: 'test', command: 'nope', args: [] });
  expect(result.passed).toBe(false);
  expect(result.error).toContain('ENOENT');
  expect(result.durationMs).toBeGreaterThanOrEqual(0);
  void spawnFn;
});

test('the transcript is capped and keeps the tail where failures live', async () => {
  const noisy = 'x'.repeat(5000);
  const { spawnFn } = fakeSpawn(1, `${noisy}\n(fail) the important one\n`);
  const { runVerification } = await import('../src/core/test-runner.ts');
  const result = await runVerification('test', { cwd: process.cwd(), spawnFn, maxOutputBytes: 1000 }, { kind: 'test', command: 'bun', args: ['test'] });
  expect(result.output.length).toBeLessThan(6000);
  expect(result.output).toContain('characters omitted');
  expect(result.output).toContain('the important one');
});

test('a run that exceeds its budget is reported as a timeout without waiting for the process to die', async () => {
  const { runVerification } = await import('../src/core/test-runner.ts');
  let killed = false;
  const neverCloses = (() => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { killed = true; };
    return child;
  }) as any;
  const startedAt = Date.now();
  const result = await runVerification('test', { cwd: process.cwd(), spawnFn: neverCloses, timeoutMs: 40 }, { kind: 'test', command: 'bun', args: ['test'] });
  expect(result.timedOut).toBe(true);
  expect(result.passed).toBe(false);
  expect(result.error).toContain('Timed out');
  expect(killed).toBe(true);
  // The kill was attempted and the result did not wait for `close`.
  expect(Date.now() - startedAt).toBeLessThan(3000);
});

test('a cancelled run stops immediately', async () => {
  const { runVerification } = await import('../src/core/test-runner.ts');
  const controller = new AbortController();
  const neverCloses = (() => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    return child;
  }) as any;
  const pending = runVerification('test', { cwd: process.cwd(), spawnFn: neverCloses, signal: controller.signal }, { kind: 'test', command: 'bun', args: ['test'] });
  controller.abort();
  const result = await pending;
  expect(result.error).toBe('Cancelled');
  expect(result.passed).toBe(false);
});

function baseResult(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    kind: 'test',
    passed: false,
    exitCode: 1,
    durationMs: 1200,
    total: 10,
    passedCount: 8,
    failedCount: 2,
    failures: [{ name: 'first failure' }, { name: 'second failure' }],
    output: '',
    timedOut: false,
    ...overrides,
  };
}

test('the summary names the failing tests so the coordinator can act', () => {
  const summary = summarizeVerification(baseResult());
  expect(summary).toContain('FAILED');
  expect(summary).toContain('8 passed');
  expect(summary).toContain('2 failed');
  expect(summary).toContain('- first failure');
  expect(summary).toContain('- second failure');
});

test('the summary stays small even with many failures', () => {
  const failures = Array.from({ length: 40 }, (_, index) => ({ name: `failure ${index}` }));
  const summary = summarizeVerification(baseResult({ failures }));
  expect(summary).toContain('… and 15 more');
  expect(summary).not.toContain('failure 39');
  expect(summary.split('\n').length).toBeLessThan(35);
});

test('a passing summary says so without noise', () => {
  const summary = summarizeVerification(baseResult({ passed: true, failedCount: 0, failures: [], passedCount: 10 }));
  expect(summary).toContain('PASSED');
  expect(summary).toContain('10 passed');
  expect(summary).not.toContain('Failing tests');
});

test('timeouts and unrunnable commands are called out plainly', () => {
  expect(summarizeVerification(baseResult({ timedOut: true }))).toContain('TIMED OUT');
  expect(summarizeVerification(baseResult({ error: 'ENOENT' }))).toContain('could not run (ENOENT)');
});

test('an unmodelled failure still shows the log tail', () => {
  const summary = summarizeVerification(baseResult({ kind: 'build', output: 'line1\nline2\nerror: cannot bundle\nat build' }));
  expect(summary).toContain('Output tail:');
  expect(summary).toContain('cannot bundle');
});

test('typecheck failures list the compiler errors', () => {
  const output = 'src/x.ts(1,1): error TS1000: bad thing';
  const summary = summarizeVerification(baseResult({ kind: 'typecheck', output }));
  expect(summary).toContain('Compiler errors:');
  expect(summary).toContain('TS1000');
});