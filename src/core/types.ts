import { z } from 'zod';

export type Role = 'system' | 'user' | 'assistant' | 'tool';

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
  requestApproval?: (action: string, details: Record<string, any>) => Promise<boolean>;
}

export type AgentStatus = 'idle' | 'thinking' | 'acting' | 'waiting_approval' | 'self_correcting' | 'error' | 'done';

export type AgentEvent =
  | { type: 'status_change'; status: AgentStatus; detail?: string }
  | { type: 'token_stream'; delta: string }
  | { type: 'thought_stream'; delta: string }
  | { type: 'tool_call_start'; toolName: string; toolCallId: string; args: Record<string, any> }
  | { type: 'tool_call_end'; toolName: string; toolCallId: string; result: any; error?: string }
  | { type: 'approval_requested'; action: string; details: Record<string, any>; resolveId: string }
  | { type: 'message_added'; message: Message }
  | { type: 'session_updated'; activeFile?: string; modifiedFiles?: string[] }
  | { type: 'error'; message: string };

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
}
