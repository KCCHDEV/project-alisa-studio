import { test, expect } from 'bun:test';
import { LLMClient } from '../src/llm/client';
import { Agent } from '../src/core/agent';
import { ToolRegistry } from '../src/tools/registry';
import { z } from 'zod';

test('streamed tool names and split arguments survive a complete agent cycle', async () => {
  let requests = 0;
  const server = Bun.serve({ port: 0, async fetch(req) {
    const body = await req.json() as any;
    requests++;
    if (requests === 2) {
      expect(body.messages.at(-1).content).toBe('verified');
      return new Response('data: {"choices":[{"delta":{"content":"Finished"},"finish_reason":"stop"}]}\n\ndata: [DONE]');
    }
    return new Response([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call1', function: { name: 'probe', arguments: '{"value":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"ok"}' } }] }, finish_reason: 'tool_calls' }] },
    ].map(x => `data: ${JSON.stringify(x)}\n\n`).join('') + 'data: [DONE]');
  }});
  try {
    const registry = new ToolRegistry();
    registry.register({ name: 'probe', description: 'test', parameters: z.object({ value: z.literal('ok') }), async execute(args) {
      expect(args.value).toBe('ok');
      return 'verified';
    }});
    const agent = new Agent({ cwd: process.cwd(), toolRegistry: registry, llm: new LLMClient({ baseURL: server.url.toString(), apiKey: '', model: 'test' }), maxIterations: 2 });
    const messages = await agent.runTask('Check');
    expect(messages.at(-1)?.content).toBe('Finished');
    expect(requests).toBe(2);
  } finally { server.stop(true); }
});

test('provider stream errors and truncated streams are failures, not empty successful answers', async () => {
  for (const data of ['data: {"error":{"message":"Gateway unavailable"}}\n\n', 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n']) {
    const server = Bun.serve({ port: 0, fetch: () => new Response(data) });
    try {
      const client = new LLMClient({ baseURL: server.url.toString(), apiKey: '', model: 'test' });
      await expect(client.chatStream([], [], {})).rejects.toThrow();
    } finally { server.stop(true); }
  }
});

test('Ask mode and denied shell approval prevent execution even when the provider calls a forbidden tool', async () => {
  for (const mode of ['ask', 'code'] as const) {
    for (const approved of [false, true]) {
      let executions = 0;
      const registry = new ToolRegistry();
      registry.register({ name: 'terminal', description: 'test terminal', requiresApproval: true, parameters: z.object({ command: z.string() }), async execute() { executions++; return 'executed'; } });
      let calls = 0;
      const llm = { chatStream: async () => ++calls === 1
        ? { content: '', thought: '', finishReason: 'tool_calls', toolCalls: [{ id: 'tc1', type: 'function', function: { name: 'terminal', arguments: '{"command":"echo test"}' } }] }
        : { content: 'Done', thought: '', finishReason: 'stop', toolCalls: [] }
      } as unknown as LLMClient;
      const agent = new Agent({ cwd: process.cwd(), llm, toolRegistry: registry, mode, requestApproval: async () => approved });
      const messages = await agent.runTask('Check');
      expect(executions).toBe(mode === 'code' && approved ? 1 : 0);
      expect(messages.at(-1)?.content).toBe('Done');
    }
  }
});
