import { Agent, type AgentOptions } from './agent.ts';
import { LLMClient, type LLMConfig } from '../llm/client.ts';
import type { AgentEvent, AgentMode, AgentStatus, Goal, Message, SwarmAgent, SwarmAgentRole } from './types.ts';

type SwarmRoleDefinition = {
  role: SwarmAgentRole;
  label: string;
  mode: AgentMode;
  maxIterations: number;
  instruction: string;
};

export const SWARM_ROLE_DEFINITIONS: SwarmRoleDefinition[] = [
  {
    role: 'explorer',
    label: 'Explorer',
    mode: 'ask',
    maxIterations: 6,
    instruction: 'Inspect the workspace and trace the relevant implementation. Do not modify files or run shell commands. Return a concise evidence-based report with file paths and risks.',
  },
  {
    role: 'planner',
    label: 'Planner',
    mode: 'plan',
    maxIterations: 6,
    instruction: 'Turn the request and the Explorer report into a short executable checklist. Use update_plan and update_goal when useful. Do not modify files or run shell commands.',
  },
  {
    role: 'builder',
    label: 'Builder',
    mode: 'code',
    maxIterations: 20,
    instruction: 'Implement the request in the workspace. Inspect before editing, use safe targeted changes, run relevant verification, and update the goal when meaningful milestones are reached.',
  },
  {
    role: 'reviewer',
    label: 'Reviewer',
    mode: 'ask',
    maxIterations: 8,
    instruction: 'Review the current workspace and the Builder result. Inspect changed files and report concrete correctness, safety, and verification findings. Do not modify files or run shell commands.',
  },
];

export interface SwarmRunnerOptions {
  cwd: string;
  sessionId: string;
  prompt: string;
  history: Message[];
  skillNames?: string[];
  llmConfig: LLMConfig;
  contextWindow?: number;
  goal?: Goal;
  requestApproval?: AgentOptions['requestApproval'];
  onEvent?: (event: AgentEvent) => void;
  onGoalUpdate?: (goal: Goal | undefined) => void;
  onAgentCreated?: (agent: Agent) => void;
}

export interface SwarmRunResult {
  status: AgentStatus;
  detail: string;
  agents: SwarmAgent[];
}

function reportFrom(messages: Message[]) {
  const message = [...messages].reverse().find(item => item.role === 'assistant' && item.content?.trim());
  return message?.content.trim().slice(-12_000) || '';
}

function errorReport(status: AgentStatus) {
  return status === 'idle' ? 'The worker was cancelled before completing its report.' : 'The worker did not produce a usable report.';
}

export class SwarmRunner {
  private readonly options: SwarmRunnerOptions;
  private currentGoal?: Goal;
  private aborted = false;
  private activeAgents = new Map<string, Agent>();
  private states: SwarmAgent[] = SWARM_ROLE_DEFINITIONS.map(definition => ({
    id: `swarm_${definition.role}`,
    role: definition.role,
    label: definition.label,
    status: 'queued',
  }));

  constructor(options: SwarmRunnerOptions) {
    this.options = options;
    this.currentGoal = options.goal;
  }

  abort() {
    this.aborted = true;
    for (const agent of this.activeAgents.values()) agent.abort();
  }

  getAgents() {
    return this.states.map(agent => ({ ...agent }));
  }

  private emit(event: AgentEvent) {
    this.options.onEvent?.(event);
  }

  private publish(phase: string) {
    this.emit({ type: 'swarm_update', agents: this.getAgents(), phase });
  }

  private updateState(id: string, patch: Partial<SwarmAgent>) {
    this.states = this.states.map(agent => agent.id === id ? { ...agent, ...patch } : agent);
  }

  private workerPrompt(definition: SwarmRoleDefinition, reports: Map<SwarmAgentRole, string>) {
    const reportsText = Array.from(reports.entries())
      .map(([role, report]) => `### ${role} report\n${report}`)
      .join('\n\n');
    const goalText = this.currentGoal
      ? `\nPersistent goal: ${this.currentGoal.title} (${this.currentGoal.progress}% · ${this.currentGoal.status})${this.currentGoal.description ? `\n${this.currentGoal.description}` : ''}`
      : '';
    return [
      `You are the ${definition.label} in a staged multi-agent coding swarm.`,
      definition.instruction,
      'The other workers share the same workspace, so leave a clear report for the next worker.',
      `Original user request:\n${this.options.prompt}`,
      goalText,
      reportsText ? `Reports from previous workers:\n${reportsText}` : '',
    ].filter(Boolean).join('\n\n');
  }

  private async runWorker(definition: SwarmRoleDefinition, reports: Map<SwarmAgentRole, string>) {
    const state = this.states.find(agent => agent.role === definition.role)!;
    const startedAt = Date.now();
    this.updateState(state.id, { status: 'working', detail: definition.instruction, startedAt, model: this.options.llmConfig.model });
    this.publish(`${definition.label} is working`);

    const agent = new Agent({
      cwd: this.options.cwd,
      sessionId: `${this.options.sessionId}:${definition.role}`,
      mode: definition.mode,
      maxIterations: definition.maxIterations,
      goal: this.currentGoal,
      contextWindow: this.options.contextWindow,
      llm: new LLMClient({ ...this.options.llmConfig }),
      requestApproval: this.options.requestApproval
        ? (action, details, signal) => this.options.requestApproval!(action, { ...details, agentRole: definition.role }, signal)
        : undefined,
      onGoalUpdate: goal => {
        this.currentGoal = goal;
        this.options.onGoalUpdate?.(goal);
      },
      onEvent: event => {
        if (event.type === 'status_change') {
          const workerStatus: SwarmAgent['status'] = event.status === 'error'
            ? 'error'
            : event.status === 'idle'
              ? 'cancelled'
              : event.status === 'done'
                ? 'done'
                : 'working';
          this.updateState(state.id, { status: workerStatus, detail: event.detail });
          this.publish(`${definition.label}: ${event.detail || event.status}`);
        }
        this.emit({ ...event, agentId: state.id, agentRole: definition.role } as AgentEvent);
      },
    });
    this.activeAgents.set(state.id, agent);
    this.options.onAgentCreated?.(agent);

    try {
      const workerHistory = this.options.history.slice(-12);
      const messages = await agent.runTask(this.workerPrompt(definition, reports), workerHistory, this.options.skillNames || []);
      const status = this.aborted || agent.getStatus() === 'idle' ? 'cancelled' : agent.getStatus() === 'error' ? 'error' : 'done';
      const completedAt = Date.now();
      const report = reportFrom(messages) || errorReport(agent.getStatus());
      this.updateState(state.id, { status, detail: report.slice(0, 240), completedAt, durationMs: completedAt - startedAt });
      this.publish(`${definition.label} ${status}`);
      return { status, report };
    } catch (error: any) {
      const completedAt = Date.now();
      const detail = error?.message || String(error);
      this.updateState(state.id, { status: this.aborted ? 'cancelled' : 'error', detail, completedAt, durationMs: completedAt - startedAt });
      this.emit({ type: 'error', message: `${definition.label}: ${detail}`, agentId: state.id, agentRole: definition.role });
      this.publish(`${definition.label} failed`);
      return { status: this.aborted ? 'cancelled' as const : 'error' as const, report: detail };
    } finally {
      this.activeAgents.delete(state.id);
    }
  }

  async run(): Promise<SwarmRunResult> {
    const reports = new Map<SwarmAgentRole, string>();
    this.publish('Agent swarm queued');
    for (const definition of SWARM_ROLE_DEFINITIONS) {
      if (this.aborted) {
        for (const remaining of this.states.filter(agent => agent.status === 'queued')) this.updateState(remaining.id, { status: 'cancelled', detail: 'Cancelled by user' });
        break;
      }
      const result = await this.runWorker(definition, reports);
      reports.set(definition.role, result.report);
    }

    const completed = this.states.filter(agent => agent.status === 'done').length;
    const failed = this.states.some(agent => agent.status === 'error');
    const status: AgentStatus = this.aborted ? 'idle' : failed || completed === 0 ? 'error' : 'done';
    const detail = this.aborted
      ? `Cancelled after ${completed}/${SWARM_ROLE_DEFINITIONS.length} agents`
      : `${completed}/${SWARM_ROLE_DEFINITIONS.length} agents completed`;
    this.publish(detail);
    return { status, detail, agents: this.getAgents() };
  }
}
