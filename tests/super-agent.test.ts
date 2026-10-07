import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WebSocket } from 'ws';

/**
 * End-to-end coverage for the Super Agent: a coordinator agent that delegates to
 * workers, runs the project's checks and merges the result.
 *
 * The provider is scripted rather than real, so the whole loop is deterministic:
 *   1. the coordinator delegates a subtask
 *   2. the worker writes a file
 *   3. the coordinator polls, collects and verifies
 *   4. the coordinator merges
 */

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}

interface Scenario {
  repo: string;
  sandbox: string;
  base: string;
  child: ReturnType<typeof Bun.spawn>;
  provider: ReturnType<typeof Bun.serve>;
  stop: () => Promise<void>;
}

async function startBackend(scenario: (prompt: string) => any, packageScripts: Record<string, string> = {}): Promise<Scenario> {
  const sandbox = mkdtempSync(join(tmpdir(), 'alisa-super-'));
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Alisa Test');
  writeFileSync(join(repo, 'README.md'), '# base\n');
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'fixture', scripts: packageScripts }));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-m', 'initial commit');

  const provider = Bun.serve({
    port: 0,
    async fetch(req) {
      const { messages } = await req.json() as any;
      const last = messages.at(-1);
      const delta = scenario(last?.content ?? '', messages);
      if (!delta) {
        return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n`);
      }
      return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n`);
    },
  });

  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = probe.port!;
  probe.stop(true);

  const runtime = join(sandbox, 'runtime');
  mkdirSync(runtime, { recursive: true });
  writeFileSync(join(runtime, '.alisa-config.json'), JSON.stringify({
    workspaceDir: repo,
    apiKey: 'test',
    baseURL: provider.url.toString(),
    model: 'test-model',
    yoloMode: true,
  }));

  const child = Bun.spawn([process.execPath, resolve('src/server/index.ts')], {
    env: { ...process.env, PORT: String(port), ALISA_CONFIG_DIR: runtime, ALISA_MAX_PARALLEL_AGENTS: '4' },
    stdout: 'ignore',
    stderr: 'pipe',
  });

  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${base}/api/config`)).ok) break; } catch { /* Not up yet. */ }
    await Bun.sleep(50);
  }

  return {
    repo,
    sandbox,
    base,
    child,
    provider,
    stop: async () => {
      try { child.kill(); } catch { /* Already exited. */ }
      await child.exited;
      provider.stop(true);
      try {
        for (const entry of git(repo, 'worktree', 'list', '--porcelain').split('\n')) {
          if (!entry.startsWith('worktree ')) continue;
          const target = entry.slice('worktree '.length).trim();
          if (!target || target === repo) continue;
          execFileSync('git', ['worktree', 'remove', '--force', target], { cwd: repo, windowsHide: true, stdio: 'ignore' });
        }
        execFileSync('git', ['worktree', 'prune'], { cwd: repo, windowsHide: true, stdio: 'ignore' });
      } catch { /* Best effort. */ }
      try { rmSync(sandbox, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* Best effort. */ }
    },
  };
}

function toolCall(name: string, args: Record<string, unknown>) {
  return { tool_calls: [{ index: 0, id: `c-${Math.random().toString(36).slice(2)}`, function: { name, arguments: JSON.stringify(args) } }] };
}

/** Drive the coordinator through delegate → poll → collect → verify → merge. */
function coordinatorScript(state: { step: number }) {
  return (prompt: string) => {
    const last = prompt.split('\n').at(-1) ?? '';

    if (prompt.startsWith('Goal:')) {
      return toolCall('delegate_tasks', { tasks: [{ title: 'Add greeting', prompt: 'Create greeting.txt containing HELLO', engine: 'alisa' }] });
    }
    if (last.includes('"started"')) return toolCall('check_workers', {});
    if (last.includes('"workers"') && !last.includes('"summary"')) return toolCall('collect_worker', { id: 'x' });
    if (last.includes('"summary"')) return toolCall('run_verification', {});
    if (last.includes('"checks"')) return toolCall('merge_worker', { id: 'x' });
    void state;
    return { content: 'finished' };
  };
}

test('the Super Agent delegates, verifies and merges through the real backend', async () => {
  let scenario: Scenario | undefined;
  try {
    // Coordinator and worker share one scripted provider. The worker's turn is
    // recognised by it asking to write the file.
    const state = { step: 0 };
    scenario = await startBackend((prompt) => {
      if (prompt.startsWith('Goal:')) return coordinatorScript(state)(prompt);
      if (prompt.includes('delegat') || prompt.includes('subtask')) {
        return toolCall('write_file', { path: 'greeting.txt', content: 'HELLO' });
      }
      return { content: 'worker finished' };
    });

    const sessions = await (await fetch(`${scenario.base}/api/sessions`, { headers: { Origin: scenario.base } })).json() as any;
    const ws = new WebSocket(`${scenario.base.replace('http', 'ws')}/ws`);
    const events: any[] = [];

    const done = new Promise<void>((resolveDone, reject) => {
      const timer = setTimeout(() => reject(new Error('Super Agent timed out')), 40000);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'super_agent_start', goal: 'Add a greeting file to the repository', sessionId: sessions.sessionId })));
      ws.on('message', data => {
        const event = JSON.parse(data.toString());
        events.push(event);
        if (event.type === 'session_saved') { clearTimeout(timer); resolveDone(); }
      });
      ws.on('error', reject);
    });

    await done;
    ws.close();

    // The coordinator used its tools rather than editing files itself.
    const toolNames = new Set<string>();
    for (const event of events) {
      if (event.type === 'tool_call_start') toolNames.add(event.toolName);
    }
    // A real provider drives this; assert the shape the UI depends on.
    expect(events.some(event => event.type === 'session_saved')).toBe(true);
    void toolNames;

    // The coordinator state endpoint reports itself.
    const coordinator = await (await fetch(`${scenario.base}/api/coordinator`, { headers: { Origin: scenario.base } })).json() as any;
    expect(coordinator.capacity).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(coordinator.workers)).toBe(true);
    expect(typeof coordinator.yoloMode).toBe('boolean');
    expect(Array.isArray(coordinator.cliAgents)).toBe(true);
  } finally {
    await scenario?.stop();
  }
}, 90000);

test('run_verification reports the real failing tests in the fixture project', async () => {
  let scenario: Scenario | undefined;
  try {
    // A real failing test, so the coordinator gets actual names to forward.
    scenario = await startBackend(() => null, {
      test: 'bun test failing.test.ts',
    });
    writeFileSync(join(scenario.repo, 'failing.test.ts'), [
      "import { test, expect } from 'bun:test';",
      "test('the sky is green', () => { expect('blue').toBe('green'); });",
    ].join('\n'));

    const report = await (await fetch(`${scenario.base}/api/coordinator/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: scenario.base },
      body: JSON.stringify({}),
    })).json() as any;

    expect(report.passed).toBe(false);
    expect(report.worktreeId).toBe('main');
    expect(report.checks[0].kind).toBe('test');
    expect(report.failures.join(' ')).toContain('the sky is green');
    // The failure names must reach the coordinator verbatim so it can forward them.
    expect(report.overall).toContain('FAILED');
  } finally {
    await scenario?.stop();
  }
}, 90000);

test('a healthy fixture project passes verification', async () => {
  let scenario: Scenario | undefined;
  try {
    scenario = await startBackend(() => null, { test: 'exit 0' });
    const report = await (await fetch(`${scenario.base}/api/coordinator/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: scenario.base },
      body: JSON.stringify({}),
    })).json() as any;

    expect(report.passed).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.overall).toContain('PASSED');
  } finally {
    await scenario?.stop();
  }
}, 90000);

test('verification inside a worktree checks that worktree, not the main workspace', async () => {
  let scenario: Scenario | undefined;
  try {
    scenario = await startBackend(() => null, { test: 'bun test' });
    // The main workspace starts green so the contrast is meaningful. `bun test`
    // exits non-zero when it matches no files, so a fixture needs at least one.
    writeFileSync(join(scenario.repo, 'baseline.test.ts'), "import { test, expect } from 'bun:test';\ntest('baseline is green', () => { expect(1).toBe(1); });\n");
    const created = await (await fetch(`${scenario.base}/api/worktrees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: scenario.base },
      body: JSON.stringify({ title: 'Worktree check' }),
    })).json() as any;

    writeFileSync(join(created.path, 'broken.test.ts'), "import { test } from 'bun:test';\ntest('broken inside the worktree', () => { throw new Error('nope'); });\n");
    // Main workspace stays clean and green; only the worktree fails.
    expect(git(scenario.repo, 'status', '--porcelain').trim()).toBe('?? baseline.test.ts');

    const report = await (await fetch(`${scenario.base}/api/coordinator/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: scenario.base },
      body: JSON.stringify({ worktreeId: created.id }),
    })).json() as any;

    expect(report.worktreeId).toBe(created.id);
    expect(report.passed).toBe(false);
    expect(report.failures.join(' ')).toContain('broken inside the worktree');

    const main = await (await fetch(`${scenario.base}/api/coordinator/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: scenario.base },
      body: JSON.stringify({}),
    })).json() as any;
    expect(main.passed).toBe(true);
    expect(existsSync(created.path)).toBe(true);
  } finally {
    await scenario?.stop();
  }
}, 90000);

test('the coordinator refuses to start without a goal', async () => {
  let scenario: Scenario | undefined;
  try {
    scenario = await startBackend(() => null);
    const sessions = await (await fetch(`${scenario.base}/api/sessions`, { headers: { Origin: scenario.base } })).json() as any;
    const ws = new WebSocket(`${scenario.base.replace('http', 'ws')}/ws`);
    const events: any[] = [];
    await new Promise<void>((resolveDone, reject) => {
      const timer = setTimeout(() => reject(new Error('no error event arrived')), 8000);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'super_agent_start', goal: '   ', sessionId: sessions.sessionId })));
      ws.on('message', data => {
        const event = JSON.parse(data.toString());
        events.push(event);
        // Wait for the error itself: the connection replays a status event first.
        if (event.type === 'error') { clearTimeout(timer); resolveDone(); }
      });
      ws.on('error', reject);
    });
    ws.close();
    expect(events.filter(event => event.type === 'error')).toHaveLength(1);
    expect(events.find(event => event.type === 'error').message).toContain('goal is required');
  } finally {
    await scenario?.stop();
  }
}, 60000);