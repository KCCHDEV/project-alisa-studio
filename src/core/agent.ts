import { discoverSkills } from './skills';
import { ToolRegistry } from '../tools/registry.ts';
import { LLMClient, isRetryableError } from '../llm/client.ts';
import { ContextManager, estimateMessageTokens, type ActiveSkill } from './context.ts';
import { ContextCompactor } from './compactor.ts';
import { loadProjectInstructions } from './instructions.ts';
import { TaskSupervisor } from './supervisor.ts';
import type { Goal, Message, AgentEvent, AgentMode, AgentStatus, ToolCall } from './types.ts';

export interface AgentOptions {
  cwd: string;
  llm: LLMClient;
  toolRegistry?: ToolRegistry;
  maxIterations?: number;
  maxRetries?: number;
  mode?: AgentMode;
  sessionId?: string;
  goal?: Goal;
  contextWindow?: number;
  /** Skip approval pauses for tools explicitly marked as approval-gated. */
  autoApprove?: boolean;
  onGoalUpdate?: (goal: Goal | undefined) => void;
  requestApproval?: (action: string, details: Record<string, unknown>, signal: AbortSignal) => Promise<boolean>;
  onEvent?: (event: AgentEvent) => void;
}

const isTestEnv = typeof process !== 'undefined' && (Boolean(process.env?.NODE_ENV === 'test') || Boolean(process.env?.BUN_TEST));

export class Agent {
  private mode: AgentMode;
  private requestApproval?: AgentOptions['requestApproval'];
  private autoApprove = false;
  private cwd: string;
  private llm: LLMClient;
  private tools: ToolRegistry;
  private contextManager: ContextManager;
  private compactor: ContextCompactor;
  private maxIterations: number;
  private maxRetries: number;
  private onEvent?: (event: AgentEvent) => void;
  private sessionId: string;
  private goal?: Goal;
  private contextWindow: number;
  private onGoalUpdate?: AgentOptions['onGoalUpdate'];
  private lastResponseModel = '';
  private isAborted = false;
  private currentAbortController: AbortController | null = null;
  private running = false;
  private status: AgentStatus = 'idle';
  private statusDetail = '';
  private supervisor = new TaskSupervisor();

  constructor(options: AgentOptions) {
    this.mode = options.mode || 'code';
    this.requestApproval = options.requestApproval;
    this.autoApprove = options.autoApprove === true;
    this.cwd = options.cwd;
    this.llm = options.llm;
    this.tools = options.toolRegistry || new ToolRegistry();
    this.contextManager = new ContextManager();
    this.compactor = new ContextCompactor();
    this.maxIterations = options.maxIterations || (isTestEnv ? 25 : 80);
    const llmMaxRetries = (options.llm as any)?.getConfig?.()?.maxRetries;
    this.maxRetries = options.maxRetries ?? (typeof llmMaxRetries === 'number' ? llmMaxRetries : (isTestEnv ? 1 : 100));
    this.onEvent = options.onEvent;
    this.sessionId = options.sessionId || 'current';
    this.goal = options.goal;
    this.contextWindow = Math.max(8_000, Math.round(options.contextWindow || 128_000));
    this.onGoalUpdate = options.onGoalUpdate;
  }

  setStatus(status: AgentStatus, detail?: string) {
    this.status = status;
    this.statusDetail = detail || '';
    this.emit({ type: 'status_change', status, detail });
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  getStatusDetail(): string {
    return this.statusDetail;
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

  private getModelName() {
    const client = this.llm as LLMClient & { getConfig?: () => { model?: string } };
    try { return client.getConfig?.().model || 'unknown'; } catch { return 'unknown'; }
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

    function delayWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
      return new Promise((resolve) => {
        if (signal?.aborted) return resolve();
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    }

    let sessionMessages: Message[];
    const lastHistoryMsg = history.at(-1);
    if (lastHistoryMsg && lastHistoryMsg.role === 'user' && lastHistoryMsg.content === userPrompt) {
      sessionMessages = [...history];
    } else {
      const userMessage: Message = {
        id: `msg_user_${Date.now()}`,
        role: 'user',
        content: userPrompt,
        timestamp: Date.now(),
      };
      sessionMessages = [...history, userMessage];
      this.emit({ type: 'message_added', message: userMessage });
    }
    this.supervisor.reset();

    let iteration = 0;
    let cycleRetries = 0;
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
        this.getWorkspaceContext(),
        this.loadActiveSkills(skillNames),
      );
      const usedTokens = estimateMessageTokens(preparedMessages);
      const percent = Math.min(100, Math.round((usedTokens / this.contextWindow) * 100));
      this.emit({ type: 'context_usage', usage: { usedTokens, maxTokens: this.contextWindow, percent } });
      const readOnlyTools = new Set(['read_file', 'list_directory', 'search_files', 'manage_skill', 'update_plan', 'update_goal']);
      const openAITools = this.tools.toOpenAITools().filter(t => !this.isReadOnlyMode() || readOnlyTools.has(t.function.name));

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
            onResetPartialStream: () => {
              currentResponseContent = '';
              currentThought = '';
              this.emit({ type: 'stream_reset' });
            },
            onRetry: (info) => {
              const seconds = Math.max(1, Math.round(info.delayMs / 1000));
              const shortErr = info.error.message.replace(/^LLM API Error \(\d+\):\s*/i, '').slice(0, 60);
              const detail = `🔄 OmniRoute / Model overload (${shortErr}) กำลังลองใหม่อัตโนมัติ ${info.attempt}/${info.maxRetries} (${seconds}s)...`;
              this.setStatus('thinking', detail);
              this.emit({
                type: 'retry_attempt',
                attempt: info.attempt,
                maxRetries: info.maxRetries,
                error: info.error.message,
                delayMs: info.delayMs,
              });
            },
          },
          this.currentAbortController.signal
        );

        currentResponseContent = result.content;
        currentThought = result.thought;
        toolCalls = result.toolCalls;
        const responseModel = result.model || this.getModelName();
        // Keep the concrete route/model next to the transcript so historical
        // responses remain attributable after the active model changes.
        this.lastResponseModel = responseModel;
      } catch (err: any) {
        if (this.isAborted) break;
        const errMsg = err.message || 'LLM execution failed';
        const isAuthError = errMsg.includes('401') && (errMsg.includes('Unauthorized') || errMsg.includes('Invalid API key'));
        const retryable = isRetryableError(err) || !isAuthError;
        if (retryable && cycleRetries < this.maxRetries) {
          cycleRetries++;
          const waitMs = isTestEnv ? 5 : Math.min(10000, Math.round(1500 * Math.pow(1.25, cycleRetries - 1)));
          const seconds = Math.max(1, Math.round(waitMs / 1000));
          const detail = isRetryableError(err)
            ? `🔄 OmniRoute / Model overload: กำลังลองใหม่รอบที่ ${cycleRetries}/${this.maxRetries} (${seconds}s)...`
            : `🔄 กำลังลองใหม่อัตโนมัติรอบที่ ${cycleRetries}/${this.maxRetries} (${seconds}s)...`;
          this.setStatus('self_correcting', detail);
          this.emit({
            type: 'retry_attempt',
            attempt: cycleRetries,
            maxRetries: this.maxRetries,
            error: errMsg,
            delayMs: waitMs,
          });
          await delayWithSignal(waitMs, this.currentAbortController?.signal);
          iteration--;
          continue;
        }

        this.emit({ type: 'error', message: errMsg });
        this.setStatus('error', errMsg);
        
        const errorAssistantMsg: Message = {
          id: `msg_err_${Date.now()}`,
          role: 'assistant',
          content: `[Error] เกิดข้อผิดพลาดในการเรียกโมเดล: ${errMsg}`,
          timestamp: Date.now(),
          metadata: { error: true, retryable, model: this.getModelName() },
        };
        sessionMessages.push(errorAssistantMsg);
        this.emit({ type: 'message_added', message: errorAssistantMsg });
        break;
      }

      if (!toolCalls.length && !currentResponseContent.trim()) {
        if (cycleRetries < this.maxRetries && !this.isAborted) {
          cycleRetries++;
          const waitMs = isTestEnv ? 5 : Math.min(8000, Math.round(1000 * Math.pow(1.25, cycleRetries - 1)));
          const seconds = Math.max(1, Math.round(waitMs / 1000));
          this.setStatus('self_correcting', `⚠️ โมเดลตอบกลับว่างเปล่า (Empty answer): กำลังลองใหม่อัตโนมัติ ${cycleRetries}/${this.maxRetries} (${seconds}s)...`);
          this.emit({
            type: 'retry_attempt',
            attempt: cycleRetries,
            maxRetries: this.maxRetries,
            error: 'Empty answer from provider',
            delayMs: waitMs,
          });
          await delayWithSignal(waitMs, this.currentAbortController?.signal);
          iteration--;
          continue;
        }

        const emptyMessage = 'The provider returned an empty answer. Retry the task or choose another model.';
        this.emit({ type: 'error', message: emptyMessage });
        this.setStatus('error', emptyMessage);
        const errorAssistantMsg: Message = {
          id: `msg_err_${Date.now()}`,
          role: 'assistant',
          content: `[Error] ${emptyMessage}`,
          timestamp: Date.now(),
          metadata: { error: true, model: this.getModelName() },
        };
        sessionMessages.push(errorAssistantMsg);
        this.emit({ type: 'message_added', message: errorAssistantMsg });
        break;
      }

      // Reset consecutive cycle retries upon successful model output
      cycleRetries = 0;

      // Add assistant message to session
      const assistantMessage: Message = {
        id: `msg_asst_${Date.now()}`,
        role: 'assistant',
        content: currentResponseContent,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        timestamp: Date.now(),
        metadata: {
          thought: currentThought || undefined,
          model: this.lastResponseModel || this.getModelName(),
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

        // Supervisor real-time drift detection ("งานเริ่มออกนอกลู่นอกทาง โทรสั่งงาน")
        const drift = this.supervisor.recordToolCallAndCheckDrift(toolName, parsedArgs, userPrompt);
        if (drift.hasDrift && drift.directive) {
          this.emit({
            type: 'supervisor_intervention',
            directive: drift.directive,
            reason: 'drift',
          });
          this.setStatus('self_correcting', '📞 Supervisor โทรสั่งงาน: ปรับทิศทางไม่ให้ออกนอกลู่ทาง');
          const steeringMsg: Message = {
            id: `msg_supervisor_steering_${Date.now()}_${tc.id}`,
            role: 'user',
            content: drift.directive,
            timestamp: Date.now(),
            metadata: { supervisor: true, directiveType: 'steering' },
          };
          sessionMessages.push(steeringMsg);
          this.emit({ type: 'message_added', message: steeringMsg });
        }

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
            if (this.isReadOnlyMode() && !readOnlyTools.has(toolName)) throw new Error(`${this.mode[0].toUpperCase()}${this.mode.slice(1)} mode allows reading and planning only`);
            if (toolDef.requiresApproval && !this.autoApprove) {
              this.setStatus('waiting_approval', `Approve ${toolName} to continue`);
              const approved = await this.requestApproval?.(toolName, parsedArgs, this.currentAbortController.signal);
              if (!approved || this.isAborted) throw new Error('Tool execution was not approved');
              this.setStatus('acting', `Executing ${toolName}`);
            }
            const execResult = await toolDef.execute(validatedArgs, {
              cwd: this.cwd,
              sessionId: this.sessionId,
              env: {},
              signal: this.currentAbortController.signal,
              emitEvent: (ev) => this.emit(ev),
              goal: this.goal,
              updateGoal: (nextGoal) => {
                this.goal = nextGoal;
                this.onGoalUpdate?.(nextGoal);
                this.emit({ type: 'goal_update', goal: nextGoal });
              },
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

    // If the loop finished and the last message is a tool or there is no text report from assistant,
    // give the model a final turn to summarize its work clearly.
    const lastAsstWithContent = sessionMessages.slice().reverse().find(m => m.role === 'assistant' && m.content?.trim());
    const needsSummary = !lastAsstWithContent || sessionMessages.at(-1)?.role === 'tool';
    if (!this.isAborted && needsSummary) {
      try {
        const compResult = this.compactor.compactMessages(sessionMessages);
        const preparedMessages = this.contextManager.prepareMessages(
          compResult.compacted,
          this.getWorkspaceContext(),
          this.loadActiveSkills(skillNames),
        );
        preparedMessages.push({
          id: `msg_summary_req_${Date.now()}`,
          role: 'user',
          content: 'Please provide a clear and concise final report summarizing the operations completed in the workspace, files created or modified, verification results, and current status.',
          timestamp: Date.now(),
        });
        const finalResult = await this.llm.chatStream(preparedMessages, [], {
          onToken: (delta) => this.emit({ type: 'token_stream', delta }),
          onThought: (delta) => this.emit({ type: 'thought_stream', delta }),
        }, this.currentAbortController?.signal);

        if (finalResult.content.trim()) {
          const finalAsstMsg: Message = {
            id: `msg_asst_${Date.now()}`,
            role: 'assistant',
            content: finalResult.content,
            timestamp: Date.now(),
            metadata: { model: finalResult.model || this.getModelName() },
          };
          sessionMessages.push(finalAsstMsg);
          this.emit({ type: 'message_added', message: finalAsstMsg });
        }
      } catch {
        // Best effort summary
      }
    }

    if (!this.isAborted && this.status !== 'error') {
      this.setStatus('done', this.status === 'done' ? (this.statusDetail || 'Completed') : `Completed ${iteration} cycles.`);
    }
    if (this.isAborted) this.setStatus('idle', 'Cancelled');
    return sessionMessages;
    } finally {
      this.running = false;
      this.currentAbortController = null;
    }
  }

  private isReadOnlyMode() {
    return this.mode === 'ask' || this.mode === 'plan';
  }

  private getWorkspaceContext() {
    const instructionText = loadProjectInstructions(this.cwd);
    const modeText = this.mode === 'ask'
      ? 'Ask mode: inspect and explain only. Do not modify files or run shell commands.'
      : this.mode === 'plan'
        ? 'Plan mode: inspect the workspace and maintain a visible checklist with update_plan. Do not modify files or run shell commands.'
        : this.mode === 'auto'
          ? 'Auto mode: carry the task through to verification. Use the visible checklist for multi-step work.'
          : 'Code mode: inspect before editing, use the visible checklist for multi-step work, then verify the result.';
    const safetyText = this.autoApprove
      ? 'YOLO mode is enabled: execute approval-gated tools without pausing for confirmation. Keep all workspace, read-only mode, and security policy boundaries.'
      : 'Approval-gated tools require an explicit user approval before execution.';
    const goalText = this.goal
      ? `## Active Goal\nTitle: ${this.goal.title}\nStatus: ${this.goal.status}\nProgress: ${this.goal.progress}%${this.goal.description ? `\nDescription: ${this.goal.description}` : ''}`
      : '## Active Goal\nNo persistent goal is set for this session.';
    return [
      `Directory: ${this.cwd}`,
      `Platform: ${process.platform}`,
      'File tools are workspace-scoped. Terminal runs with the OS user permissions.',
      'For multi-step work, keep the persistent goal current with update_goal and the visible checklist current with update_plan.',
      modeText,
      safetyText,
      goalText,
      instructionText ? `\n## Project Instructions\n${instructionText}` : '',
    ].filter(Boolean).join('\n');
  }
}
