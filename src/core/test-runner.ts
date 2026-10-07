import { spawn } from 'node:child_process';

export type VerificationKind = 'test' | 'typecheck' | 'build';

export interface VerificationCommand {
  kind: VerificationKind;
  command: string;
  args: string[];
}

export interface TestFailure {
  name: string;
  durationMs?: number;
  error?: string;
}

export interface VerificationResult {
  kind: VerificationKind;
  passed: boolean;
  exitCode: number | null;
  durationMs: number;
  total?: number;
  passedCount?: number;
  failedCount?: number;
  failures: TestFailure[];
  /** Truncated output, newest tail kept because that is where failures live. */
  output: string;
  /** True when the run was killed for exceeding its time budget. */
  timedOut: boolean;
  error?: string;
}

const DEFAULT_TIMEOUTS: Record<VerificationKind, number> = {
  test: 5 * 60 * 1000,
  typecheck: 3 * 60 * 1000,
  build: 8 * 60 * 1000,
};

/**
 * Verification commands for a project.
 *
 * The project's own `test` script wins, because a project using vitest or jest
 * must not be verified with `bun test`. Only when no script exists does this fall
 * back to Bun's runner.
 */
export function verificationCommands(scripts: Record<string, string> = {}, includeBuild = false): VerificationCommand[] {
  const commands: VerificationCommand[] = [
    scripts.test
      ? { kind: 'test', command: 'bun', args: ['run', 'test'] }
      : { kind: 'test', command: 'bun', args: ['test'] },
  ];
  if (scripts.typecheck) commands.push({ kind: 'typecheck', command: 'bun', args: ['run', 'typecheck'] });
  if (includeBuild && scripts.build) commands.push({ kind: 'build', command: 'bun', args: ['run', 'build'] });
  return commands;
}

const FAIL_LINE = /^\s*\(fail\)\s+(.+?)\s*(?:\[(\d+(?:\.\d+)?)ms\])?\s*$/;
const COUNT_LINE = /^\s*(\d+)\s+(pass|fail|skip|todo)\s*$/;
const RAN_LINE = /Ran\s+(\d+)\s+tests?/i;

/**
 * Parse `bun test` output.
 *
 * Only summary counters and failing test names are trusted; the raw log is kept
 * as-is because failure detail lives in interleaved trace output that would be
 * unreliable to reconstruct.
 */
export function parseBunTestOutput(output: string): {
  total?: number;
  passedCount?: number;
  failedCount?: number;
  failures: TestFailure[];
} {
  const failures: TestFailure[] = [];
  let passedCount: number | undefined;
  let failedCount: number | undefined;
  let total: number | undefined;

  for (const raw of output.split(/\r?\n/)) {
    const fail = FAIL_LINE.exec(raw);
    if (fail) {
      failures.push({
        name: fail[1]!.trim(),
        durationMs: fail[2] ? Number(fail[2]) : undefined,
      });
      continue;
    }
    const ran = RAN_LINE.exec(raw);
    if (ran) {
      total = Number(ran[1]);
      continue;
    }
    const count = COUNT_LINE.exec(raw);
    if (count) {
      const value = Number(count[1]);
      if (count[2] === 'pass') passedCount = value;
      if (count[2] === 'fail') failedCount = value;
    }
  }

  return { total, passedCount, failedCount, failures };
}

/**
 * Pull the compiler errors out of a `tsc` run.
 *
 * `tsc --noEmit` prints one `file(line,col): error TSxxxx: message` per problem,
 * which is exactly the shape a worker needs to act on.
 */
export function parseTypecheckOutput(output: string): string[] {
  const errors: string[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/error TS\d+/.test(line)) errors.push(line);
  }
  return errors;
}

function tail(value: string, maxBytes: number): string {
  if (value.length <= maxBytes) return value;
  return `… ${value.length - maxBytes} characters omitted …\n${value.slice(-maxBytes)}`;
}

export interface RunVerificationOptions {
  cwd: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxOutputBytes?: number;
  /** Injected in tests; defaults to spawning the real command. */
  spawnFn?: typeof spawn;
}

/**
 * Run one verification command and return a structured verdict.
 *
 * Never throws: a failing check is data the coordinator reasons about, not an
 * exception that should tear down the run.
 */
export async function runVerification(
  kind: VerificationKind,
  options: RunVerificationOptions,
  command: VerificationCommand,
): Promise<VerificationResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUTS[kind];
  const maxBytes = options.maxOutputBytes ?? 64 * 1024;
  const startedAt = Date.now();
  const spawnProcess = options.spawnFn ?? spawn;

  return new Promise<VerificationResult>(resolve => {
    let output = '';
    let timedOut = false;
    let settled = false;
    let child: ReturnType<typeof spawn>;

    const finish = (exitCode: number | null, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);

      const parsed = kind === 'test'
        ? parseBunTestOutput(output)
        : { total: undefined, passedCount: undefined, failedCount: parseTypecheckOutput(output).length || undefined, failures: [] as TestFailure[] };

      resolve({
        kind,
        passed: !error && exitCode === 0,
        exitCode,
        durationMs: Date.now() - startedAt,
        total: parsed.total,
        passedCount: parsed.passedCount,
        failedCount: parsed.failedCount,
        failures: parsed.failures,
        output: tail(output, maxBytes),
        timedOut,
        error,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* Already gone. */ }
      // Resolve now instead of waiting for `close`: a process that ignores the
      // kill would otherwise hang the run forever despite the time budget.
      finish(null, `Timed out after ${Math.round(timeoutMs / 1000)}s`);
    }, timeoutMs);
    timer.unref?.();

    const onAbort = () => {
      try { child.kill('SIGKILL'); } catch { /* Already gone. */ }
      finish(null, 'Cancelled');
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      child = spawnProcess(command.command, command.args, {
        cwd: options.cwd,
        env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      finish(null, error instanceof Error ? error.message : String(error));
      return;
    }

    // `setEncoding` is absent on some stream implementations, and decoding
    // Buffer chunks here avoids depending on it.
    const decode = (chunk: unknown): string =>
      typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    child.stdout?.setEncoding?.('utf8');
    child.stderr?.setEncoding?.('utf8');
    // Cap accumulation so a runaway build cannot exhaust memory; the tail is
    // what carries the failure detail anyway.
    const append = (chunk: unknown) => {
      output += decode(chunk);
      if (output.length > maxBytes * 4) output = output.slice(-maxBytes * 2);
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.once('error', error => finish(null, error instanceof Error ? error.message : String(error)));
    child.once('close', code => finish(code));
  });
}

/** Compact, model-friendly summary. Full logs stay out of the context budget. */
export function summarizeVerification(result: VerificationResult): string {
  if (result.timedOut) return `${result.kind}: TIMED OUT after ${Math.round(result.durationMs / 1000)}s`;
  if (result.error) return `${result.kind}: could not run (${result.error})`;

  const parts = [`${result.kind}: ${result.passed ? 'PASSED' : 'FAILED'}`];
  if (result.passedCount !== undefined) parts.push(`${result.passedCount} passed`);
  if (result.failedCount) parts.push(`${result.failedCount} failed`);
  if (result.total !== undefined) parts.push(`of ${result.total} total`);

  if (result.failures.length) {
    parts.push('', 'Failing tests:');
    for (const failure of result.failures.slice(0, 25)) parts.push(`- ${failure.name}`);
    if (result.failures.length > 25) parts.push(`… and ${result.failures.length - 25} more`);
  }

  const typecheckErrors = parseTypecheckOutput(result.output);
  if (result.kind === 'typecheck' && typecheckErrors.length) {
    parts.push('', 'Compiler errors:');
    for (const error of typecheckErrors.slice(0, 25)) parts.push(`- ${error}`);
  } else if (!result.passed && result.output.trim()) {
    // Last resort for failures the parsers do not model (build errors, for
    // example): surface the tail of the log rather than nothing.
    parts.push('', 'Output tail:', result.output.trim().split(/\r?\n/).slice(-25).join('\n'));
  }

  return parts.join('\n');
}