import { test, expect } from 'bun:test';
import { LLMClient } from '../src/llm/client';
import { Agent } from '../src/core/agent';
import { ToolRegistry } from '../src/tools/registry';
import { z } from 'zod';
import { SwarmRunner } from '../src/core/swarm';

test('streamed tool names and split arguments survive a complete agent cycle', async () => {
  let requests = 0;
  const events: any[] = [];
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
    const agent = new Agent({ cwd: process.cwd(), toolRegistry: registry, llm: new LLMClient({ baseURL: server.url.toString(), apiKey: '', model: 'test' }), maxIterations: 2, onEvent: event => events.push(event) });
    const messages = await agent.runTask('Check');
    expect(messages.at(-1)?.content).toBe('Finished');
    expect(messages.at(-1)?.metadata?.model).toBe('test');
    expect(events.some(event => event.type === 'context_usage')).toBe(true);
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

test('a completed provider response without text or tools is persisted as an error', async () => {
  const events: any[] = [];
  const llm = {
    chatStream: async () => ({ content: '', thought: '', finishReason: 'stop', toolCalls: [] }),
  } as unknown as LLMClient;
  const agent = new Agent({ cwd: process.cwd(), llm, onEvent: event => events.push(event) });
  const messages = await agent.runTask('Return a useful answer');
  expect(agent.getStatus()).toBe('error');
  expect(events.some(event => event.type === 'error' && event.message.includes('empty answer'))).toBe(true);
  expect(messages.at(-1)?.metadata?.error).toBe(true);
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

test('Plan mode exposes a durable checklist tool while hiding mutation tools', async () => {
  let receivedTools: string[] = [];
  let planUpdates: unknown[] = [];
  let calls = 0;
  const registry = new ToolRegistry();
  registry.register({
    name: 'update_plan',
    description: 'update checklist',
    parameters: z.object({ items: z.array(z.object({ id: z.string(), title: z.string(), status: z.enum(['pending', 'in_progress', 'completed', 'blocked']) })) }),
    async execute(args, context) {
      context.emitEvent({ type: 'plan_update', items: args.items });
      return { success: true };
    },
  });
  registry.register({ name: 'write_file', description: 'mutate file', parameters: z.object({ path: z.string() }), async execute() { throw new Error('must not run'); } });
  const llm = {
    chatStream: async (_messages: unknown, tools: Array<{ function: { name: string } }>) => {
      receivedTools = tools.map(tool => tool.function.name);
      return ++calls === 1
        ? { content: '', thought: '', finishReason: 'tool_calls', toolCalls: [{ id: 'plan1', type: 'function', function: { name: 'update_plan', arguments: JSON.stringify({ items: [{ id: 'inspect', title: 'Inspect workspace', status: 'in_progress' }] }) } }] }
        : { content: 'Plan ready', thought: '', finishReason: 'stop', toolCalls: [] };
    },
  } as unknown as LLMClient;
  const agent = new Agent({ cwd: process.cwd(), llm, toolRegistry: registry, mode: 'plan', onEvent: event => { if (event.type === 'plan_update') planUpdates = event.items; } });
  const messages = await agent.runTask('Plan this change');
  expect(receivedTools).toContain('update_plan');
  expect(receivedTools).not.toContain('write_file');
  expect(planUpdates).toEqual([{ id: 'inspect', title: 'Inspect workspace', status: 'in_progress' }]);
  expect(messages.at(-1)?.content).toBe('Plan ready');
});

test('staged agent swarm runs each role and publishes live worker state', async () => {
  let requests = 0;
  const server = Bun.serve({ port: 0, fetch: () => {
    requests++;
    return new Response('data: ' + JSON.stringify({ model: 'resolved/test-model', choices: [{ delta: { content: 'Worker report complete.' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n', { headers: { 'Content-Type': 'text/event-stream' } });
  }});
  try {
    const events: any[] = [];
    const runner = new SwarmRunner({
      cwd: process.cwd(),
      sessionId: 'swarm-test',
      prompt: 'Inspect and report',
      history: [],
      llmConfig: { baseURL: server.url.toString(), apiKey: '', model: 'test-route' },
      onEvent: event => events.push(event),
    });
    const result = await runner.run();
    expect(result.status).toBe('done');
    expect(result.agents.map(agent => agent.role)).toEqual(['explorer', 'planner', 'builder', 'reviewer']);
    expect(result.agents.every(agent => agent.status === 'done')).toBe(true);
    expect(events.some(event => event.type === 'swarm_update' && event.agents.some((agent: any) => agent.role === 'builder' && agent.status === 'working'))).toBe(true);
    expect(requests).toBe(4);
  } finally { server.stop(true); }
});
