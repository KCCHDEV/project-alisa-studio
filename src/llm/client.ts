import type { Message, ToolCall } from '../core/types.ts';

export interface LLMConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface StreamCallbacks {
  onToken?: (token: string) => void;
  onThought?: (thought: string) => void;
  onToolCall?: (toolCall: ToolCall) => void;
}

export class LLMClient {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = {
      ...config,
      baseURL: config.baseURL.replace(/\/+$/, ''),
      temperature: config.temperature ?? 0.2,
      maxTokens: config.maxTokens ?? 4096,
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
   * Stream a chat completion with support for tool calling
   */
  async chatStream(
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

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000),
    });

    if (!response.ok) {
      const errText = await response.text();
      let hint = '';
      if (response.status === 400 && (errText.includes('ambiguous') || errText.includes('prefix') || errText.includes('provider'))) {
        hint = ' [OmniRoute Hint: โปรดระบุ Exact Provider Prefix เช่น in-ai/gemini-2.5-flash หรือ t3chat/gemini-2.5-flash]';
      }
      throw new Error(`LLM API Error (${response.status}): ${errText}${hint}`);
    }

    if (!response.body) {
      throw new Error('LLM API returned empty response body');
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
      if (json.error) throw new Error(json.error.message || 'Provider stream failed');
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
        const { done, value } = await reader.read();
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
