import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  CLI_AGENTS,
  buildCliInvocation,
  detectCliAgents,
  getCliAgent,
  helpDeclaresArgs,
  requireCliAgent,
  resolveExecutable,
  type CliAgentDefinition,
} from '../src/core/cli-agents.ts';
import { CliAgentRunner } from '../src/server/cli-agent-sessions.ts';

test('the catalogue exposes unique ids and never puts the prompt in argv for stdin agents', () => {
  const ids = CLI_AGENTS.map(agent => agent.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toContain('opencode');
  expect(ids).toContain('claude');
  expect(ids).toContain('codex');

  for (const agent of CLI_AGENTS) {
    expect(agent.command).toBe(agent.id);
    expect(agent.docsUrl).toMatch(/^https:\/\//);
    expect(() => requireCliAgent(agent.id)).not.toThrow();
  }

  expect(() => requireCliAgent('nope')).toThrow('Unknown CLI agent');
  expect(getCliAgent(' CLAUDE ')).toBeDefined();
});

test('buildCliInvocation matches how each CLI actually accepts a prompt', () => {
  const prompt = 'x'.repeat(5000);

  // `opencode run [<message...>]` has no stdin mode, so the prompt must be the
  // trailing positional argument.
  const opencode = buildCliInvocation(requireCliAgent('opencode'), { prompt, cwd: '/repo', model: 'grok' });
  expect(opencode.command).toBe('opencode');
  expect(opencode.stdin).toBeUndefined();
  expect(opencode.args).toEqual(['run', '--model', 'grok', prompt]);

  // `codex exec` falls back to stdin when the prompt is omitted. The approval
  // policy is left at the CLI default; YOLO supplies its own flags.
  const codex = buildCliInvocation(requireCliAgent('codex'), { prompt, cwd: '/repo' });
  expect(codex.stdin).toBe(prompt);
  expect(codex.args).toEqual(['exec', '--skip-git-repo-check']);

  // Claude Code reads stdin with `-p`.
  const claude = buildCliInvocation(requireCliAgent('claude'), { prompt, cwd: '/repo' });
  expect(claude.stdin).toBe(prompt);
  expect(claude.args).toEqual(['-p', '--output-format', 'stream-json', '--verbose']);

  const amp = buildCliInvocation(requireCliAgent('amp'), { prompt: 'do it', cwd: '/repo', model: 'm' });
  expect(amp.stdin).toBeUndefined();
  expect(amp.args).toEqual(['-x', 'do it', '--model', 'm']);

  // The model flag is omitted entirely when no model is requested.
  expect(buildCliInvocation(requireCliAgent('opencode'), { prompt: 'p', cwd: '/c' }).args).toEqual(['run', 'p']);
});

test('YOLO mode adds each CLI agent own unattended flags', () => {
  // Every flag below was read from that CLI's own documentation, and
  // `helpDeclaresArgs` checks it again against the installed copy at runtime.
  const expected: Record<string, string[]> = {
    opencode: ['--auto'],
    claude: ['--dangerously-skip-permissions'],
    codex: ['--ask-for-approval', 'never', '--sandbox', 'workspace-write'],
    gemini: ['--yolo'],
    'cursor-agent': ['--force'],
    crush: ['--yolo'],
    qwen: ['--yolo'],
    // No flag is declared for these two, so YOLO cannot be forced.
    amp: [],
    goose: [],
  };

  for (const [id, flags] of Object.entries(expected)) {
    const agent = requireCliAgent(id);
    expect(agent.yoloArgs ?? []).toEqual(flags);
    const on = buildCliInvocation(agent, { prompt: 'p', cwd: '/c', yolo: true });
    const off = buildCliInvocation(agent, { prompt: 'p', cwd: '/c' });
    if (flags.length) {
      // Flags must land after the subcommand and before a trailing prompt.
      expect(on.args.slice(1, 1 + flags.length)).toEqual(flags);
      expect(off.args).not.toContain(flags[0]!);
    } else {
      expect(on.args).toEqual(off.args);
    }
  }

  // Codex stays sandboxed to the checkout even in YOLO, and never asks.
  const codex = buildCliInvocation(requireCliAgent('codex'), { prompt: 'p', cwd: '/c', yolo: true });
  expect(codex.args).toEqual(['exec', '--ask-for-approval', 'never', '--sandbox', 'workspace-write', '--skip-git-repo-check']);
  expect(codex.args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
  // `--full-auto` was removed: this CLI has no such flag.
  expect(codex.args).not.toContain('--full-auto');
  expect(codex.stdin).toBe('p');
});

test('helpDeclaresArgs only trusts flags the CLI itself lists', () => {
  expect(helpDeclaresArgs('  -a, --auto   Auto-approve permissions  ', ['--auto'])).toBe(true);
  expect(helpDeclaresArgs('--auto  --yolo', ['--auto', '--yolo'])).toBe(true);
  expect(helpDeclaresArgs('--auto  --yolo', ['--auto', '--nope'])).toBe(false);
  expect(helpDeclaresArgs('', ['--auto'])).toBe(false);
  expect(helpDeclaresArgs(null, ['--auto'])).toBe(false);
  expect(helpDeclaresArgs('--auto', [])).toBe(false);

  // Values are not flags, so they are never looked for in help text.
  expect(helpDeclaresArgs('--ask-for-approval <POLICY>  --sandbox <MODE>', ['--ask-for-approval', 'never', '--sandbox', 'workspace-write'])).toBe(true);
  // An argument list with no flag at all cannot be verified.
  expect(helpDeclaresArgs('--anything', ['never', 'workspace-write'])).toBe(false);
});

/** Parse the `ARGV:` line a fake CLI echoes, ignoring platform quoting. */
function argv(transcript: string): string[] {
  const line = transcript.split(/\r?\n/).find(entry => entry.startsWith('ARGV:')) ?? '';
  return line
    .slice('ARGV:'.length)
    .split(/\s+/)
    .map(token => token.replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

test('the runner really passes YOLO flags to the spawned process', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alisa-cli-yolo-'));
  const previousPath = process.env.PATH;
  const original = CLI_AGENTS.length;
  const isWindows = process.platform === 'win32';
  // Echoes argv so the test can assert on what the child actually received.
  const name = isWindows ? 'alisa-argv-cli.cmd' : 'alisa-argv-cli';
  const script = isWindows
    ? ['@echo off', 'echo ARGV:%*', 'exit /b 0'].join('\r\n')
    : ['#!/bin/sh', 'echo "ARGV:$*"', 'exit 0'].join('\n');
  const file = join(dir, name);
  writeFileSync(file, script, 'utf8');
  if (!isWindows) execFileSync('chmod', ['+x', file]);
  CLI_AGENTS.push({
    id: 'alisa-argv-cli',
    label: 'Argv CLI',
    command: 'alisa-argv-cli',
    docsUrl: 'https://example.invalid/argv',
    buildArgs: () => ['task', 'the-prompt'],
    yoloArgs: ['--no-confirm', '--unsafe'],
  });
  process.env.PATH = `${dir}${require('node:path').delimiter}${previousPath ?? ''}`;

  try {
    const safe = await new CliAgentRunner().run({
      agentId: 'alisa-argv-cli', cwd: dir, prompt: 'the-prompt', yolo: false,
      callbacks: { onOutput: () => undefined },
    });
    expect(safe.exitCode).toBe(0);
    expect(argv(safe.transcript)).toEqual(['task', 'the-prompt']);
    expect(argv(safe.transcript)).not.toContain('--no-confirm');

    const yolo = await new CliAgentRunner().run({
      agentId: 'alisa-argv-cli', cwd: dir, prompt: 'the-prompt', yolo: true,
      callbacks: { onOutput: () => undefined },
    });
    expect(yolo.exitCode).toBe(0);
    // Flags land after the subcommand and before the trailing positional.
    expect(argv(yolo.transcript)).toEqual(['task', '--no-confirm', '--unsafe', 'the-prompt']);
  } finally {
    CLI_AGENTS.length = original;
    process.env.PATH = previousPath;
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}, 30000);

test('an agent with no YOLO flags keeps its own prompting behaviour', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alisa-cli-noyolo-'));
  const previousPath = process.env.PATH;
  const original = CLI_AGENTS.length;
  const isWindows = process.platform === 'win32';
  const name = isWindows ? 'alisa-plain-cli.cmd' : 'alisa-plain-cli';
  const script = isWindows
    ? ['@echo off', 'echo ARGV:%*', 'exit /b 0'].join('\r\n')
    : ['#!/bin/sh', 'echo "ARGV:$*"', 'exit 0'].join('\n');
  const file = join(dir, name);
  writeFileSync(file, script, 'utf8');
  if (!isWindows) execFileSync('chmod', ['+x', file]);
  CLI_AGENTS.push({
    id: 'alisa-plain-cli',
    label: 'Plain CLI',
    command: 'alisa-plain-cli',
    docsUrl: 'https://example.invalid/plain',
    buildArgs: (prompt) => ['run', prompt],
  });
  process.env.PATH = `${dir}${require('node:path').delimiter}${previousPath ?? ''}`;

  try {
    const result = await new CliAgentRunner().run({
      agentId: 'alisa-plain-cli', cwd: dir, prompt: 'hello', yolo: true,
      callbacks: { onOutput: () => undefined },
    });
    expect(result.exitCode).toBe(0);
    expect(argv(result.transcript)).toEqual(['run', 'hello']);
  } finally {
    CLI_AGENTS.length = original;
    process.env.PATH = previousPath;
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}, 30000);

test('resolveExecutable finds a real binary and reports missing ones as null', () => {
  const isWindows = process.platform === 'win32';
  expect(resolveExecutable(isWindows ? 'cmd' : 'sh')).not.toBeNull();
  expect(resolveExecutable('definitely-not-a-real-binary-xyz')).toBeNull();
});

test('detectCliAgents reports every supported CLI with an installed flag', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'alisa-cli-'));
  try {
    const agents = await detectCliAgents({ cwd, probeVersion: async () => '1.2.3' });
    expect(agents).toHaveLength(CLI_AGENTS.length);
    for (const entry of agents) {
      expect(typeof entry.installed).toBe('boolean');
      expect(entry.docsUrl).toMatch(/^https:\/\//);
      expect(entry.yoloFlagsDeclared).toBe((requireCliAgent(entry.id).yoloArgs ?? []).length > 0);
      expect(entry.yoloArgs).toEqual(requireCliAgent(entry.id).yoloArgs ?? []);
      if (entry.installed) expect(entry.version).toBe('1.2.3');
    }

    // Version probing can be skipped entirely, which keeps the UI snappy.
    const fast = await detectCliAgents({ cwd, includeVersions: false });
    expect(fast.every(entry => entry.version === undefined)).toBe(true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}, 30000);

test('YOLO flags are verified against the installed CLI, not trusted blindly', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'alisa-cli-verify-'));
  try {
    const asked: string[][] = [];
    // Stand-ins for what each installed CLI actually prints: OpenCode documents
    // `--auto` on its `run` subcommand, Codex documents permissions on the root
    // command only.
    const helpByArgs: Record<string, string> = {
      'opencode run': 'USAGE opencode run [flags] [<message...>]\n  --auto   Auto-approve permissions',
      'codex': '  --ask-for-approval <POLICY>   when to ask\n  --sandbox <MODE>   [read-only, workspace-write]',
    };
    const good = await detectCliAgents({
      cwd,
      probeVersion: async () => '1.0.0',
      probeHelp: async (command, args) => {
        asked.push(args);
        return helpByArgs[[command, ...args].join(' ')] ?? 'no help';
      },
    });
    const opencode = good.find(entry => entry.id === 'opencode')!;
    expect(opencode.installed).toBe(true);
    expect(opencode.yoloFlagsDeclared).toBe(true);
    expect(opencode.yoloVerified).toBe(true);
    // The subcommand's own help is what gets checked, not the bare root help.
    expect(asked.some(args => args.includes('run'))).toBe(true);

    // Codex documents permissions on the root command instead.
    const codex = good.find(entry => entry.id === 'codex')!;
    expect(codex.yoloVerified).toBe(true);
    expect(asked.some(args => args.length === 0)).toBe(true);

    // A build that renamed the flag must be reported as unverified.
    const stale = await detectCliAgents({
      cwd,
      probeVersion: async () => '0.9.0',
      probeHelp: async () => 'USAGE opencode run [flags]\n  --print-logs   show logs',
    });
    expect(stale.find(entry => entry.id === 'opencode')!.yoloVerified).toBe(false);

    // An agent with no declared flags is never claimed to be verified.
    const noFlags = good.find(entry => entry.id === 'amp')!;
    expect(noFlags.yoloFlagsDeclared).toBe(false);
    expect(noFlags.yoloVerified).toBeNull();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}, 30000);

/**
 * Register a throwaway CLI on PATH so the runner can be exercised without
 * depending on whichever agents happen to be installed on the machine.
 */
function makeFakeCli(dir: string): { id: string; command: string; definition: CliAgentDefinition } {
  const isWindows = process.platform === 'win32';
  const name = isWindows ? 'alisa-fake-cli.cmd' : 'alisa-fake-cli';
  const script = isWindows
    ? ['@echo off', 'set /p ALISA_PROMPT=', 'echo STDOUT:%ALISA_PROMPT%', 'echo STDERR:from-stderr 1>&2', 'exit /b 0'].join('\r\n')
    : ['#!/bin/sh', 'prompt=$(cat)', 'echo "STDOUT:$prompt"', 'echo "STDERR:from-stderr" >&2', 'exit 0'].join('\n');
  const file = join(dir, name);
  writeFileSync(file, script, 'utf8');
  if (!isWindows) execFileSync('chmod', ['+x', file]);

  const command = 'alisa-fake-cli';
  const definition: CliAgentDefinition = {
    id: command,
    label: 'Fake CLI',
    command,
    docsUrl: 'https://example.invalid/fake',
    promptOnStdin: true,
    buildArgs: () => [],
  };
  return { id: command, command, definition };
}

test('the runner streams stdout and stderr and returns the transcript', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alisa-cli-bin-'));
  const previousPath = process.env.PATH;
  const original = CLI_AGENTS.length;
  const { definition } = makeFakeCli(dir);
  CLI_AGENTS.push(definition);
  process.env.PATH = `${dir}${require('node:path').delimiter}${previousPath ?? ''}`;
  try {
    const runner = new CliAgentRunner();
    const chunks: Array<{ data: string; stream: string }> = [];
    const result = await runner.run({
      agentId: definition.id,
      cwd: dir,
      prompt: 'hello there',
      callbacks: { onOutput: (data, stream) => chunks.push({ data, stream }) },
    });

    expect(result.exitCode).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.transcript).toContain('STDOUT:hello there');
    expect(result.transcript).toContain('STDERR:from-stderr');
    expect(chunks.some(chunk => chunk.stream === 'stdout')).toBe(true);
    expect(chunks.some(chunk => chunk.stream === 'stderr')).toBe(true);
    expect(runner.activeCount).toBe(0);
  } finally {
    CLI_AGENTS.length = original;
    process.env.PATH = previousPath;
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}, 30000);

test('the runner rejects an empty prompt, an unknown agent and a missing binary', async () => {
  const runner = new CliAgentRunner();
  await expect(runner.run({ agentId: 'nope', cwd: process.cwd(), prompt: 'x', callbacks: { onOutput: () => undefined } }))
    .rejects.toThrow('Unknown CLI agent');
  await expect(runner.run({ agentId: 'opencode', cwd: process.cwd(), prompt: '   ', callbacks: { onOutput: () => undefined } }))
    .rejects.toThrow('Prompt is required');
  await expect(runner.run({ agentId: 'opencode', cwd: process.cwd(), prompt: 'x'.repeat(300 * 1024), callbacks: { onOutput: () => undefined } }))
    .rejects.toThrow('Prompt is too large');

  // `nope` resolves to nothing on PATH, so the run must fail before spawning.
  const original = CLI_AGENTS.length;
  CLI_AGENTS.push({
    id: 'alisa-absent-cli',
    label: 'Absent',
    command: 'alisa-absent-cli',
    docsUrl: 'https://example.invalid/absent',
    buildArgs: () => [],
  });
  try {
    await expect(runner.run({ agentId: 'alisa-absent-cli', cwd: process.cwd(), prompt: 'x', callbacks: { onOutput: () => undefined } }))
      .rejects.toThrow(/not installed or not on PATH/);
  } finally {
    CLI_AGENTS.length = original;
  }
});

test('an aborted run terminates the child process', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alisa-cli-slow-'));
  const previousPath = process.env.PATH;
  const original = CLI_AGENTS.length;
  const isWindows = process.platform === 'win32';
  const name = isWindows ? 'alisa-slow-cli.cmd' : 'alisa-slow-cli';
  const script = isWindows
    ? '@echo off\r\nping -n 30 127.0.0.1 > nul\r\n'
    : '#!/bin/sh\nsleep 30\n';
  const file = join(dir, name);
  writeFileSync(file, script, 'utf8');
  if (!isWindows) execFileSync('chmod', ['+x', file]);
  CLI_AGENTS.push({
    id: 'alisa-slow-cli',
    label: 'Slow CLI',
    command: 'alisa-slow-cli',
    docsUrl: 'https://example.invalid/slow',
    buildArgs: () => [],
  });
  process.env.PATH = `${dir}${require('node:path').delimiter}${previousPath ?? ''}`;

  try {
    const runner = new CliAgentRunner();
    const controller = new AbortController();
    const run = runner.run({
      agentId: 'alisa-slow-cli',
      cwd: dir,
      prompt: 'wait',
      signal: controller.signal,
      callbacks: { onOutput: () => undefined },
    });
    await Bun.sleep(150);
    expect(runner.activeCount).toBe(1);
    controller.abort();
    const result = await run;
    expect(result.signal !== null || result.exitCode !== 0).toBe(true);
    expect(runner.activeCount).toBe(0);
  } finally {
    CLI_AGENTS.length = original;
    process.env.PATH = previousPath;
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}, 30000);

test('a non-zero exit is reported instead of being treated as success', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alisa-cli-fail-'));
  const previousPath = process.env.PATH;
  const original = CLI_AGENTS.length;
  const isWindows = process.platform === 'win32';
  const name = isWindows ? 'alisa-fail-cli.cmd' : 'alisa-fail-cli';
  const script = isWindows ? '@echo off\r\necho broken\r\nexit /b 3\r\n' : '#!/bin/sh\necho broken\nexit 3\n';
  const file = join(dir, name);
  writeFileSync(file, script, 'utf8');
  if (!isWindows) execFileSync('chmod', ['+x', file]);
  CLI_AGENTS.push({
    id: 'alisa-fail-cli',
    label: 'Failing CLI',
    command: 'alisa-fail-cli',
    docsUrl: 'https://example.invalid/fail',
    buildArgs: () => [],
  });
  process.env.PATH = `${dir}${require('node:path').delimiter}${previousPath ?? ''}`;

  try {
    const runner = new CliAgentRunner();
    const result = await runner.run({
      agentId: 'alisa-fail-cli',
      cwd: dir,
      prompt: 'x',
      callbacks: { onOutput: () => undefined },
    });
    expect(result.exitCode).toBe(3);
    expect(result.transcript).toContain('broken');
  } finally {
    CLI_AGENTS.length = original;
    process.env.PATH = previousPath;
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}, 30000);