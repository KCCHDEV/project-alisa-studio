import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  buildCliInvocation,
  requireCliAgent,
  resolveExecutable,
  type CliAgentDefinition,
} from '../core/cli-agents.ts';

export interface CliAgentCallbacks {
  onOutput: (chunk: string, stream: 'stdout' | 'stderr') => void;
}

export interface CliAgentRunOptions {
  agentId: string;
  /** Working directory; for an orchestrated agent this is the worktree path. */
  cwd: string;
  prompt: string;
  model?: string;
  /**
   * Mirrors the app's YOLO setting. When set, the agent receives the
   * unattended flags declared by its own CLI so it never blocks on a prompt
   * that nobody can answer.
   */
  yolo?: boolean;
  signal?: AbortSignal;
  callbacks: CliAgentCallbacks;
  /** Hard cap on the retained transcript so a chatty TUI cannot exhaust memory. */
  maxTranscriptBytes?: number;
  /** Kill the process when it produces nothing for this long. */
  idleTimeoutMs?: number;
}

export interface CliAgentResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  transcript: string;
  truncated: boolean;
  durationMs: number;
}

const DEFAULT_MAX_TRANSCRIPT_BYTES = 512 * 1024;
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_PROMPT_BYTES = 256 * 1024;
const GRACEFUL_KILL_MS = 1500;

interface ActiveProcess {
  child: ChildProcessWithoutNullStreams;
  timer?: ReturnType<typeof setTimeout>;
  killTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Runs an external coding CLI as a child process and streams its output.
 *
 * One instance per backend keeps every process reachable so an aborted run can
 * be terminated instead of leaking a detached agent.
 */
export class CliAgentRunner {
  private readonly processes = new Map<string, ChildProcessWithoutNullStreams>();
  private counter = 0;

  get activeCount(): number {
    return this.processes.size;
  }

  list(): string[] {
    return [...this.processes.keys()];
  }

  async run(options: CliAgentRunOptions): Promise<CliAgentResult> {
    const agent: CliAgentDefinition = requireCliAgent(options.agentId);
    const executable = resolveExecutable(agent.command);
    if (!executable) {
      throw new Error(`${agent.label} is not installed or not on PATH. Install it and reopen the app.`);
    }
    const prompt = options.prompt.trim();
    if (!prompt) throw new Error('Prompt is required');
    if (Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES) {
      throw new Error('Prompt is too large for a CLI agent');
    }
    if (!options.signal?.aborted === false && options.signal?.aborted) throw new Error('Run was cancelled');

    const invocation = buildCliInvocation(agent, {
      prompt,
      cwd: options.cwd,
      model: options.model,
      yolo: options.yolo === true,
    });
    const plan = buildSpawnPlan(invocation, executable);
    const startedAt = Date.now();
    const maxBytes = options.maxTranscriptBytes ?? DEFAULT_MAX_TRANSCRIPT_BYTES;
    const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;

    const key = `cli_${++this.counter}`;
    const record: ActiveProcess = { child: undefined as unknown as ChildProcessWithoutNullStreams };

    const child = spawn(plan.command, plan.args, {
      cwd: options.cwd,
      env: { ...process.env, ...agent.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      // Required for the hand-quoted cmd.exe line; without it the runtime
      // re-escapes the quotes and cmd cannot resolve the shim.
      windowsVerbatimArguments: plan.verbatimArgs,
    }) as ChildProcessWithoutNullStreams;
    record.child = child;
    this.processes.set(key, child);

    let transcript = '';
    let truncated = false;
    const append = (chunk: string, stream: 'stdout' | 'stderr') => {
      if (Buffer.byteLength(chunk, 'utf8') + Buffer.byteLength(transcript, 'utf8') <= maxBytes) {
        transcript += chunk;
      } else {
        transcript = `${transcript}${chunk}`.slice(0, maxBytes);
        truncated = true;
      }
      options.callbacks.onOutput(chunk, stream);
    };
    const refreshIdle = () => {
      if (!idleTimeoutMs) return;
      if (record.timer) clearTimeout(record.timer);
      record.timer = setTimeout(() => {
        append(`\n[${agent.label} produced no output for ${Math.round(idleTimeoutMs / 60000)} minutes and was stopped]\n`, 'stderr');
        terminate(record, 'idle timeout');
      }, idleTimeoutMs);
      record.timer.unref?.();
    };

    if (invocation.stdin !== undefined) {
      child.stdin.on('error', () => { /* The agent may exit before reading stdin. */ });
      const payload = plan.newlineTerminatedStdin ? `${invocation.stdin}\n` : invocation.stdin;
      writeStdinAndClose(child.stdin, payload);
    } else {
      child.stdin.end();
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { refreshIdle(); append(chunk, 'stdout'); });
    child.stderr.on('data', (chunk: string) => { refreshIdle(); append(chunk, 'stderr'); });
    refreshIdle();

    const onAbort = () => terminate(record, 'cancelled by user');
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const [exitCode, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve, reject) => {
        child.once('error', error => reject(error instanceof Error ? error : new Error(String(error))));
        child.once('close', (code, closeSignal) => resolve([code, closeSignal]));
      });
      return { exitCode, signal, transcript, truncated, durationMs: Date.now() - startedAt };
    } finally {
      if (record.timer) clearTimeout(record.timer);
      if (record.killTimer) clearTimeout(record.killTimer);
      options.signal?.removeEventListener('abort', onAbort);
      this.processes.delete(key);
    }
  }

  /** Terminate every running CLI agent, used when the backend shuts down. */
  stopAll(reason = 'Backend shutting down'): number {
    let count = 0;
    for (const child of this.processes.values()) {
      try {
        child.kill('SIGTERM');
        count += 1;
      } catch {
        // Already gone.
      }
    }
    this.processes.clear();
    return count;
  }
}

function terminate(record: ActiveProcess, reason: string) {
  try { record.child.stdin.end(); } catch { /* Already closing. */ }
  try { record.child.kill('SIGTERM'); } catch { /* Already gone. */ }
  if (record.killTimer) clearTimeout(record.killTimer);
  record.killTimer = setTimeout(() => {
    try { record.child.kill('SIGKILL'); } catch { /* Already gone. */ }
  }, GRACEFUL_KILL_MS);
  record.killTimer.unref?.();
  void reason;
}

/** Characters cmd.exe would reinterpret, so a prompt can never turn into a command. */
const CMD_UNSAFE = /[%!\r\n\0]/;

export interface SpawnPlan {
  command: string;
  args: string[];
  /** cmd shims read line-terminated stdin, so the prompt needs a trailing newline. */
  newlineTerminatedStdin: boolean;
  /** The command line is already quoted and must not be escaped again. */
  verbatimArgs: boolean;
}

/**
 * Windows cannot execute a `.cmd`/`.bat` shim directly (Node rejects it since the
 * CVE-2024-27980 fix), and `shell: true` does not escape arguments. The command
 * line is therefore assembled here with explicit quoting, and anything cmd would
 * reinterpret is rejected instead of silently mangled.
 */
export function buildSpawnPlan(
  invocation: { command: string; args: string[]; stdin?: string },
  resolvedPath: string,
  platform: NodeJS.Platform = process.platform,
): SpawnPlan {
  const isWindowsShim = platform === 'win32' && /\.(cmd|bat)$/i.test(resolvedPath);
  if (!isWindowsShim) {
    return { command: invocation.command, args: invocation.args, newlineTerminatedStdin: false, verbatimArgs: false };
  }

  const line = [quoteForCmd(resolvedPath), ...invocation.args.map(quoteForCmd)].join(' ');
  return {
    command: process.env.ComSpec || 'cmd.exe',
    // `/s` makes cmd strip exactly the outer pair of quotes, `/v:off` keeps `!`
    // literal, and `/d` skips AutoRun commands that could alter the environment.
    args: ['/d', '/v:off', '/s', '/c', `"${line}"`],
    newlineTerminatedStdin: invocation.stdin !== undefined,
    verbatimArgs: true,
  };
}

/**
 * Feed stdin and close it only once the bytes are actually flushed.
 *
 * `end(data)` alone races the reader: the pipe can reach EOF before the child
 * consumes the prompt, which silently gives the agent an empty task.
 */
export function writeStdinAndClose(
  stdin: { write: (chunk: string, encoding: BufferEncoding, callback: () => void) => unknown; end: () => unknown; once: (event: string, listener: () => void) => unknown },
  payload: string,
): void {
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    try { stdin.end(); } catch { /* The child may already be gone. */ }
  };
  const timer = setTimeout(finish, 2000);
  timer.unref?.();
  try {
    stdin.write(payload, 'utf8', finish);
  } catch {
    finish();
  }
}

export function quoteForCmd(value: string): string {
  if (CMD_UNSAFE.test(value)) {
    throw new Error('This CLI agent cannot be started on Windows because the command contains characters cmd.exe would reinterpret (%, !, or a line break).');
  }
  // Escape embedded quotes, then double any trailing backslashes so the closing
  // quote is not absorbed by the Windows command line parser.
  const escaped = value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  return `"${escaped}"`;
}