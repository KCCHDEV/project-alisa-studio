import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Catalogue of external coding CLIs the orchestrator can drive.
 *
 * Each entry knows how to turn a prompt into a **non-interactive** invocation.
 * Interactive TUIs need a real PTY and are intentionally out of scope here, so
 * every definition below must work with piped stdio.
 */
export interface CliAgentDefinition {
  id: string;
  label: string;
  /** Executable name, resolved through PATH. */
  command: string;
  docsUrl: string;
  /** Build the argument list for a one-shot run. */
  buildArgs: (prompt: string, options: { model?: string; cwd: string }) => string[];
  /**
   * Some CLIs accept very long prompts more reliably on stdin than through argv
   * (Windows caps a command line at ~32k characters).
   */
  promptOnStdin?: boolean;
  /**
   * Flags that let the agent run unattended, used when the app's YOLO mode is
   * on. Only flags confirmed in that CLI's own `--help` belong here, because a
   * wrong flag aborts the whole run instead of degrading quietly.
   */
  yoloArgs?: string[];
  /**
   * Which help output declares the YOLO flags.
   *
   * Some CLIs document permissions on the root command while documenting the
   * prompt flags on the subcommand, so the default (probe the subcommand) is not
   * always right.
   */
  yoloHelpArgs?: string[];
  /** Environment overrides applied on top of the inherited environment. */
  env?: Record<string, string>;
}

function withModel(args: string[], flag: string, model?: string): string[] {
  const trimmed = model?.trim();
  return trimmed ? [...args, flag, trimmed] : args;
}

export const CLI_AGENTS: CliAgentDefinition[] = [
  {
    id: 'opencode',
    label: 'OpenCode',
    command: 'opencode',
    docsUrl: 'https://opencode.ai/docs/cli/',
    // `opencode run [flags] [<message...>]` takes the message as a positional
    // argument and has no stdin mode, so the prompt has to stay in argv.
    buildArgs: (prompt, { model }) => withModel(['run'], '--model', model).concat(prompt),
    // Verified against `opencode run --help`: auto-approves anything the config
    // does not explicitly deny. Without it an unattended run blocks forever on a
    // permission prompt.
    yoloArgs: ['--auto'],
  },
  {
    id: 'claude',
    label: 'Claude Code',
    command: 'claude',
    docsUrl: 'https://docs.anthropic.com/en/docs/claude-code',
    // `-p` prints the result and reads the prompt from stdin, which keeps very
    // long prompts off the Windows command line.
    // Source: Anthropic docs and academy.claude.com permission-modes guide
    // ("Bypass permissions ... equivalent to the dangerously-skip-permissions
    // flag").
    buildArgs: (_prompt, { model }) => withModel(['-p', '--output-format', 'stream-json', '--verbose'], '--model', model),
    promptOnStdin: true,
    yoloArgs: ['--dangerously-skip-permissions'],
  },
  {
    id: 'codex',
    label: 'Codex',
    command: 'codex',
    docsUrl: 'https://github.com/openai/codex',
    // `codex exec` falls back to stdin when no prompt argument is given.
    buildArgs: (_prompt, { model }) => withModel(['exec', '--skip-git-repo-check'], '--model', model),
    promptOnStdin: true,
    // `--full-auto` does not exist in this CLI. The flags that are real:
    // `--ask-for-approval never` stops it asking for confirmation, while
    // `workspace-write` keeps writes confined to the checkout it was handed.
    // The nuclear `--dangerously-bypass-approvals-and-sandbox` is not used.
    yoloArgs: ['--ask-for-approval', 'never', '--sandbox', 'workspace-write'],
    // Codex documents permissions on the root command, not on `codex exec`.
    yoloHelpArgs: [],
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    command: 'gemini',
    docsUrl: 'https://github.com/google-gemini/gemini-cli',
    // Source: geminicli.com/docs/reference/configuration ("YOLO mode ... can only be
    // enabled via command line").
    buildArgs: (_prompt, { model }) => withModel([], '-m', model),
    promptOnStdin: true,
    yoloArgs: ['--yolo'],
  },
  {
    id: 'cursor-agent',
    label: 'Cursor Agent',
    command: 'cursor-agent',
    docsUrl: 'https://cursor.com/cli',
    // Source: cursor.com/docs/cli/headless ("--force allows the agent to make
    // direct file changes without confirmation").
    buildArgs: (prompt, { model }) => withModel(['-p', prompt], '--model', model),
    yoloArgs: ['--force'],
  },
  {
    id: 'amp',
    label: 'Amp',
    command: 'amp',
    docsUrl: 'https://ampcode.com/manual',
    buildArgs: (prompt, { model }) => withModel(['-x', prompt], '--model', model),
    // No unattended flag is confirmed in Amp's manual, so none is applied rather
    // than guessing one that would abort the run.
  },
  {
    id: 'goose',
    label: 'Goose',
    command: 'goose',
    docsUrl: 'https://block.github.io/goose/docs/quickstart/',
    buildArgs: (prompt, { model }) => withModel(['-t', prompt], '--model', model),
    // Goose expresses permissions through config rules (`alwaysAllow`) rather
    // than a command line flag, so YOLO cannot be forced from here.
  },
  {
    id: 'crush',
    label: 'Crush',
    command: 'crush',
    docsUrl: 'https://github.com/charmbracelet/crush',
    // Source: charmbracelet/crush README ("skip all permission prompts
    // completely by running Crush with the --yolo flag").
    buildArgs: (prompt, { model }) => withModel(['run', prompt], '--model', model),
    yoloArgs: ['--yolo'],
  },
  {
    id: 'qwen',
    label: 'Qwen Code',
    command: 'qwen',
    docsUrl: 'https://github.com/QwenLM/qwen-code',
    // Source: QwenLM/qwen-code docs ("--approve-all: no interactive prompts",
    // with --yolo accepted as its alias).
    buildArgs: (prompt, { model }) => {
      const args = ['-p', prompt];
      return withModel(args, '-m', model);
    },
    yoloArgs: ['--yolo'],
  },
];

export function getCliAgent(id: string): CliAgentDefinition | undefined {
  // Scanned instead of indexed so a definition registered later is still found.
  const key = id.trim().toLowerCase();
  return CLI_AGENTS.find(agent => agent.id === key);
}

export function requireCliAgent(id: string): CliAgentDefinition {
  const agent = getCliAgent(id);
  if (!agent) throw new Error(`Unknown CLI agent: ${id}`);
  return agent;
}

export interface CliAgentAvailability {
  id: string;
  label: string;
  command: string;
  docsUrl: string;
  /** Resolved executable path, or null when it is not on PATH. */
  path: string | null;
  installed: boolean;
  version?: string;
  /**
   * Whether this machine's copy of the CLI actually accepts the YOLO flags in
   * its `--help`. Verified locally so a stale flag cannot silently break a run.
   */
  yoloFlagsDeclared: boolean;
  yoloVerified: boolean | null;
  /** YOLO flags this build would pass. */
  yoloArgs: string[];
}

function pathDirectories(): string[] {
  const raw = process.env.PATH || '';
  return raw.split(path.delimiter).map(entry => entry.trim().replace(/^"|"$/g, '')).filter(Boolean);
}

function windowsExtensions(): string[] {
  const raw = process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
  const extensions = raw.split(';').map(value => value.trim()).filter(Boolean);
  // An extensionless match still wins on some setups, so try it first.
  return ['', ...extensions];
}

/** Locate an executable without spawning a shell. */
export function resolveExecutable(command: string): string | null {
  const isWindows = process.platform === 'win32';
  for (const directory of pathDirectories()) {
    for (const extension of isWindows ? windowsExtensions() : ['']) {
      const candidate = path.join(directory, `${command}${extension.toLowerCase()}`);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        if (!isWindows) fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Not here; keep looking.
      }
    }
  }
  return null;
}

export type VersionProbe = (command: string, cwd: string) => Promise<string | null>;

/** Capture a command's help text so declared flags can be checked, never guessed. */
export type HelpProbe = (command: string, args: string[], cwd: string) => Promise<string | null>;

const runProbe = (command: string, args: string[], cwd: string, timeout: number) => new Promise<string | null>(resolve => {
  try {
    execFile(command, args, { cwd, windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      // Help output often goes to stderr, and a non-zero exit is normal for
      // `--help`, so both streams count as usable evidence.
      const text = `${String(stdout)}\n${String(stderr)}`.trim();
      resolve(error && !text ? null : text.slice(0, 200_000));
    });
  } catch {
    resolve(null);
  }
});

const defaultVersionProbe: VersionProbe = (command, cwd) => runProbe(command, ['--version'], cwd, 8000).then(text => {
  if (!text) return null;
  const first = text.split('\n').map(line => line.trim()).find(Boolean);
  return first ? first.slice(0, 120) : null;
});

const defaultHelpProbe: HelpProbe = (command, args, cwd) => runProbe(command, [...args, '--help'], cwd, 8000);

/**
 * True when every YOLO **flag** appears in the CLI's own help text.
 *
 * Only flag tokens are checked: an argument list mixes flags with their values
 * (`--ask-for-approval never`) and help text documents the flag, never the value
 * we chose. This is what makes "ready for every agent" honest — the flags in
 * this file come from documentation, but what actually runs is checked against
 * the copy of the CLI on the user's machine.
 */
export function helpDeclaresArgs(helpText: string | null, args: string[]): boolean {
  if (!helpText) return false;
  const flags = args.filter(arg => arg.startsWith('-'));
  if (!flags.length) return false;
  const normalized = helpText.replace(/\s+/g, ' ');
  return flags.every(flag => normalized.includes(flag));
}

/**
 * Report which supported CLIs are installed, and whether their YOLO flags really
 * exist on this machine.
 *
 * Read-only: nothing runs beyond each tool's own `--version` and `--help`.
 */
export async function detectCliAgents(options: {
  cwd: string;
  probeVersion?: VersionProbe;
  probeHelp?: HelpProbe;
  includeVersions?: boolean;
  verifyYolo?: boolean;
} = { cwd: process.cwd() }): Promise<CliAgentAvailability[]> {
  const probe = options.probeVersion ?? defaultVersionProbe;
  const helpProbe = options.probeHelp ?? defaultHelpProbe;
  const includeVersions = options.includeVersions !== false;
  const verifyYolo = options.verifyYolo !== false;
  const results: CliAgentAvailability[] = [];

  for (const agent of CLI_AGENTS) {
    const resolved = resolveExecutable(agent.command);
    const yoloArgs = agent.yoloArgs ?? [];
    const entry: CliAgentAvailability = {
      id: agent.id,
      label: agent.label,
      command: agent.command,
      docsUrl: agent.docsUrl,
      path: resolved,
      installed: Boolean(resolved),
      yoloFlagsDeclared: yoloArgs.length > 0,
      yoloVerified: null,
      yoloArgs,
    };

    if (resolved) {
      if (includeVersions) entry.version = (await probe(agent.command, options.cwd)) ?? undefined;
      if (verifyYolo && yoloArgs.length) {
        // Most CLIs list these on the subcommand (`opencode run --help`), but an
        // agent can point somewhere else, e.g. Codex documents permissions on
        // the root command.
        const helpArgs = agent.yoloHelpArgs
          ?? (() => {
            const subcommand = agent.buildArgs('', { cwd: options.cwd })[0];
            return subcommand && !subcommand.startsWith('-') ? [subcommand] : [];
          })();
        entry.yoloVerified = helpDeclaresArgs(await helpProbe(agent.command, helpArgs, options.cwd), yoloArgs);
      }
    }

    results.push(entry);
  }

  return results;
}

/**
 * Compose the final argument list for a spawn.
 *
 * Kept separate from spawning so the mapping can be asserted in tests without
 * starting any process.
 */
export function buildCliInvocation(agent: CliAgentDefinition, options: {
  prompt: string;
  cwd: string;
  model?: string;
  /** Mirrors the app's YOLO setting: run without stopping for approvals. */
  yolo?: boolean;
}): { command: string; args: string[]; stdin?: string } {
  const base = agent.buildArgs(options.prompt, { model: options.model, cwd: options.cwd });
  // Subcommand flags must precede a trailing positional prompt, so YOLO flags are
  // spliced in directly after the base command rather than appended.
  const args = options.yolo && agent.yoloArgs?.length
    ? [base[0], ...agent.yoloArgs, ...base.slice(1)]
    : base;
  if (!agent.promptOnStdin) return { command: agent.command, args };
  return { command: agent.command, args, stdin: options.prompt };
}