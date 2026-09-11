import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WebSocket } from 'ws';

test('native websocket protocol opens a persistent local terminal session', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alisa-terminal-server-'));
  writeFileSync(join(root, 'README.md'), 'terminal smoke test');
  const portProbe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = portProbe.port!;
  portProbe.stop(true);
  writeFileSync(join(root, '.ichigo-config.json'), JSON.stringify({ workspaceDir: root, apiKey: '', baseURL: 'http://127.0.0.1:1/v1', model: 'test-model' }));
  const child = Bun.spawn([process.execPath, resolve('src/server/index.ts')], {
    env: { ...process.env, PORT: String(port), ALISA_CONFIG_DIR: root, SHELL: '/bin/bash' },
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const base = `http://127.0.0.1:${port}`;
  let ws: WebSocket | undefined;
  try {
    let connected = false;
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`${base}/api/config`)).ok) { connected = true; break; } } catch { /* Retry while the backend boots. */ }
      await Bun.sleep(50);
    }
    expect(connected).toBe(true);

    const events: any[] = [];
    ws = new WebSocket(`${base.replace('http', 'ws')}/ws`);
    await new Promise<void>((resolveDone, reject) => {
      const timer = setTimeout(() => reject(new Error('Terminal session timed out')), 5000);
      ws!.on('open', () => ws!.send(JSON.stringify({ type: 'terminal_start', target: 'local', workdir: root })));
      ws!.on('message', data => {
        const event = JSON.parse(data.toString());
        events.push(event);
        if (event.type === 'terminal_started') {
          ws!.send(JSON.stringify({ type: 'terminal_input', sessionId: event.id, data: 'printf "ALISA_WS_TERMINAL_OK\\n"\nexit\n' }));
        }
        if (event.type === 'terminal_exit') { clearTimeout(timer); resolveDone(); }
      });
      ws!.on('error', reject);
    });
    const started = events.find(event => event.type === 'terminal_started');
    expect(started.kind).toBe('local');
    expect(events.some(event => event.type === 'terminal_output' && event.data.includes('ALISA_WS_TERMINAL_OK'))).toBe(true);
    expect(events.some(event => event.type === 'terminal_error')).toBe(false);
  } finally {
    ws?.close();
    child.kill();
    await child.exited;
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);
