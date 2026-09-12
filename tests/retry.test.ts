import { test, expect } from 'bun:test';
import { LLMClient, isRetryableError } from '../src/llm/client';

test('isRetryableError correctly classifies errors', () => {
  expect(isRetryableError(new Error('LLM API Error (502): Bad Gateway'))).toBe(true);
  expect(isRetryableError(new Error('LLM API Error (429): Rate limit exceeded'))).toBe(true);
  expect(isRetryableError(new Error('LLM API Error (504): Gateway Timeout'))).toBe(true);
  expect(isRetryableError(new Error('fetch failed: Connection reset by peer'))).toBe(true);
  expect(isRetryableError(new Error('OmniRoute stream stalled: no data received for 25s'))).toBe(true);
  expect(isRetryableError(new Error('Provider stream ended before completion. Please retry.'))).toBe(true);

  // Non-retryable
  expect(isRetryableError(new Error('LLM API Error (401): Unauthorized'))).toBe(false);
  expect(isRetryableError(new Error('LLM API Error (403): Forbidden'))).toBe(false);
  expect(isRetryableError(new Error('LLM API Error (404): Model not found'))).toBe(false);
  expect(isRetryableError(new Error('Task aborted'))).toBe(false);
});

test('LLMClient auto-retries on 502/429 and succeeds on subsequent attempt', async () => {
  let callCount = 0;
  const retryEvents: any[] = [];
  const server = Bun.serve({
    port: 0,
    fetch() {
      callCount++;
      if (callCount === 1) {
        return new Response('Bad Gateway', { status: 502 });
      }
      return new Response(
        'data: {"choices":[{"delta":{"content":"Recovered successfully"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } }
      );
    },
  });

  try {
    const client = new LLMClient({
      baseURL: server.url.toString(),
      apiKey: '',
      model: 'test-retry',
      maxRetries: 3,
      retryDelayMs: 20,
    });

    const result = await client.chatStream([], [], {
      onRetry: info => retryEvents.push(info),
    });

    expect(callCount).toBe(2);
    expect(result.content).toBe('Recovered successfully');
    expect(retryEvents.length).toBe(1);
    expect(retryEvents[0].attempt).toBe(1);
    expect(retryEvents[0].maxRetries).toBe(3);
  } finally {
    server.stop(true);
  }
});

test('LLMClient does not retry non-retryable 401 Unauthorized', async () => {
  let callCount = 0;
  const server = Bun.serve({
    port: 0,
    fetch() {
      callCount++;
      return new Response('Unauthorized', { status: 401 });
    },
  });

  try {
    const client = new LLMClient({
      baseURL: server.url.toString(),
      apiKey: 'bad-key',
      model: 'test-401',
      maxRetries: 3,
      retryDelayMs: 20,
    });

    await expect(client.chatStream([], [], {})).rejects.toThrow('401');
    expect(callCount).toBe(1); // Should fail on first attempt without retrying
  } finally {
    server.stop(true);
  }
});
