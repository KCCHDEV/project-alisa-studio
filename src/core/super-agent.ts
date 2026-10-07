import { Agent, type AgentOptions } from './agent.ts';
import { ToolRegistry } from '../tools/registry.ts';
import { COORDINATOR_TOOLS, coordinatorSystemPrompt } from './coordinator.ts';
import { LLMClient } from '../llm/client.ts';
import type { AgentEvent, CoordinatorBridge, Goal, Message } from './types.ts';

export interface SuperAgentOptions {
  cwd: string;
  sessionId: string;
  /** The goal the coordinator has to satisfy. */
  goal: string;
  coordinator: CoordinatorBridge;
  workspace: string;
  maxParallel: number;
  cliAgents: Array<{ id: string; label: string }>;
  autoApprove: boolean;
  llmConfig: ConstructorParameters<typeof LLMClient>[0];
  contextWindow?: number;
  maxIterations?: number;
  /** Existing session goal to track, distinct from the `goal` task text. */
  sessionGoal?: Goal;
  onEvent: (event: AgentEvent) => void;
  onGoalUpdate?: (goal: Goal | undefined) => void;
  requestApproval?: AgentOptions['requestApproval'];
}

export interface SuperAgentResult {
  status: 'done' | 'error' | 'cancelled';
  detail: string;
  /** Final assistant message, used as the coordinator's own report. */
  summary: string;
  messages: Message[];
  workersStarted: number;
}

/**
 * Build the coordinator's tool set.
 *
 * It keeps the ordinary worker tools, because a coordinator still has to read
 * code to write good subtask prompts, and adds the coordination tools on top.
 */
export function createCoordinatorToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of COORDINATOR_TOOLS) registry.register(tool);
  return registry;
}

/**
 * Run the Super Agent: one agent whose tools include delegating work to other
 * agents and verifying the result with the project's own checks.
 *
 * The coordinator bridge is attached to the agent rather than passed per tool
 * call, so a worker agent — which never sets it — cannot reach the delegation
 * tools even if it guesses a tool name.
 */
export async function runSuperAgent(options: SuperAgentOptions): Promise<SuperAgentResult> {
  const startedWorkers = new Set<string>();
  const bridge: CoordinatorBridge = {
    ...options.coordinator,
    listWorkers: () => {
      const workers = options.coordinator.listWorkers();
      for (const worker of workers) startedWorkers.add(worker.id);
      return workers;
    },
  };

  const agent = new Agent({
    cwd: options.cwd,
    sessionId: options.sessionId,
    mode: 'code',
    // The coordinator spends its budget on planning and judging rather than on
    // editing files, but it still needs room for a delegate/poll/merge loop.
    maxIterations: options.maxIterations ?? 80,
    contextWindow: options.contextWindow,
    autoApprove: options.autoApprove,
    goal: options.sessionGoal,
    llm: new LLMClient(options.llmConfig),
    toolRegistry: createCoordinatorToolRegistry(),
    coordinator: bridge,
    requestApproval: options.requestApproval,
    onEvent: options.onEvent,
    onGoalUpdate: options.onGoalUpdate,
  });

  const systemPrompt = coordinatorSystemPrompt({
    workspace: options.workspace,
    maxParallel: options.maxParallel,
    cliAgents: options.cliAgents,
    autoApprove: options.autoApprove,
  });

  const seeded: Message[] = [
    { id: `sys_${Date.now()}`, role: 'system', content: systemPrompt, timestamp: Date.now() },
    {
      id: `user_${Date.now()}`,
      role: 'user',
      content: buildGoalTurn(options.goal),
      timestamp: Date.now(),
    },
  ];

  const messages = await agent.runTask(options.goal, seeded, []);
  const status = agent.getStatus();
  const lastAssistant = [...messages].reverse().find(message => message.role === 'assistant' && message.content.trim());

  const result: SuperAgentResult = {
    status: status === 'done' ? 'done' : status === 'idle' ? 'cancelled' : 'error',
    detail: status === 'done'
      ? 'Coordinator finished'
      : status === 'idle'
        ? 'Cancelled'
        : 'Coordinator ended without finishing',
    summary: lastAssistant?.content ?? '',
    messages,
    workersStarted: startedWorkers.size,
  };

  options.onEvent({ type: 'status_change', status: status === 'done' ? 'done' : status === 'idle' ? 'idle' : 'error', detail: result.detail });
  return result;
}

/**
 * The goal turn.
 *
 * It restates the working rules on the user side too, because models weight the
 * most recent instruction more heavily than the system prompt.
 */
function buildGoalTurn(goal: string): string {
  return [
    `Goal: ${goal}`,
    '',
    'Work through this using delegate_tasks, check_workers, collect_worker, run_verification and merge_worker.',
    'Start by deciding the subtasks, then delegate. Poll until the workers finish, read what they report, run the checks yourself, and only then merge what is good.',
    'When a check fails, send the failing test names back verbatim in a follow-up task.',
  ].join('\n');
}