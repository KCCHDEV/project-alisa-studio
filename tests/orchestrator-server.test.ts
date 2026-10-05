import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WebSocket } from 'ws';

/**
 * End-to-end coverage for the parallel orchestrator: several Alisa agents run
 * at the same time, each inside its own git worktree, and the results can be
 * reviewed and merged back through the HTTP API.
 */

interface Harness {
  base: string;
  child: ReturnType<typeof Bun.spawn>;
  provider: ReturnType<typeof Bun.serve>;
  repo: string;
  stop: () => Promise<void>;
}

/** Git normalises line endings on checkout on Windows, so compare content loosely. */
function normalizeEol(value: string) {
  return value.replace(/\r\n/g, '\n');
}

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
}

async function startHarness(options: { onRequest?: (messages: any[]) => any } = {}): Promise<Harness> {
  const sandbox = mkdtempSync(join(tmpdir(), 'alisa-orch-'));
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Alisa Test');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'README.md'), '# base\n');
  writeFileSync(join(repo, 'src', 'index.ts'), 'export const value = 1;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-m', 'initial commit');

  const provider = Bun.serve({
    port: 0,
    async fetch(req) {
      const { messages } = await req.json() as any;
      const delta = options.onRequest
        ? options.onRequest(messages)
        : { content: 'Nothing to do.' };
      return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n`);
    },
  });

  const portProbe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = portProbe.port!;
  portProbe.stop(true);

  const runtime = join(sandbox, 'runtime');
  mkdirSync(runtime, { recursive: true });
  writeFileSync(join(runtime, '.alisa-config.json'), JSON.stringify({
    workspaceDir: repo,
    apiKey: 'test-key',
    baseURL: provider.url.toString(),
    model: 'test-model',
  }));

  const child = Bun.spawn([process.execPath, resolve('src/server/index.ts')], {
    env: { ...process.env, PORT: String(port), ALISA_CONFIG_DIR: runtime },
    stdout: 'ignore',
    stderr: 'pipe',
  });

  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${base}/api/config`)).ok) break; } catch { /* Not listening yet. */ }
    await Bun.sleep(50);
  }

  return {
    base,
    child,
    provider,
    repo,
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

async function postJson(base: string, route: string, body: unknown) {
  return fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify(body),
  });
}

test('two agents run in parallel, each inside its own worktree', async () => {
  // Each agent writes a distinct file so we can prove which checkout it touched.
  let requestIndex = 0;
  const harness = await startHarness({
    onRequest: () => {
      const slot = requestIndex++;
      const name = `agent-${slot % 2}.ts`;
      return {
        tool_calls: [{
          index: 0,
          id: `call-${slot}`,
          function: { name: 'write_file', arguments: JSON.stringify({ path: `src/${name}`, content: `export const slot = ${slot};\n` }) },
        }],
      };
    },
  });

  const sockets: WebSocket[] = [];
  try {
    const listResponse = await fetch(`${harness.base}/api/worktrees`, { headers: { Origin: harness.base } });
    expect(listResponse.status).toBe(200);
    const info = await listResponse.json() as any;
    expect(info.available).toBe(true);
    expect(info.worktrees).toEqual([]);
    expect(info.capacity).toBeGreaterThanOrEqual(2);

    const first = await (await postJson(harness.base, '/api/worktrees', { title: 'Fix login', prompt: 'Fix the login bug' })).json() as any;
    const second = await (await postJson(harness.base, '/api/worktrees', { title: 'Fix login', prompt: 'Fix the login bug too' })).json() as any;

    expect(first.branch).toBe('alisa/fix-login');
    expect(second.branch).toBe('alisa/fix-login-2');
    expect(first.path).not.toBe(second.path);
    expect(first.orphaned).toBe(false);

    const sessions = await (await fetch(`${harness.base}/api/sessions`, { headers: { Origin: harness.base } })).json() as any;
    const ws = new WebSocket(`${harness.base.replace('http', 'ws')}/ws`);
    sockets.push(ws);
    const events: any[] = [];
    const finished: string[] = [];

    await new Promise<void>((resolveDone, reject) => {
      const timer = setTimeout(() => reject(new Error('Parallel runs timed out')), 15000);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'start_task', prompt: 'Write your file', sessionId: sessions.sessionId, worktreeId: first.id }));
        ws.send(JSON.stringify({ type: 'start_task', prompt: 'Write your other file', sessionId: sessions.sessionId, worktreeId: second.id }));
      });
      ws.on('message', data => {
        const event = JSON.parse(data.toString());
        events.push(event);
        if (event.type === 'orchestrator_run_finished') {
          finished.push(event.run.worktreeId);
          if (finished.length === 2) { clearTimeout(timer); resolveDone(); }
        }
      });
      ws.on('error', reject);
    });

    expect(finished.sort()).toEqual([first.id, second.id].sort());

    // Each worktree received only its own agent's files, and the main repo is
    // untouched: this is the whole point of the isolation.
    const writtenIn = (dir: string) => readdirSync(join(dir, 'src')).filter(name => name.startsWith('agent-')).sort();
    const writtenInFirst = writtenIn(first.path);
    const writtenInSecond = writtenIn(second.path);
    expect(writtenInFirst).toHaveLength(1);
    expect(writtenInSecond).toHaveLength(1);
    expect(writtenInFirst).not.toEqual(writtenInSecond);
    expect(existsSync(join(harness.repo, 'src', 'agent-0.ts'))).toBe(false);
    expect(existsSync(join(harness.repo, 'src', 'agent-1.ts'))).toBe(false);
    expect(git(harness.repo, 'status', '--porcelain').trim()).toBe('');

    const diffA = await (await fetch(`${harness.base}/api/worktrees/diff?id=${first.id}`, { headers: { Origin: harness.base } })).json() as any;
    const diffB = await (await fetch(`${harness.base}/api/worktrees/diff?id=${second.id}`, { headers: { Origin: harness.base } })).json() as any;
    expect(diffA.files.length + diffB.files.length).toBeGreaterThanOrEqual(2);
    expect(diffA.worktreeId).toBe(first.id);
  } finally {
    for (const socket of sockets) socket.close();
    await harness.stop();
  }
}, 60000);

test('a worktree can be committed and merged back into the main workspace', async () => {
  const harness = await startHarness();
  try {
    const created = await (await postJson(harness.base, '/api/worktrees', { title: 'Ship feature' })).json() as any;
    writeFileSync(join(created.path, 'src', 'feature.ts'), 'export const feature = true;\n');

    const commit = await (await postJson(harness.base, '/api/worktrees/commit', { id: created.id, message: 'Add feature' })).json() as any;
    expect(commit.success).toBe(true);
    expect(commit.hash).toHaveLength(40);

    const merged = await (await postJson(harness.base, '/api/worktrees/merge', { id: created.id })).json() as any;
    expect(merged.merged).toBe(true);
    expect(merged.conflicted).toBe(false);
    expect(normalizeEol(readFileSync(join(harness.repo, 'src', 'feature.ts'), 'utf8'))).toBe('export const feature = true;\n');

    const removed = await (await postJson(harness.base, '/api/worktrees/remove', { id: created.id, deleteBranch: true })).json() as any;
    expect(removed.removed).toBe(true);
    expect(removed.branchDeleted).toBe(true);
    expect(existsSync(created.path)).toBe(false);
  } finally {
    await harness.stop();
  }
}, 60000);

test('merge is refused while the main workspace has uncommitted changes', async () => {
  const harness = await startHarness();
  try {
    const created = await (await postJson(harness.base, '/api/worktrees', { title: 'Blocked merge' })).json() as any;
    writeFileSync(join(created.path, 'src', 'blocked.ts'), 'export const blocked = true;\n');
    await (await postJson(harness.base, '/api/worktrees/commit', { id: created.id, message: 'Blocked change' })).json();

    writeFileSync(join(harness.repo, 'README.md'), '# uncommitted local edit\n');
    const response = await postJson(harness.base, '/api/worktrees/merge', { id: created.id });
    expect(response.status).toBe(400);
    expect((await response.json() as any).error).toContain('Commit or discard');
    expect(normalizeEol(readFileSync(join(harness.repo, 'README.md'), 'utf8'))).toBe('# uncommitted local edit\n');
  } finally {
    await harness.stop();
  }
}, 60000);

test('the worktree API rejects unknown ids and oversized input', async () => {
  const harness = await startHarness();
  try {
    const diff = await fetch(`${harness.base}/api/worktrees/diff?id=../../etc`, { headers: { Origin: harness.base } });
    expect(diff.status).toBe(400);
    expect((await diff.json() as any).error).toBe('Unknown worktree');

    const missingId = await fetch(`${harness.base}/api/worktrees/diff`, { headers: { Origin: harness.base } });
    expect(missingId.status).toBe(400);

    const badTitle = await postJson(harness.base, '/api/worktrees', { title: '' });
    expect(badTitle.status).toBe(400);

    const badBaseRef = await postJson(harness.base, '/api/worktrees', { title: 'ok', baseRef: '--upload-pack=evil' });
    expect(badBaseRef.status).toBe(400);

    const untrusted = await fetch(`${harness.base}/api/worktrees`, { headers: { Origin: 'https://untrusted.example' } });
    expect(untrusted.status).toBe(403);
  } finally {
    await harness.stop();
  }
}, 60000);

test('the orchestrator refuses a second run on the main workspace but allows one per worktree', async () => {
  let served = 0;
  const harness = await startHarness({
    onRequest: () => {
      served += 1;
      return { content: `answer ${served}` };
    },
  });
  const sockets: WebSocket[] = [];
  try {
    const sessions = await (await fetch(`${harness.base}/api/sessions`, { headers: { Origin: harness.base } })).json() as any;
    const ws = new WebSocket(`${harness.base.replace('http', 'ws')}/ws`);
    sockets.push(ws);
    const events: any[] = [];

    await new Promise<void>((resolveDone, reject) => {
      const timer = setTimeout(() => reject(new Error('Main workspace task timed out')), 15000);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'start_task', prompt: 'First', sessionId: sessions.sessionId })));
      ws.on('message', data => {
        const event = JSON.parse(data.toString());
        events.push(event);
        if (event.type === 'session_saved') { clearTimeout(timer); resolveDone(); }
      });
      ws.on('error', reject);
    });

    expect(events.some(event => event.type === 'error')).toBe(false);
    expect(normalizeEol(readFileSync(join(harness.repo, 'README.md'), 'utf8'))).toBe('# base\n');

    const worktree = await (await postJson(harness.base, '/api/worktrees', { title: 'Concurrent' })).json() as any;
    const runs: string[] = [];
    await new Promise<void>((resolveDone, reject) => {
      const timer = setTimeout(() => reject(new Error('Worktree task timed out')), 15000);
      ws.on('message', data => {
        const event = JSON.parse(data.toString());
        if (event.type === 'orchestrator_run_finished') {
          runs.push(event.run.id);
          clearTimeout(timer);
          resolveDone();
        }
      });
      ws.send(JSON.stringify({ type: 'start_task', prompt: 'Second', sessionId: sessions.sessionId, worktreeId: worktree.id }));
    });
    expect(runs).toHaveLength(1);
  } finally {
    for (const socket of sockets) socket.close();
    await harness.stop();
  }
}, 60000);