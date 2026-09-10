// Reproducible UI smoke-test environment. Never reads the user's provider credentials.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'alisa-ui-'));
writeFileSync(join(root, 'hello.ts'), 'export const greeting = "Hello Alisa";\n');
const provider = Bun.serve({ port: 0, async fetch(req) {
  if (new URL(req.url).pathname === '/models') return Response.json({ data: [{ id: 'test-coding-model' }] });
  const { messages } = await req.json() as any;
  const delta = messages.at(-1).role === 'tool'
    ? { content: 'Verified the workspace. The tool completed successfully.\n\n```ts\nexport const greeting = "Hello Alisa";\n```' }
    : { tool_calls: [{ index: 0, id: crypto.randomUUID(), function: { name: 'terminal', arguments: '{"command":"echo Alisa verified"}' } }] };
  return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n`);
}});
writeFileSync(join(root, '.ichigo-config.json'), JSON.stringify({ workspaceDir: root, apiKey: 'fixture-only', baseURL: provider.url.toString(), model: 'test-coding-model' }));
const backend = Bun.spawn([process.execPath, resolve('src/server/index.ts')], { env: { ...process.env, PORT: '3001', ALISA_CONFIG_DIR: root }, stdout: 'inherit', stderr: 'inherit' });
console.log('UI fixture ready. Start bun run dev and open http://127.0.0.1:3050');
const stop = () => { backend.kill(); provider.stop(true); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
await backend.exited;
rmSync(root, { recursive: true, force: true });
