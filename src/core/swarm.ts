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

const isTestEnv = typeof process !== 'undefined' && (Boolean(process.env?.NODE_ENV === 'test') || Boolean(process.env?.BUN_TEST));

export const SWARM_ROLE_DEFINITIONS: SwarmRoleDefinition[] = [
  {
    role: 'explorer',
    label: 'Explorer',
    mode: 'ask',
    maxIterations: isTestEnv ? 6 : 15,
    instruction: 'Inspect the workspace and trace the relevant implementation. Do not modify files or run shell commands. Return a concise evidence-based report with file paths and risks.',
  },
  {
    role: 'planner',
    label: 'Planner',
    mode: 'plan',
    maxIterations: isTestEnv ? 6 : 15,
    instruction: 'Turn the request and the Explorer report into a short executable checklist. Use update_plan and update_goal when useful. Do not modify files or run shell commands.',
  },
  {
    role: 'builder',
    label: 'Builder',
    mode: 'code',
    maxIterations: isTestEnv ? 10 : 80,
    instruction: 'Implement the request in the workspace. Inspect before editing, use safe targeted changes, run relevant verification, and update the goal when meaningful milestones are reached. Provide a final report summarizing what was done.',
  },
  {
    role: 'reviewer',
    label: 'Reviewer',
    mode: 'ask',
    maxIterations: isTestEnv ? 6 : 20,
    instruction: 'Review the current workspace and the Builder result. Inspect changed files and report concrete correctness, safety, and verification findings. Do not modify files or run shell commands. End your review with a clear verdict: "VERDICT: PASS" if all changes are verified and meet requirements, or "VERDICT: FAIL" / "VERDICT: NEEDS_REVISION" if issues remain, followed by required fixes for the Builder.',
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
  autoApprove?: boolean;
  maxRetries?: number;
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

function reportFrom(messages: Message[]) {
  const message = [...messages].reverse().find(item => item.role === 'assistant' && item.content?.trim());
  if (message?.content.trim()) {
    return message.content.trim().slice(-12_000);
  }
  const toolActivities = messages
    .filter(item => item.role === 'tool' || (item.role === 'assistant' && item.tool_calls?.length))
    .map(item => {
      if (item.role === 'assistant' && item.tool_calls) {
        return item.tool_calls.map(tc => tc.function.name).join(', ');
      }
      return item.name || '';
    })
    .filter(Boolean);
  if (toolActivities.length > 0) {
    const uniqueTools = Array.from(new Set(toolActivities.join(', ').split(', ').map(s => s.trim()).filter(Boolean)));
    return `Worker executed ${toolActivities.length} operations in workspace using tools: ${uniqueTools.join(', ')}. Changes applied to workspace.`;
  }
  return '';
}

function errorReport(status: AgentStatus) {
  return status === 'idle' ? 'The worker was cancelled before completing its report.' : 'The worker did not produce a usable report.';
}

export function checkReviewVerdict(report: string): { passed: boolean; needsRevision: boolean; feedback?: string } {
  if (!report || !report.trim()) return { passed: true, needsRevision: false };
  const lower = report.toLowerCase();

  const failPatterns = [
    /verdict\s*:\s*(fail|rejected?|needs[_\s-]revision|not[_\s-]passed?|incomplete)/i,
    /status\s*:\s*(fail|rejected?|needs[_\s-]revision|not[_\s-]passed?)/i,
    /review\s*:\s*(fail|rejected?|not[_\s-]passed?)/i,
    /verification\s*:\s*(failed|not[_\s-]passed?)/i,
    /result\s*:\s*(failed?|rejected?|not[_\s-]passed?)/i,
    /\b(does not pass|changes? do not pass|failed verification|tests? failed|bugs? found|critical issues? found)\b/i,
    /(ไม่ผ่าน|ต้องแก้ไข|ส่งกลับ|ยังไม่สมบูรณ์|เกิดข้อผิดพลาด)/iu,
  ];

  const passPatterns = [
    /verdict\s*:\s*(pass|passed|approved|success|lgtm)/i,
    /status\s*:\s*(pass|passed|approved|success)/i,
    /verification\s*:\s*(passed?|successful)/i,
    /\b(all tests pass|verification passed|looks good|ready for deployment|approved)\b/i,
  ];

  const hasFail = failPatterns.some(p => p.test(lower));
  const hasPass = passPatterns.some(p => p.test(lower));

  if (hasFail && !hasPass) {
    return { passed: false, needsRevision: true, feedback: report };
  }
  if (hasPass) {
    return { passed: true, needsRevision: false };
  }
  if (lower.includes('fix required') || lower.includes('issues that must be resolved') || lower.includes('needs to be fixed')) {
    return { passed: false, needsRevision: true, feedback: report };
  }

  return { passed: true, needsRevision: false };
}

export class SwarmRunner {
  private readonly options: SwarmRunnerOptions;
  private currentGoal?: Goal;
  private aborted = false;
  private maxRetries: number;
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
    const llmRetries = options.llmConfig.maxRetries;
    this.maxRetries = options.maxRetries ?? (typeof llmRetries === 'number' ? llmRetries : (isTestEnv ? 1 : 100));
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

  private workerPrompt(definition: SwarmRoleDefinition, reports: Map<SwarmAgentRole, string>, reworkFeedback?: string) {
    const reportsText = Array.from(reports.entries())
      .map(([role, report]) => `### ${role} report\n${report}`)
      .join('\n\n');
    const goalText = this.currentGoal
      ? `\nPersistent goal: ${this.currentGoal.title} (${this.currentGoal.progress}% · ${this.currentGoal.status})${this.currentGoal.description ? `\n${this.currentGoal.description}` : ''}`
      : '';
    const reworkText = reworkFeedback
      ? `\n## CRITICAL: REWORK REQUIRED (Previous Review Failed)\n${reworkFeedback}\nCarefully inspect the issues identified above, make the necessary corrections in the workspace, and verify your changes.`
      : '';
    return [
      `You are the ${definition.label} in a staged multi-agent coding swarm.`,
      definition.instruction,
      'The other workers share the same workspace, so leave a clear report for the next worker.',
      `Original user request:\n${this.options.prompt}`,
      goalText,
      reworkText,
      reportsText ? `Reports from previous workers:\n${reportsText}` : '',
    ].filter(Boolean).join('\n\n');
  }

  private async runWorker(
    definition: SwarmRoleDefinition,
    reports: Map<SwarmAgentRole, string>,
    attempt = 1,
    reworkFeedback?: string
  ): Promise<{ status: AgentStatus; report: string }> {
    if (this.aborted) {
      return { status: 'idle', report: 'Task was aborted' };
    }

    const state = this.states.find(agent => agent.role === definition.role)!;
    const startedAt = Date.now();
    const detailMsg = reworkFeedback
      ? `Reworking based on Reviewer feedback (attempt ${attempt}/${this.maxRetries})...`
      : attempt > 1
        ? `Retrying worker (attempt ${attempt}/${this.maxRetries})...`
        : definition.instruction;
    this.updateState(state.id, { status: 'working', detail: detailMsg, startedAt, model: this.options.llmConfig.model });
    this.publish(`${definition.label} is working`);

    const agent = new Agent({
      cwd: this.options.cwd,
      sessionId: `${this.options.sessionId}:${definition.role}`,
      mode: definition.mode,
      maxIterations: definition.maxIterations,
      maxRetries: this.maxRetries,
      goal: this.currentGoal,
      contextWindow: this.options.contextWindow,
      autoApprove: this.options.autoApprove,
      llm: new LLMClient({ ...this.options.llmConfig, maxRetries: this.maxRetries }),
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
      const messages = await agent.runTask(this.workerPrompt(definition, reports, reworkFeedback), workerHistory, this.options.skillNames || []);
      const agentStatus: AgentStatus = this.aborted || agent.getStatus() === 'idle' ? 'idle' : agent.getStatus() === 'error' ? 'error' : 'done';
      const workerStatus = agentStatus === 'idle' ? 'cancelled' : agentStatus === 'error' ? 'error' : 'done';
      const completedAt = Date.now();
      const report = reportFrom(messages) || errorReport(agent.getStatus());

      // If worker encountered an error, auto-retry up to Math.min(3, this.maxRetries) attempts
      const maxWorkerAttempts = Math.min(3, this.maxRetries);
      if (agentStatus === 'error' && attempt < maxWorkerAttempts && !this.aborted) {
        const retryDelay = isTestEnv ? 5 : Math.min(6000, 1000 * attempt);
        this.updateState(state.id, { status: 'working', detail: `Worker encountered an issue. Auto-retrying (${attempt + 1}/${maxWorkerAttempts})...` });
        this.publish(`${definition.label} error: auto-retrying (${attempt + 1}/${maxWorkerAttempts})`);
        this.emit({
          type: 'status_change',
          status: 'self_correcting',
          detail: `${definition.label} encountered an issue. Auto-retrying worker (${attempt + 1}/${maxWorkerAttempts})...`,
          agentId: state.id,
          agentRole: definition.role,
        });
        await delayWithSignal(retryDelay);
        return this.runWorker(definition, reports, attempt + 1, reworkFeedback);
      }

      this.updateState(state.id, { status: workerStatus, detail: report.slice(0, 240), completedAt, durationMs: completedAt - startedAt });
      this.publish(`${definition.label} ${workerStatus}`);
      return { status: agentStatus, report };
    } catch (error: any) {
      const maxWorkerAttempts = Math.min(3, this.maxRetries);
      if (attempt < maxWorkerAttempts && !this.aborted) {
        const retryDelay = isTestEnv ? 5 : Math.min(6000, 1000 * attempt);
        this.updateState(state.id, { status: 'working', detail: `Exception caught. Auto-retrying (${attempt + 1}/${maxWorkerAttempts})...` });
        this.publish(`${definition.label} threw: auto-retrying (${attempt + 1}/${maxWorkerAttempts})`);
        this.emit({
          type: 'status_change',
          status: 'self_correcting',
          detail: `${definition.label} error (${error?.message || error}). Auto-retrying worker (${attempt + 1}/${maxWorkerAttempts})...`,
          agentId: state.id,
          agentRole: definition.role,
        });
        await delayWithSignal(retryDelay);
        return this.runWorker(definition, reports, attempt + 1, reworkFeedback);
      }

      const completedAt = Date.now();
      const detail = error?.message || String(error);
      this.updateState(state.id, { status: this.aborted ? 'cancelled' : 'error', detail, completedAt, durationMs: completedAt - startedAt });
      this.emit({ type: 'error', message: `${definition.label}: ${detail}`, agentId: state.id, agentRole: definition.role });
      this.publish(`${definition.label} failed`);
      return { status: this.aborted ? 'idle' : 'error', report: detail };
    } finally {
      this.activeAgents.delete(state.id);
    }
  }

  async run(): Promise<SwarmRunResult> {
    const reports = new Map<SwarmAgentRole, string>();
    this.publish('Agent swarm queued');

    // Step 1: Run Explorer
    const explorerDef = SWARM_ROLE_DEFINITIONS.find(d => d.role === 'explorer')!;
    if (!this.aborted) {
      const explorerResult = await this.runWorker(explorerDef, reports);
      reports.set('explorer', explorerResult.report);
    }

    // Step 2: Run Planner
    const plannerDef = SWARM_ROLE_DEFINITIONS.find(d => d.role === 'planner')!;
    if (!this.aborted && reports.has('explorer')) {
      const plannerResult = await this.runWorker(plannerDef, reports);
      reports.set('planner', plannerResult.report);
    }

    // Step 3 & 4: Builder <-> Reviewer Execution & Feedback Loop
    const builderDef = SWARM_ROLE_DEFINITIONS.find(d => d.role === 'builder')!;
    const reviewerDef = SWARM_ROLE_DEFINITIONS.find(d => d.role === 'reviewer')!;

    let revisionLoop = 0;
    let reworkFeedback: string | undefined;

    while (!this.aborted && revisionLoop <= this.maxRetries) {
      // Execute Builder
      const builderResult = await this.runWorker(builderDef, reports, 1, reworkFeedback);
      reports.set('builder', builderResult.report);

      if (this.aborted || builderResult.status === 'idle') {
        break;
      }

      // Execute Reviewer
      const reviewerResult = await this.runWorker(reviewerDef, reports);
      reports.set('reviewer', reviewerResult.report);

      if (this.aborted || reviewerResult.status === 'idle') {
        break;
      }

      // Evaluate Reviewer Verdict
      const verdict = checkReviewVerdict(reviewerResult.report);
      if (!verdict.needsRevision) {
        // Review Passed!
        break;
      }

      // Review failed / found issues -> Send back to Builder if revision cycles remain
      if (revisionLoop < this.maxRetries && !this.aborted) {
        revisionLoop++;
        reworkFeedback = `## REWORK REQUIRED - REVIEWER FEEDBACK (Round ${revisionLoop}/${this.maxRetries})\nReviewer inspected the changes and found issues:\n${reviewerResult.report}\n\nPlease address and fix all issues mentioned above in the workspace, verify your fixes, and report the results.`;
        this.emit({
          type: 'status_change',
          status: 'self_correcting',
          detail: `Reviewer rejected: ส่งงานกลับไปให้ Builder แก้ไขใหม่ (รอบที่ ${revisionLoop}/${this.maxRetries})`,
        });
        this.publish(`Reviewer rejected: ส่งกลับให้ Builder ทำใหม่ (${revisionLoop}/${this.maxRetries})`);
        this.updateState('swarm_builder', { status: 'queued', detail: `Preparing to rework based on Reviewer feedback (round ${revisionLoop}/${this.maxRetries})...` });
        this.updateState('swarm_reviewer', { status: 'queued', detail: `Waiting for Builder rework (round ${revisionLoop}/${this.maxRetries})...` });
        await delayWithSignal(isTestEnv ? 5 : 1500);
      } else {
        break;
      }
    }

    if (this.aborted) {
      for (const remaining of this.states.filter(agent => agent.status === 'queued' || agent.status === 'working')) {
        this.updateState(remaining.id, { status: 'cancelled', detail: 'Cancelled by user' });
      }
    }

    const completed = this.states.filter(agent => agent.status === 'done').length;
    const failed = this.states.some(agent => agent.status === 'error');
    const status: AgentStatus = this.aborted ? 'idle' : failed || completed === 0 ? 'error' : 'done';
    const detail = this.aborted
      ? `Cancelled after ${completed}/${SWARM_ROLE_DEFINITIONS.length} agents`
      : revisionLoop > 0 && status === 'done'
        ? `${completed}/${SWARM_ROLE_DEFINITIONS.length} agents completed (passed after ${revisionLoop} revision cycle${revisionLoop > 1 ? 's' : ''})`
        : `${completed}/${SWARM_ROLE_DEFINITIONS.length} agents completed`;
    this.publish(detail);
    return { status, detail, agents: this.getAgents() };
  }
}
