import { z } from 'zod';

export type Role = 'system' | 'user' | 'assistant' | 'tool';

/** Execution modes exposed by the Codex-style workspace UI. */
export type AgentMode = 'ask' | 'plan' | 'code' | 'auto';

export type PlanItemStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

export interface PlanItem {
  id: string;
  title: string;
  status: PlanItemStatus;
}

export type GoalStatus = 'active' | 'completed' | 'paused' | 'blocked';

export interface GoalStep {
  id: string;
  title: string;
  status: PlanItemStatus;
}

export interface Goal {
  id: string;
  title: string;
  description?: string;
  status: GoalStatus;
  progress: number;
  steps: GoalStep[];
  createdAt: number;
  updatedAt: number;
}

export type SwarmAgentRole = 'explorer' | 'planner' | 'builder' | 'reviewer';
export type SwarmAgentStatus = 'queued' | 'working' | 'done' | 'error' | 'cancelled';

export interface SwarmAgent {
  id: string;
  role: SwarmAgentRole;
  label: string;
  status: SwarmAgentStatus;
  detail?: string;
  model?: string;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
}

export interface ContextUsage {
  usedTokens: number;
  maxTokens: number;
  percent: number;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  timestamp: number;
  metadata?: {
    thought?: string;
    model?: string;
    tokensUsed?: number;
    cost?: number;
    error?: boolean;
    retryable?: boolean;
  };
}

export interface ToolDefinition<TParams = any, TResult = any> {
  name: string;
  description: string;
  parameters: z.ZodType<TParams>;
  execute: (args: TParams, context: ExecutionContext) => Promise<TResult>;
  requiresApproval?: boolean;
}

export interface ExecutionContext {
  cwd: string;
  sessionId: string;
  env: Record<string, string>;
  emitEvent: (event: AgentEvent) => void;
  signal?: AbortSignal;
  requestApproval?: (action: string, details: Record<string, any>) => Promise<boolean>;
  goal?: Goal;
  updateGoal?: (goal: Goal | undefined) => void;
}

export type AgentStatus = 'idle' | 'thinking' | 'acting' | 'waiting_approval' | 'self_correcting' | 'error' | 'done';

export interface AgentEventMeta {
  agentId?: string;
  agentRole?: SwarmAgentRole;
}

export type AgentEvent =
  | ({ type: 'status_change'; status: AgentStatus; detail?: string } & AgentEventMeta)
  | ({ type: 'token_stream'; delta: string } & AgentEventMeta)
  | ({ type: 'thought_stream'; delta: string } & AgentEventMeta)
  | ({ type: 'stream_reset' } & AgentEventMeta)
  | ({ type: 'retry_attempt'; attempt: number; maxRetries: number; error: string; delayMs: number } & AgentEventMeta)
  | ({ type: 'context_usage'; usage: ContextUsage } & AgentEventMeta)
  | ({ type: 'plan_update'; items: PlanItem[] } & AgentEventMeta)
  | ({ type: 'goal_update'; goal?: Goal } & AgentEventMeta)
  | ({ type: 'swarm_update'; agents: SwarmAgent[]; phase?: string } & AgentEventMeta)
  | ({ type: 'tool_call_start'; toolName: string; toolCallId: string; args: Record<string, any> } & AgentEventMeta)
  | ({ type: 'tool_call_end'; toolName: string; toolCallId: string; result: any; error?: string } & AgentEventMeta)
  | ({ type: 'approval_requested'; action: string; details: Record<string, any>; resolveId: string } & AgentEventMeta)
  | ({ type: 'message_added'; message: Message } & AgentEventMeta)
  | ({ type: 'session_updated'; activeFile?: string; modifiedFiles?: string[] } & AgentEventMeta)
  | ({ type: 'error'; message: string } & AgentEventMeta);

export interface SessionState {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  messages: Message[];
  activePlan: string[];
  modifiedFiles: string[];
  status: AgentStatus;
  mode?: AgentMode;
  plan?: PlanItem[];
  goal?: Goal;
  swarm?: boolean;
  contextUsage?: ContextUsage;
}
