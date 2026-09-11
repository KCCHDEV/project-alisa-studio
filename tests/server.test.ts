import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WebSocket } from 'ws';

test('HTTP and WebSocket complete an isolated coding task, persist it, and reject cross-origin access', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alisa-server-'));
  const provider = Bun.serve({ port: 0, async fetch(req) {
    const { messages } = await req.json() as any;
    const delta = messages.at(-1).role === 'tool'
      ? { content: 'Created verified.txt successfully.' }
      : { tool_calls: [{ index: 0, id: 'write-test', function: { name: 'write_file', arguments: '{"path":"verified.txt","content":"passed"}' } }] };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n`);
  }});
  const portProbe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = portProbe.port!; portProbe.stop(true);
  writeFileSync(join(root, '.ichigo-config.json'), JSON.stringify({ workspaceDir: root, apiKey: 'test-key', baseURL: provider.url.toString(), model: 'test-model' }));
  const child = Bun.spawn([process.execPath, resolve('src/server/index.ts')], { env: { ...process.env, PORT: String(port), ALISA_CONFIG_DIR: root }, stdout: 'ignore', stderr: 'pipe' });
  const base = `http://127.0.0.1:${port}`;
  let ws: WebSocket | undefined;
  try {
    let connected = false;
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`${base}/api/config`)).ok) { connected = true; break; } } catch {}
      await Bun.sleep(50);
    }
    expect(connected).toBe(true);
    expect((await fetch(`${base}/api/config`, { headers: { Origin: 'https://untrusted.example' } })).status).toBe(403);
    const initial = await (await fetch(`${base}/api/sessions`)).json() as any;
    const events: any[] = [];
    ws = new WebSocket(`${base.replace('http', 'ws')}/ws`);
    await new Promise<void>((resolveDone, reject) => {
      const timer = setTimeout(() => reject(new Error('Agent task timed out')), 6000);
      ws!.on('open', () => ws!.send(JSON.stringify({ type: 'start_task', prompt: 'Create verified.txt', sessionId: initial.sessionId })));
      ws!.on('message', data => {
        const event = JSON.parse(data.toString()); events.push(event);
        if (event.type === 'session_saved') { clearTimeout(timer); resolveDone(); }
      });
      ws!.on('error', reject);
    });
    expect(events.some(e => e.type === 'error')).toBe(false);
    expect(readFileSync(join(root, 'verified.txt'), 'utf8')).toBe('passed');
    const saved = await (await fetch(`${base}/api/sessions?id=${initial.sessionId}`)).json() as any;
    expect(saved.messages.filter((m: any) => m.role === 'user')).toHaveLength(1);
    expect(saved.messages.at(-1).content).toContain('successfully');
    const completedRun = saved.sessions.find((entry: any) => entry.id === initial.sessionId)?.lastRun;
    expect(completedRun.status).toBe('done');
    expect(completedRun.durationMs).toBeGreaterThanOrEqual(0);
    const createFile = await fetch(`${base}/api/files/create`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'src/editor-smoke.ts', isDirectory: false }),
    });
    expect(createFile.status).toBe(200);
    const readFile = await (await fetch(`${base}/api/files/read?path=src%2Feditor-smoke.ts`)).json() as any;
    expect(readFile.content).toBe('');
    const writeFile = await fetch(`${base}/api/files/write`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'src/editor-smoke.ts', content: 'export const editorSmoke = true;', originalContent: '' }),
    });
    expect(writeFile.status).toBe(200);
    const rereadFile = await (await fetch(`${base}/api/files/read?path=src%2Feditor-smoke.ts`)).json() as any;
    expect(rereadFile.content).toBe('export const editorSmoke = true;');
    const rename = await fetch(`${base}/api/sessions/action`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: initial.sessionId, action: 'rename', title: 'Verified task' }),
    });
    expect(rename.status).toBe(200);
    const search = await (await fetch(`${base}/api/sessions/search?q=verified`)).json() as any;
    expect(search.sessions.some((entry: any) => entry.id === initial.sessionId && entry.title === 'Verified task')).toBe(true);
    const fresh = await (await fetch(`${base}/api/sessions`, { method: 'POST' })).json() as any;
    expect(fresh.sessionId).not.toBe(initial.sessionId);
    const old = await (await fetch(`${base}/api/sessions?id=${initial.sessionId}`)).json() as any;
    expect(old.messages).toHaveLength(4);
    expect((await fetch(`${base}/api/files/read?path=${encodeURIComponent('../outside')}`)).status).toBe(403);
  } finally {
    ws?.close(); child.kill(); await child.exited; provider.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);

test('failed agent tasks persist an error status instead of being reported as completed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alisa-server-error-'));
  const provider = Bun.serve({ port: 0, fetch: () => new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n') });
  const portProbe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = portProbe.port!; portProbe.stop(true);
  writeFileSync(join(root, '.ichigo-config.json'), JSON.stringify({ workspaceDir: root, apiKey: '', baseURL: provider.url.toString(), model: 'test-model' }));
  const child = Bun.spawn([process.execPath, resolve('src/server/index.ts')], { env: { ...process.env, PORT: String(port), ALISA_CONFIG_DIR: root }, stdout: 'ignore', stderr: 'pipe' });
  const base = `http://127.0.0.1:${port}`;
  let ws: WebSocket | undefined;
  try {
    let connected = false;
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`${base}/api/config`)).ok) { connected = true; break; } } catch {}
      await Bun.sleep(50);
    }
    expect(connected).toBe(true);
    const initial = await (await fetch(`${base}/api/sessions`)).json() as any;
    const events: any[] = [];
    ws = new WebSocket(`${base.replace('http', 'ws')}/ws`);
    await new Promise<void>((resolveDone, reject) => {
      const timer = setTimeout(() => reject(new Error('Failed agent task timed out')), 6000);
      ws!.on('open', () => ws!.send(JSON.stringify({ type: 'start_task', prompt: 'Trigger a provider failure', sessionId: initial.sessionId })));
      ws!.on('message', data => {
        const event = JSON.parse(data.toString()); events.push(event);
        if (event.type === 'session_saved') { clearTimeout(timer); resolveDone(); }
      });
      ws!.on('error', reject);
    });
    const saved = await (await fetch(`${base}/api/sessions?id=${initial.sessionId}`)).json() as any;
    const sessionSaved = events.find(event => event.type === 'session_saved');
    expect(sessionSaved.status).toBe('error');
    expect(sessionSaved.durationMs).toBeGreaterThanOrEqual(0);
    expect(sessionSaved.completedAt).toBeGreaterThan(0);
    expect(events.some(event => event.type === 'status_change' && event.status === 'error')).toBe(true);
    expect(events.some(event => event.type === 'status_change' && event.status === 'done')).toBe(false);
    expect(saved.messages.at(-1).metadata.error).toBe(true);
  } finally {
    ws?.close(); child.kill(); await child.exited; provider.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);

test('backend YOLO mode runs an approval-gated terminal tool without an approval event', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alisa-server-yolo-'));
  const provider = Bun.serve({ port: 0, async fetch(req) {
    const { messages } = await req.json() as any;
    const isToolResult = messages.at(-1).role === 'tool';
    const delta = isToolResult
      ? { content: 'YOLO terminal completed.' }
      : { tool_calls: [{ index: 0, id: 'yolo-terminal', function: { name: 'terminal', arguments: '{"command":"echo yolo"}' } }] };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: isToolResult ? 'stop' : 'tool_calls' }] })}\n\ndata: [DONE]\n`);
  }});
  const portProbe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = portProbe.port!; portProbe.stop(true);
  writeFileSync(join(root, '.ichigo-config.json'), JSON.stringify({ workspaceDir: root, apiKey: '', baseURL: provider.url.toString(), model: 'yolo-model', yoloMode: true }));
  const child = Bun.spawn([process.execPath, resolve('src/server/index.ts')], { env: { ...process.env, PORT: String(port), ALISA_CONFIG_DIR: root }, stdout: 'ignore', stderr: 'pipe' });
  const base = `http://127.0.0.1:${port}`;
  let ws: WebSocket | undefined;
  try {
    let connected = false;
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`${base}/api/config`)).ok) { connected = true; break; } } catch {}
      await Bun.sleep(50);
    }
    expect(connected).toBe(true);
    const config = await (await fetch(`${base}/api/config`)).json() as any;
    expect(config.yoloMode).toBe(true);
    const initial = await (await fetch(`${base}/api/sessions`)).json() as any;
    const events: any[] = [];
    ws = new WebSocket(`${base.replace('http', 'ws')}/ws`);
    await new Promise<void>((resolveDone, reject) => {
      const timer = setTimeout(() => reject(new Error('YOLO task timed out')), 6000);
      ws!.on('open', () => ws!.send(JSON.stringify({ type: 'start_task', prompt: 'Run the command without asking', sessionId: initial.sessionId, mode: 'code' })));
      ws!.on('message', data => {
        const event = JSON.parse(data.toString()); events.push(event);
        if (event.type === 'session_saved') { clearTimeout(timer); resolveDone(); }
      });
      ws!.on('error', reject);
    });
    expect(events.some(event => event.type === 'approval_requested')).toBe(false);
    expect(events.some(event => event.type === 'task_state' && event.yolo === true)).toBe(true);
    expect(events.some(event => event.type === 'tool_call_end' && event.toolName === 'terminal' && !event.error)).toBe(true);
    const saved = await (await fetch(`${base}/api/sessions?id=${initial.sessionId}`)).json() as any;
    expect(saved.messages.at(-1).content).toContain('YOLO terminal completed');
  } finally {
    ws?.close(); child.kill(); await child.exited; provider.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);

test('goal persistence and staged swarm are exposed through the native backend protocol', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alisa-server-swarm-'));
  let providerRequests = 0;
  const provider = Bun.serve({ port: 0, async fetch() {
    providerRequests++;
    return new Response(`data: ${JSON.stringify({ model: 'resolved/swarm-model', choices: [{ delta: { content: 'Worker completed its report.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  }});
  const portProbe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = portProbe.port!; portProbe.stop(true);
  writeFileSync(join(root, '.ichigo-config.json'), JSON.stringify({ workspaceDir: root, apiKey: '', baseURL: provider.url.toString(), model: 'swarm-route' }));
  const child = Bun.spawn([process.execPath, resolve('src/server/index.ts')], { env: { ...process.env, PORT: String(port), ALISA_CONFIG_DIR: root }, stdout: 'ignore', stderr: 'pipe' });
  const base = `http://127.0.0.1:${port}`;
  let ws: WebSocket | undefined;
  try {
    let connected = false;
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`${base}/api/config`)).ok) { connected = true; break; } } catch {}
      await Bun.sleep(50);
    }
    expect(connected).toBe(true);
    const initial = await (await fetch(`${base}/api/sessions`)).json() as any;
    const goalResponse = await fetch(`${base}/api/goals`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: initial.sessionId, goal: { title: 'Ship swarm protocol', description: 'Keep the agents observable', status: 'active', progress: 10, steps: [] } }),
    });
    expect(goalResponse.status).toBe(200);
    const swarmMode = await fetch(`${base}/api/sessions/action`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: initial.sessionId, action: 'set_swarm', swarm: true }),
    });
    expect(swarmMode.status).toBe(200);

    const events: any[] = [];
    ws = new WebSocket(`${base.replace('http', 'ws')}/ws`);
    await new Promise<void>((resolveDone, reject) => {
      const timer = setTimeout(() => reject(new Error('Swarm task timed out')), 6000);
      ws!.on('open', () => ws!.send(JSON.stringify({ type: 'start_task', prompt: 'Inspect the project', sessionId: initial.sessionId, swarm: true, model: 'swarm-route' })));
      ws!.on('message', data => {
        const event = JSON.parse(data.toString()); events.push(event);
        if (event.type === 'session_saved') { clearTimeout(timer); resolveDone(); }
      });
      ws!.on('error', reject);
    });
    const saved = await (await fetch(`${base}/api/sessions?id=${initial.sessionId}`)).json() as any;
    const sessionSaved = events.find(event => event.type === 'session_saved');
    expect(sessionSaved.status).toBe('done');
    expect(sessionSaved.swarm).toBe(true);
    expect(sessionSaved.agents).toHaveLength(4);
    expect(sessionSaved.agents.every((agent: any) => agent.status === 'done')).toBe(true);
    expect(events.some(event => event.type === 'context_usage')).toBe(true);
    expect(saved.goal.title).toBe('Ship swarm protocol');
    expect(saved.messages.filter((message: any) => message.role === 'user')).toHaveLength(1);
    expect(saved.messages.filter((message: any) => message.role === 'assistant').every((message: any) => message.metadata.model === 'resolved/swarm-model')).toBe(true);
    expect(providerRequests).toBe(4);
  } finally {
    ws?.close(); child.kill(); await child.exited; provider.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);
