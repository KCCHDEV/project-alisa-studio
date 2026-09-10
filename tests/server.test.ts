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
