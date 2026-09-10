import { discoverSkills } from './skills';
import { ToolRegistry } from '../tools/registry.ts';
import { LLMClient } from '../llm/client.ts';
import { ContextManager, type ActiveSkill } from './context.ts';
import { ContextCompactor } from './compactor.ts';
import type { Message, AgentEvent, AgentStatus, ToolCall } from './types.ts';

export interface AgentOptions {
  cwd: string;
  llm: LLMClient;
  toolRegistry?: ToolRegistry;
  maxIterations?: number;
  mode?: 'ask' | 'code';
  requestApproval?: (action: string, details: Record<string, unknown>, signal: AbortSignal) => Promise<boolean>;
  onEvent?: (event: AgentEvent) => void;
}

export class Agent {
  private mode: 'ask' | 'code';
  private requestApproval?: AgentOptions['requestApproval'];
  private cwd: string;
  private llm: LLMClient;
  private tools: ToolRegistry;
  private contextManager: ContextManager;
  private compactor: ContextCompactor;
  private maxIterations: number;
  private onEvent?: (event: AgentEvent) => void;
  private isAborted = false;
  private currentAbortController: AbortController | null = null;
  private running = false;
  private status: AgentStatus = 'idle';

  constructor(options: AgentOptions) {
    this.mode = options.mode || 'code';
    this.requestApproval = options.requestApproval;
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

  setWorkspace(cwd: string) {
    if (this.running) throw new Error("Stop the active task before changing workspace");
    this.cwd = cwd;
  }

  private loadActiveSkills(skillNames: string[]): ActiveSkill[] {
    const selected = new Set(skillNames.slice(0, 20));
    return discoverSkills(this.cwd).filter(skill => selected.has(skill.name));
  }

  emit(event: AgentEvent) {
    this.onEvent?.(event);
  }

  abort() {
    this.isAborted = true;
    this.currentAbortController?.abort();
    // Stay busy until the stream and active tool have stopped.
  }

  /**
   * Run a complete ReAct task loop
   */
  async runTask(userPrompt: string, history: Message[] = [], skillNames: string[] = []): Promise<Message[]> {
    if (this.running) throw new Error("A task is already running");
    this.running = true;
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
    try {
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

      const preparedMessages = this.contextManager.prepareMessages(
        compResult.compacted,
        `Directory: ${this.cwd}\nPlatform: ${process.platform}. File tools are workspace-scoped. Terminal runs with the OS user permissions.`,
        this.loadActiveSkills(skillNames),
      );
      const readOnlyTools = new Set(['read_file', 'list_directory', 'search_files', 'manage_skill']);
      const openAITools = this.tools.toOpenAITools().filter(t => this.mode !== 'ask' || readOnlyTools.has(t.function.name));

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

        if (this.isAborted) {
          toolOutputStr = 'Cancelled before execution';
          isToolError = true;
        } else if (!toolDef) {
          toolOutputStr = `Error: Unknown tool "${toolName}"`;
          isToolError = true;
        } else {
          try {
            const validatedArgs = toolDef.parameters.parse(parsedArgs);
            if (this.mode === 'ask' && !readOnlyTools.has(toolName)) throw new Error('Ask mode allows reading only');
            if (toolDef.requiresApproval) {
              this.setStatus('waiting_approval', `Approve ${toolName} to continue`);
              const approved = await this.requestApproval?.(toolName, parsedArgs, this.currentAbortController.signal);
              if (!approved || this.isAborted) throw new Error('Tool execution was not approved');
              this.setStatus('acting', `Executing ${toolName}`);
            }
            const execResult = await toolDef.execute(validatedArgs, {
              cwd: this.cwd,
              sessionId: 'current',
              env: {},
              signal: this.currentAbortController.signal,
              emitEvent: (ev) => this.emit(ev),
            });
            if (execResult && typeof execResult === 'object' && (('exitCode' in execResult && execResult.exitCode !== 0) || execResult.success === false)) isToolError = true;
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
          metadata: { error: isToolError },
        };

        sessionMessages.push(toolMsg);
        this.emit({ type: 'message_added', message: toolMsg });
      }
    }

    if (!this.isAborted && iteration >= this.maxIterations && this.status !== 'done' && this.status !== 'error') {
      this.setStatus('error', `Stopped after ${this.maxIterations} cycles. Review progress and continue the task.`);
    }
    if (this.isAborted) this.setStatus('idle', 'Cancelled');
    return sessionMessages;
    } finally {
      this.running = false;
      this.currentAbortController = null;
    }
  }
}
