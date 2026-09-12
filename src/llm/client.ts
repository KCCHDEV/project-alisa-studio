import type { Message, ToolCall } from '../core/types.ts';

export interface RetryInfo {
  attempt: number;
  maxRetries: number;
  error: Error;
  delayMs: number;
  willRetry: boolean;
}

export interface LLMConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  connectTimeoutMs?: number;
  streamInactivityTimeoutMs?: number;
}

export interface StreamCallbacks {
  onToken?: (token: string) => void;
  onThought?: (thought: string) => void;
  onToolCall?: (toolCall: ToolCall) => void;
  onRetry?: (info: RetryInfo) => void;
  onResetPartialStream?: () => void;
}

const isTestEnv = typeof process !== 'undefined' && (Boolean(process.env?.NODE_ENV === 'test') || Boolean(process.env?.BUN_TEST));

export function isRetryableError(err: any): boolean {
  if (!err) return false;
  const msg = (err.message || String(err)).toLowerCase();
  const status = typeof err.status === 'number' ? err.status : undefined;

  // Explicit user abort should not be retried
  if (msg.includes('task aborted') || msg.includes('user aborted')) {
    return false;
  }

  // Non-retryable HTTP status codes
  if (status === 401 || status === 403 || status === 404) return false;
  if (status === 400 && !msg.includes('rate limit') && !msg.includes('overloaded')) return false;

  // Retryable HTTP status codes: 429 (rate limit), 408 (timeout), 500, 502, 503, 504
  if (status === 429 || status === 408 || (status && status >= 500 && status <= 599)) return true;

  // Check error message patterns
  if (
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('bad gateway') ||
    msg.includes('service unavailable') ||
    msg.includes('gateway timeout') ||
    msg.includes('gateway unavailable') ||
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('econnrefused') ||
    msg.includes('socket') ||
    msg.includes('stalled') ||
    msg.includes('stream ended before completion') ||
    msg.includes('incomplete tool call') ||
    msg.includes('malformed streaming data') ||
    msg.includes('provider stream failed') ||
    msg.includes('timed out')
  ) {
    return true;
  }

  return false;
}

function delayWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Task aborted'));
    let timer: any;
    const abortHandler = () => {
      clearTimeout(timer);
      reject(new Error('Task aborted'));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', abortHandler);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abortHandler, { once: true });
  });
}

function readWithTimeout<T>(
  readPromise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  signal?: AbortSignal
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: any;
    const abortHandler = () => {
      clearTimeout(timer);
      reject(new Error('Task aborted'));
    };
    if (signal?.aborted) {
      return reject(new Error('Task aborted'));
    }
    signal?.addEventListener('abort', abortHandler, { once: true });

    timer = setTimeout(() => {
      signal?.removeEventListener('abort', abortHandler);
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    readPromise.then(
      val => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abortHandler);
        resolve(val);
      },
      err => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abortHandler);
        reject(err);
      }
    );
  });
}

export class LLMClient {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = {
      ...config,
      baseURL: config.baseURL.replace(/\/+$/, ''),
      temperature: config.temperature ?? 0.2,
      maxTokens: config.maxTokens ?? 4096,
      maxRetries: config.maxRetries ?? (isTestEnv ? 1 : 3),
      retryDelayMs: config.retryDelayMs ?? (isTestEnv ? 10 : 1500),
      connectTimeoutMs: config.connectTimeoutMs ?? 45000,
      streamInactivityTimeoutMs: config.streamInactivityTimeoutMs ?? 25000,
    };
  }

  updateConfig(config: Partial<LLMConfig>) {
    this.config = {
      ...this.config,
      ...config,
      ...(config.baseURL ? { baseURL: config.baseURL.replace(/\/+$/, '') } : {}),
    };
  }

  getConfig(): LLMConfig {
    return { ...this.config };
  }

  /**
   * Stream a chat completion with support for tool calling and automatic retry
   */
  async chatStream(
    messages: Message[],
    tools: Array<{ type: 'function'; function: any }>,
    callbacks: StreamCallbacks,
    signal?: AbortSignal
  ): Promise<{ content: string; thought: string; toolCalls: ToolCall[]; finishReason: string; model: string }> {
    const maxAttempts = this.config.maxRetries ?? (isTestEnv ? 1 : 3);
    const initialDelay = this.config.retryDelayMs ?? (isTestEnv ? 10 : 1500);

    let lastError: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal?.aborted) throw new Error('Task aborted');
      try {
        return await this.executeChatStream(messages, tools, callbacks, signal);
      } catch (err: any) {
        lastError = err;
        const retryable = isRetryableError(err);
        const hasMoreAttempts = attempt < maxAttempts;

        if (!hasMoreAttempts || !retryable || signal?.aborted) {
          throw err;
        }

        callbacks.onResetPartialStream?.();
        const delayMs = Math.min(12000, Math.round(initialDelay * Math.pow(1.8, attempt - 1) + Math.random() * 300));
        callbacks.onRetry?.({ attempt, maxRetries: maxAttempts, error: err, delayMs, willRetry: true });
        await delayWithSignal(delayMs, signal);
      }
    }
    throw lastError || new Error('LLM execution failed after retries');
  }

  private async executeChatStream(
    messages: Message[],
    tools: Array<{ type: 'function'; function: any }>,
    callbacks: StreamCallbacks,
    signal?: AbortSignal
  ): Promise<{ content: string; thought: string; toolCalls: ToolCall[]; finishReason: string; model: string }> {
    const formattedMessages = messages.map(m => {
      const msg: any = {
        role: m.role,
        content: m.content || '',
      };
      if (m.name) msg.name = m.name;
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.tool_calls && m.tool_calls.length > 0) {
        msg.tool_calls = m.tool_calls;
      }
      return msg;
    });

    const body: any = {
      model: this.config.model,
      messages: formattedMessages,
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
      stream: true,
    };

    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const endpoint = `${this.config.baseURL}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'HTTP-Referer': 'https://ichigo.agent',
      'X-Title': 'Ichigo Agent',
    };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;

    const connectTimeoutMs = this.config.connectTimeoutMs ?? 45000;
    const inactivityTimeoutMs = this.config.streamInactivityTimeoutMs ?? 25000;

    const abortTimeout = AbortSignal.timeout(connectTimeoutMs);
    const fetchSignal = signal ? AbortSignal.any([signal, abortTimeout]) : abortTimeout;

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: fetchSignal,
      });
    } catch (fetchErr: any) {
      if (signal?.aborted) throw new Error('Task aborted');
      if (abortTimeout.aborted) {
        const timeoutErr: any = new Error(`OmniRoute connection timed out (${Math.round(connectTimeoutMs / 1000)}s) while waiting for gateway response`);
        timeoutErr.status = 504;
        throw timeoutErr;
      }
      throw fetchErr;
    }

    if (!response.ok) {
      const errText = await response.text();
      let hint = '';
      if (response.status === 400 && (errText.includes('ambiguous') || errText.includes('prefix') || errText.includes('provider'))) {
        hint = ' [OmniRoute Hint: โปรดระบุ Exact Provider Prefix เช่น in-ai/gemini-2.5-flash หรือ t3chat/gemini-2.5-flash]';
      }
      const err: any = new Error(`LLM API Error (${response.status}): ${errText}${hint}`);
      err.status = response.status;
      throw err;
    }

    if (!response.body) {
      const emptyErr: any = new Error('LLM API returned empty response body');
      emptyErr.status = 502;
      throw emptyErr;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullContent = '';
    let fullThought = '';
    let toolCallsMap = new Map<number, { id: string; name: string; args: string }>();
    let finishReason = '';
    let resolvedModel = this.config.model;
    let completed = false;

    const consume = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') { completed = true; return; }
      let json: any;
      try {
        json = JSON.parse(payload);
      } catch {
        throw new Error('Provider returned malformed streaming data. Please retry or check the gateway response.');
      }
      if (json.error) {
        const streamErr: any = new Error(json.error.message || 'Provider stream failed');
        if (typeof json.error.code === 'number') streamErr.status = json.error.code;
        throw streamErr;
      }
      if (typeof json.model === 'string' && json.model.trim()) resolvedModel = json.model.trim();
      const choice = json.choices?.[0];
      if (!choice) return;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta;
      if (!delta) return;
      const thought = delta.reasoning_content || delta.thought;
      if (thought) { fullThought += thought; callbacks.onThought?.(thought); }
      if (delta.content) { fullContent += delta.content; callbacks.onToken?.(delta.content); }
      for (const tc of delta.tool_calls || []) {
        const index = tc.index ?? 0;
        let existing = toolCallsMap.get(index);
        if (!existing) {
          existing = { id: '', name: '', args: '' };
          toolCallsMap.set(index, existing);
        }
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.name += tc.function.name;
        if (tc.function?.arguments) existing.args += tc.function.arguments;
      }
    };

    try {
      while (!completed) {
        const { done, value } = await readWithTimeout(
          reader.read(),
          inactivityTimeoutMs,
          `OmniRoute stream stalled: no data received for ${Math.round(inactivityTimeoutMs / 1000)}s`,
          signal
        );
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) { consume(line); if (completed) break; }
        if (done) { if (buffer.trim() && !completed) consume(buffer); break; }
      }
      if (!completed && !finishReason) throw new Error('Provider stream ended before completion. Please retry.');
      if (finishReason === 'length' || finishReason === 'content_filter') {
        throw new Error(`Provider stopped the response: ${finishReason}`);
      }
      for (const tc of toolCallsMap.values()) {
        if (!tc.id || !tc.name) throw new Error('Provider returned an incomplete tool call');
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }

    const finalToolCalls: ToolCall[] = Array.from(toolCallsMap.values()).map(tc => ({
      id: tc.id,
      type: 'function' as const,
      function: {
        name: tc.name,
        arguments: tc.args,
      }
    }));

    return {
      content: fullContent,
      thought: fullThought,
      toolCalls: finalToolCalls,
      finishReason,
      model: resolvedModel,
    };
  }
}
