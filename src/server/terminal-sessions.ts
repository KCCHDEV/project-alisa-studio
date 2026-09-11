import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type TerminalTarget =
  | { kind: 'local'; cwd: string }
  | {
      kind: 'ssh';
      host: string;
      username: string;
      port: number;
      identityFile?: string;
      remoteCwd?: string;
    };

export interface TerminalSessionInfo {
  id: string;
  kind: TerminalTarget['kind'];
  cwd?: string;
  host?: string;
  username?: string;
  port?: number;
  startedAt: number;
}

export interface TerminalSessionCallbacks {
  onOutput: (sessionId: string, data: string, stream: 'stdout' | 'stderr') => void;
  onExit: (sessionId: string, code: number | null, signal: NodeJS.Signals | null, reason?: string) => void;
  onError: (sessionId: string, error: Error) => void;
}

interface ManagedTerminalSession {
  info: TerminalSessionInfo;
  target: TerminalTarget;
  child: ChildProcessWithoutNullStreams;
  callbacks: TerminalSessionCallbacks;
  idleTimer?: ReturnType<typeof setTimeout>;
  ended: boolean;
  stopReason?: string;
}

const MAX_INPUT_BYTES = 64 * 1024;
const DEFAULT_MAX_SESSIONS = 8;
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

function shellQuote(value: string) {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function validSshHost(value: string) {
  return value.length > 0 && value.length <= 253 && /^[A-Za-z0-9_.:-]+$/.test(value);
}

function validSshUsername(value: string) {
  return value.length > 0 && value.length <= 128 && /^[A-Za-z0-9._-]+$/.test(value);
}

function validateSshTarget(target: Extract<TerminalTarget, { kind: 'ssh' }>) {
  if (!validSshHost(target.host)) throw new Error('SSH host contains unsupported characters');
  if (!validSshUsername(target.username)) throw new Error('SSH username contains unsupported characters');
  if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535) throw new Error('SSH port must be between 1 and 65535');
  if (target.remoteCwd && target.remoteCwd.length > 4096) throw new Error('Remote working directory is too long');
  if (target.identityFile) {
    if (!path.isAbsolute(target.identityFile)) throw new Error('SSH identity file must be an absolute path');
    try {
      if (!fs.statSync(target.identityFile).isFile()) throw new Error('SSH identity path is not a file');
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'SSH identity file was not found');
    }
  }
}

export class TerminalSessionManager {
  private readonly sessions = new Map<string, ManagedTerminalSession>();
  private readonly maxSessions: number;
  private readonly idleTimeoutMs: number;
  private readonly shell?: string;

  constructor(options: { maxSessions?: number; idleTimeoutMs?: number; shell?: string } = {}) {
    this.maxSessions = Math.max(1, options.maxSessions ?? DEFAULT_MAX_SESSIONS);
    this.idleTimeoutMs = Math.max(0, options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS);
    this.shell = options.shell;
  }

  start(target: TerminalTarget, callbacks: TerminalSessionCallbacks): TerminalSessionInfo {
    if (this.sessions.size >= this.maxSessions) throw new Error(`Only ${this.maxSessions} terminal sessions can be open at once`);

    let command: string;
    let args: string[];
    let cwd: string | undefined;
    let env: NodeJS.ProcessEnv = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
    if (target.kind === 'local') {
      if (!path.isAbsolute(target.cwd)) throw new Error('Local terminal working directory must be absolute');
      if (!fs.existsSync(target.cwd) || !fs.statSync(target.cwd).isDirectory()) throw new Error('Local terminal working directory was not found');
      const shell = this.shell || (process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL || '/bin/bash'));
      if (process.platform !== 'win32') {
        env = { ...env, TERM: 'dumb', COLORTERM: '' };
        const script = ['/usr/bin/script', '/bin/script'].find(candidate => fs.existsSync(candidate));
        const shellName = path.basename(shell).toLowerCase();
        const interactiveArgs = shellName === 'fish'
          ? ['--no-config', '-i']
          : shellName === 'zsh'
            ? ['-f', '-i']
            : shellName === 'bash'
              ? ['--noprofile', '--norc', '-i']
              : ['-i'];
        if (script) {
          // util-linux `script` gives the local shell a real PTY, which keeps
          // fish/zsh line editing, prompts, colors, and interactive commands working.
          // Startup files are skipped because some configs wait for responses
          // from a real terminal emulator during their greeting sequence.
          command = script;
          // `script` evaluates -c through $SHELL. Force a predictable POSIX
          // command runner; otherwise a fish $SHELL treats the command as a
          // fish `-c` script and swallows interactive stdin.
          // There is no full terminal emulator on the frontend yet. `dumb`
          // prevents shell startup probes (kitty/OSC/terminfo queries) from
          // blocking a piped PTY while the app still keeps a real PTY for I/O.
          env = { ...env, SHELL: '/bin/sh', TERM: 'dumb', COLORTERM: '' };
          args = ['-qefc', `SHELL=${shellQuote(shell)} exec ${shellQuote(shell)} ${interactiveArgs.map(shellQuote).join(' ')}`, '/dev/null'];
        } else {
          command = shell;
          args = interactiveArgs;
        }
      } else {
        command = shell;
        args = ['/Q'];
      }
      cwd = target.cwd;
    } else {
      validateSshTarget(target);
      env = { ...env, TERM: 'dumb', COLORTERM: '' };
      command = process.platform === 'win32' ? (process.env.ComSpec || 'ssh.exe') : 'ssh';
      args = [
        '-tt',
        '-o', 'RequestTTY=force',
        '-o', 'ConnectTimeout=12',
        '-o', 'ServerAliveInterval=30',
        '-o', 'ServerAliveCountMax=3',
        '-p', String(target.port),
      ];
      if (target.identityFile) args.push('-i', target.identityFile);
      args.push(`${target.username}@${target.host}`);
      if (target.remoteCwd) args.push(`cd -- ${shellQuote(target.remoteCwd)} && exec "${'${SHELL:-/bin/sh}'}" -il`);
    }

    const id = randomUUID();
    const info: TerminalSessionInfo = {
      id,
      kind: target.kind,
      cwd: target.kind === 'local' ? target.cwd : target.remoteCwd,
      host: target.kind === 'ssh' ? target.host : undefined,
      username: target.kind === 'ssh' ? target.username : undefined,
      port: target.kind === 'ssh' ? target.port : undefined,
      startedAt: Date.now(),
    };
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Unable to start terminal process');
    }

    const session: ManagedTerminalSession = { info, target, child, callbacks, ended: false };
    this.sessions.set(id, session);
    this.refreshIdleTimer(session);

    child.stdout.on('data', chunk => {
      this.refreshIdleTimer(session);
      callbacks.onOutput(id, chunk.toString(), 'stdout');
    });
    child.stderr.on('data', chunk => {
      this.refreshIdleTimer(session);
      callbacks.onOutput(id, chunk.toString(), 'stderr');
    });
    child.once('error', error => {
      if (session.ended) return;
      session.ended = true;
      this.remove(id);
      callbacks.onError(id, error instanceof Error ? error : new Error(String(error)));
    });
    child.once('exit', (code, signal) => {
      if (session.ended) return;
      session.ended = true;
      this.remove(id);
      callbacks.onExit(id, code, signal, session.stopReason);
    });
    return info;
  }

  write(id: string, data: string) {
    const session = this.sessions.get(id);
    if (!session || session.ended) throw new Error('Terminal session is no longer active');
    if (Buffer.byteLength(data, 'utf8') > MAX_INPUT_BYTES) throw new Error('Terminal input is too large');
    this.refreshIdleTimer(session);
    session.child.stdin.write(data);
  }

  stop(id: string, reason = 'Stopped by user') {
    const session = this.sessions.get(id);
    if (!session || session.ended) return false;
    session.stopReason = reason;
    try { session.child.stdin.end(); } catch { /* Process may already be closing. */ }
    try { session.child.kill('SIGTERM'); } catch { /* Process may already be gone. */ }
    const forceTimer = setTimeout(() => {
      if (!session.ended) {
        try { session.child.kill('SIGKILL'); } catch { /* Process may already be gone. */ }
      }
    }, 800);
    forceTimer.unref?.();
    return true;
  }

  disposeAll() {
    for (const session of this.sessions.values()) {
      session.stopReason = 'Connection closed';
      session.ended = true;
      try { session.child.kill('SIGKILL'); } catch { /* Process may already be gone. */ }
      this.remove(session.info.id);
    }
  }

  private refreshIdleTimer(session: ManagedTerminalSession) {
    if (!this.idleTimeoutMs) return;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => this.stop(session.info.id, 'Terminal idle timeout'), this.idleTimeoutMs);
    session.idleTimer.unref?.();
  }

  private remove(id: string) {
    const session = this.sessions.get(id);
    if (!session) return;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    this.sessions.delete(id);
  }
}

export { shellQuote, validateSshTarget };
