import { ToolRegistry } from '../tools/registry.ts';
import { LLMClient } from '../llm/client.ts';
import { ContextManager } from './context.ts';
import { ContextCompactor } from './compactor.ts';
import type { Message, AgentEvent, AgentStatus, ToolCall, SessionState } from './types.ts';

export interface AgentOptions {
  cwd: string;
  llm: LLMClient;
  toolRegistry?: ToolRegistry;
  maxIterations?: number;
  onEvent?: (event: AgentEvent) => void;
}

export class Agent {
  private cwd: string;
  private llm: LLMClient;
  private tools: ToolRegistry;
  private contextManager: ContextManager;
  private compactor: ContextCompactor;
  private maxIterations: number;
  private onEvent?: (event: AgentEvent) => void;
  private isAborted = false;
  private currentAbortController: AbortController | null = null;
  private status: AgentStatus = 'idle';

  constructor(options: AgentOptions) {
    this.cwd = options.cwd;
    this.llm = options.llm;
    this.tools = options.toolRegistry || new ToolRegistry();
    this.contextManager = new ContextManager();
    this.compactor = new ContextCompactor();
    this.maxIterations = options.maxIterations || 25;
    this.onEvent = options.onEvent;
  }

  setStatus(status: AgentStatus, detail?: string) {
    this.status = status;
    this.emit({ type: 'status_change', status, detail });
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  emit(event: AgentEvent) {
    this.onEvent?.(event);
  }

  abort() {
    this.isAborted = true;
    this.currentAbortController?.abort();
    this.setStatus('idle', 'Cancelled by user');
  }

  /**
   * Run a complete ReAct task loop
   */
  async runTask(userPrompt: string, history: Message[] = []): Promise<Message[]> {
    this.isAborted = false;
    this.currentAbortController = new AbortController();

    const userMessage: Message = {
      id: `msg_user_${Date.now()}`,
      role: 'user',
      content: userPrompt,
      timestamp: Date.now(),
    };

    const sessionMessages: Message[] = [...history, userMessage];
    this.emit({ type: 'message_added', message: userMessage });

    let iteration = 0;

    while (iteration < this.maxIterations) {
      if (this.isAborted) break;
      iteration++;

      this.setStatus('thinking', `Cycle ${iteration}`);

      // Auto-compact context to protect token budget and avoid context overflow
      const compResult = this.compactor.compactMessages(sessionMessages);
      if (compResult.wasCompacted) {
        this.emit({ 
          type: 'status_change', 
          status: 'thinking', 
          detail: `ประหยัด Token: บีบอัด Context แล้ว (${compResult.charsSaved} ตัวอักษร)` 
        });
      }

      const preparedMessages = this.contextManager.prepareMessages(compResult.compacted);
      const openAITools = this.tools.toOpenAITools();

      let currentResponseContent = '';
      let currentThought = '';
      let toolCalls: ToolCall[] = [];

      try {
        const result = await this.llm.chatStream(
          preparedMessages,
          openAITools,
          {
            onToken: (delta) => {
              currentResponseContent += delta;
              this.emit({ type: 'token_stream', delta });
            },
            onThought: (delta) => {
              currentThought += delta;
              this.emit({ type: 'thought_stream', delta });
            },
          },
          this.currentAbortController.signal
        );

        currentResponseContent = result.content;
        currentThought = result.thought;
        toolCalls = result.toolCalls;
      } catch (err: any) {
        if (this.isAborted) break;
        const errMsg = err.message || 'LLM execution failed';
        this.emit({ type: 'error', message: errMsg });
        this.setStatus('error', errMsg);
        
        const errorAssistantMsg: Message = {
          id: `msg_err_${Date.now()}`,
          role: 'assistant',
          content: `❌ เกิดข้อผิดพลาดในการเรียกโมเดล: ${errMsg}`,
          timestamp: Date.now(),
          metadata: { error: true },
        };
        sessionMessages.push(errorAssistantMsg);
        this.emit({ type: 'message_added', message: errorAssistantMsg });
        break;
      }

      // Add assistant message to session
      const assistantMessage: Message = {
        id: `msg_asst_${Date.now()}`,
        role: 'assistant',
        content: currentResponseContent,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        timestamp: Date.now(),
        metadata: {
          thought: currentThought || undefined,
        }
      };

      sessionMessages.push(assistantMessage);
      this.emit({ type: 'message_added', message: assistantMessage });

      // If no tool calls, task cycle is complete
      if (!toolCalls || toolCalls.length === 0) {
        this.setStatus('done', 'Completed');
        break;
      }

      // Execute Tool Calls in sequence or parallel
      this.setStatus('acting', `Executing ${toolCalls.length} tool(s)`);

      for (const tc of toolCalls) {
        if (this.isAborted) break;

        const toolName = tc.function.name;
        let parsedArgs: Record<string, any> = {};
        try {
          parsedArgs = JSON.parse(tc.function.arguments || '{}');
        } catch {
          parsedArgs = { raw: tc.function.arguments };
        }

        this.emit({
          type: 'tool_call_start',
          toolName,
          toolCallId: tc.id,
          args: parsedArgs,
        });

        const toolDef = this.tools.get(toolName);
        let toolOutputStr = '';
        let isToolError = false;

        if (!toolDef) {
          toolOutputStr = `Error: Unknown tool "${toolName}"`;
          isToolError = true;
        } else {
          try {
            const execResult = await toolDef.execute(parsedArgs, {
              cwd: this.cwd,
              sessionId: 'current',
              env: {},
              emitEvent: (ev) => this.emit(ev),
            });
            toolOutputStr = typeof execResult === 'string' ? execResult : JSON.stringify(execResult, null, 2);
          } catch (execErr: any) {
            toolOutputStr = `Tool Execution Error: ${execErr.message || String(execErr)}`;
            isToolError = true;
          }
        }

        this.emit({
          type: 'tool_call_end',
          toolName,
          toolCallId: tc.id,
          result: toolOutputStr,
          error: isToolError ? toolOutputStr : undefined,
        });

        // Add tool response message
        const toolMsg: Message = {
          id: `msg_tool_${Date.now()}_${tc.id}`,
          role: 'tool',
          name: toolName,
          tool_call_id: tc.id,
          content: toolOutputStr,
          timestamp: Date.now(),
        };

        sessionMessages.push(toolMsg);
        this.emit({ type: 'message_added', message: toolMsg });
      }
    }

    this.setStatus('idle');
    return sessionMessages;
  }
}
