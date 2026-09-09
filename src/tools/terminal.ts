import { z } from 'zod';
import { spawn } from 'child_process';
import type { ToolDefinition } from '../core/types.ts';
import { ASTSecurityGatekeeper } from '../core/security.ts';

const gatekeeper = new ASTSecurityGatekeeper();

export const TerminalInputSchema = z.object({
  command: z.string().describe('The bash/shell command to execute in the workspace'),
  timeout_s: z.number().optional().default(60).describe('Timeout in seconds (default 60s)'),
  workdir: z.string().optional().describe('Optional directory to execute command from'),
});

export type TerminalInput = z.infer<typeof TerminalInputSchema>;

export const terminalTool: ToolDefinition<z.input<typeof TerminalInputSchema>, { output: string; exitCode: number; durationMs: number }> = {
  name: 'terminal',
  description: 'Execute shell/bash commands safely on the local machine with real-time output and timeout protection.',
  parameters: TerminalInputSchema,
  requiresApproval: false,
  execute: async (args, context) => {
    // Audit command via AST Security Gatekeeper
    const audit = gatekeeper.auditTerminalCommand(args.command);
    if (!audit.allowed) {
      return {
        output: audit.reason || '🛡️ Command blocked by Security Gatekeeper',
        exitCode: 1,
        durationMs: 0,
      };
    }

    const startTime = Date.now();
    const targetDir = args.workdir || context.cwd;
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
      });

      const timer = setTimeout(() => {
        if (!isDone) {
          isDone = true;
          try {
            proc.kill();
          } catch {}
          resolve({
            output: `[Command timed out after ${args.timeout_s}s]\n${stdout}\n${stderr}`.trim(),
            exitCode: -1,
            durationMs: Date.now() - startTime,
          });
        }
      }, (args.timeout_s || 60) * 1000);

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
          clearTimeout(timer);
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
          clearTimeout(timer);
          const combined = (stdout + (stderr ? `\n[STDERR]\n${stderr}` : '')).trim();
          resolve({
            output: combined || '(Command produced no output)',
            exitCode: code ?? 0,
            durationMs: Date.now() - startTime,
          });
        }
      });
    });
  },
};
