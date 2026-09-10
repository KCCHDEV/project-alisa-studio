import { resolveWorkspacePath } from '../core/workspace';
import { z } from 'zod';
import { spawn } from 'child_process';
import type { ToolDefinition } from '../core/types.ts';
import { ASTSecurityGatekeeper } from '../core/security.ts';

const gatekeeper = new ASTSecurityGatekeeper();

export const TerminalInputSchema = z.object({
  command: z.string().describe('The bash/shell command to execute in the workspace'),
  timeout_s: z.number().min(1).max(300).optional().default(60).describe('Timeout in seconds (default 60s)'),
  workdir: z.string().optional().describe('Optional directory to execute command from'),
});

export type TerminalInput = z.infer<typeof TerminalInputSchema>;

export const terminalTool: ToolDefinition<z.input<typeof TerminalInputSchema>, { output: string; exitCode: number; durationMs: number }> = {
  name: 'terminal',
  description: 'Execute shell/bash commands safely on the local machine with real-time output and timeout protection.',
  parameters: TerminalInputSchema,
  requiresApproval: true,
  execute: async (args, context) => {
    // Audit command via AST Security Gatekeeper
    const audit = gatekeeper.auditTerminalCommand(args.command);
    if (!audit.allowed) {
      return {
        output: audit.reason || '[Security Policy] Command blocked by Security Gatekeeper',
        exitCode: 1,
        durationMs: 0,
      };
    }

    const startTime = Date.now();
    args = TerminalInputSchema.parse(args);
    context.signal?.throwIfAborted();
    const targetDir = resolveWorkspacePath(context.cwd, args.workdir || '.');
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? (process.env.ComSpec || 'cmd.exe') : '/bin/bash';
    const shellArgs = isWindows ? ['/d', '/s', '/c', args.command] : ['-c', args.command];

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let isDone = false;

      const proc = spawn(shell, shellArgs, {
        cwd: targetDir,
        env: { ...process.env, ...context.env },
        windowsHide: true,
        detached: !isWindows,
      });

      let stopReason = '';
      const stop = (reason: string) => {
        if (isDone || stopReason) return;
        stopReason = reason;
        if (isWindows && proc.pid) {
          const killer = spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
          killer.on('error', () => proc.kill());
        } else if (proc.pid) {
          try { process.kill(-proc.pid, 'SIGKILL'); } catch { proc.kill('SIGKILL'); }
        }
      };
      const onAbort = () => stop('Cancelled by user');
      context.signal?.addEventListener('abort', onAbort, { once: true });
      if (context.signal?.aborted) onAbort();
      const timer = setTimeout(() => stop(`Command timed out after ${args.timeout_s}s`), (args.timeout_s || 60) * 1000);
      const cleanup = () => {
        clearTimeout(timer);
        context.signal?.removeEventListener('abort', onAbort);
      };

      proc.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        if (stdout.length > 500000) {
          stdout = stdout.slice(-500000); // 500KB cap
        }
      });

      proc.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        if (stderr.length > 200000) {
          stderr = stderr.slice(-200000);
        }
      });

      proc.on('error', (err) => {
        if (!isDone) {
          isDone = true;
          cleanup();
          resolve({
            output: `Error spawning command: ${err.message}`,
            exitCode: 1,
            durationMs: Date.now() - startTime,
          });
        }
      });

      proc.on('close', (code) => {
        if (!isDone) {
          isDone = true;
          cleanup();
          const combined = (stdout + (stderr ? `\n[STDERR]\n${stderr}` : '')).trim();
          resolve({
            output: (stopReason ? `[${stopReason}]\n` : '') + (combined || '(Command produced no output)'),
            exitCode: stopReason ? -1 : (code ?? -1),
            durationMs: Date.now() - startTime,
          });
        }
      });
    });
  },
};
