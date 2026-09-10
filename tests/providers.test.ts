import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('Provider switcher API: list, switch, add custom, test, and delete', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alisa-providers-'));
  
  // Mock LLM server providing /models
  const mockLLM = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.endsWith('/models')) {
        return new Response(JSON.stringify({
          data: [{ id: 'mock-model-1' }, { id: 'mock-model-2' }]
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('Not found', { status: 404 });
    }
  });

  const portProbe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = portProbe.port!;
  portProbe.stop(true);

  const child = Bun.spawn([process.execPath, resolve('src/server/index.ts')], {
    env: { ...process.env, PORT: String(port), ALISA_CONFIG_DIR: root },
    stdout: 'ignore',
    stderr: 'pipe'
  });
  const base = `http://127.0.0.1:${port}`;

  try {
    let connected = false;
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`${base}/api/config`)).ok) {
          connected = true;
          break;
        }
      } catch {}
      await Bun.sleep(50);
    }
    expect(connected).toBe(true);

    // 1. Initial config should list default providers including OmniRoute
    const cfgRes = await fetch(`${base}/api/config`);
    const cfg = await cfgRes.json() as any;
    expect(Array.isArray(cfg.providers)).toBe(true);
    expect(cfg.providers.some((p: any) => p.id === 'omniroute')).toBe(true);
    expect(cfg.providers.some((p: any) => p.id === 'openrouter')).toBe(true);
    expect(cfg.activeProviderId).toBe('omniroute');

    // 2. Switch provider to OpenRouter
    const switchRes = await fetch(`${base}/api/providers/switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'openrouter' }),
    });
    const switchData = await switchRes.json() as any;
    expect(switchData.success).toBe(true);
    expect(switchData.config.activeProviderId).toBe('openrouter');
    expect(switchData.config.baseURL).toBe('https://openrouter.ai/api/v1');

    // 3. Test provider endpoint against mockLLM
    const testRes = await fetch(`${base}/api/provider/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseURL: mockLLM.url.toString() }),
    });
    const testData = await testRes.json() as any;
    expect(testRes.status).toBe(200);
    expect(testData.models).toEqual(['mock-model-1', 'mock-model-2']);
    expect(testData.message).toContain('Connected successfully');

    // 4. Save a custom provider profile
    const saveRes = await fetch(`${base}/api/providers/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Local Studio Test',
        baseURL: mockLLM.url.toString(),
        apiKey: 'local-test-key',
        model: 'mock-model-1',
        setActive: true,
      }),
    });
    const saveData = await saveRes.json() as any;
    expect(saveData.success).toBe(true);
    expect(saveData.config.model).toBe('mock-model-1');
    const custom = saveData.config.providers.find((p: any) => p.name === 'Local Studio Test');
    expect(custom).toBeDefined();
    expect(saveData.config.activeProviderId).toBe(custom.id);

    // 5. Delete custom provider profile
    const delRes = await fetch(`${base}/api/providers/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: custom.id }),
    });
    const delData = await delRes.json() as any;
    expect(delData.success).toBe(true);
    expect(delData.config.providers.some((p: any) => p.id === custom.id)).toBe(false);

    // 6. Refuse to delete built-in preset
    const badDel = await fetch(`${base}/api/providers/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'omniroute' }),
    });
    expect(badDel.status).toBe(400);

  } finally {
    child.kill();
    await child.exited;
    mockLLM.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);
