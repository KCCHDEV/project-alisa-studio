import { z } from 'zod';
import type { CoordinatorBridge, ExecutionContext, ToolDefinition, WorkerHandle } from '../core/types.ts';

/**
 * Tools that let a coordinator agent command other agents and verify their work.
 *
 * They are registered only into the coordinator's own registry, and every one of
 * them refuses to run when the execution context carries no bridge. That double
 * gate means a normal worker cannot spawn agents even if it guesses a tool name.
 */

function requireCoordinator(context: ExecutionContext): CoordinatorBridge {
  if (!context.coordinator) {
    throw new Error('Coordination tools are only available to the coordinator agent.');
  }
  return context.coordinator;
}

export const delegateTaskTool: ToolDefinition<{ tasks: Array<{ title: string; prompt: string; engine: 'alisa' | 'cli'; cliAgentId?: string; model?: string; reuseWorktreeId?: string }> }, any> = {
  name: 'delegate_tasks',
  description: [
    'Hand one or more subtasks to other agents, each in its own isolated git worktree.',
    'Use this for work that is genuinely separable (independent files, alternative approaches to the same problem, or a task plus its own tests).',
    'For steps that depend on each other, delegate a single task, wait with check_workers, then delegate the next.',
    'Every worker runs to completion on its own; this returns as soon as they are started, so you must poll check_workers before merging anything.',
  ].join(' '),
  parameters: z.object({
    tasks: z.array(z.object({
      title: z.string().trim().min(1).max(120).describe('Short name; becomes the worktree branch and folder.'),
      prompt: z.string().trim().min(1).max(20000).describe('Complete, self-contained instructions for the worker.'),
      engine: z.enum(['alisa', 'cli']).describe('"alisa" uses this app\'s own agent loop; "cli" runs an installed external CLI agent.'),
      cliAgentId: z.string().trim().min(1).max(80).optional().describe('Which external CLI, e.g. opencode or codex. Only for engine "cli".'),
      model: z.string().trim().min(1).max(240).optional().describe('Model override for this worker.'),
      reuseWorktreeId: z.string().trim().min(1).max(120).optional().describe('Send the work to an existing worktree instead of creating one.'),
    })).min(1).max(6).describe('Subtasks to start now, up to six at once.'),
  }),
  execute: async (args, context) => {
    const coordinator = requireCoordinator(context);
    if (args.tasks.length > 1 && coordinator.listWorkers().filter(worker => worker.status === 'running').length + args.tasks.length > 8) {
      throw new Error('Too many workers are already running. Wait for some to finish before starting a large batch.');
    }

    const started = [];
    for (const task of args.tasks) {
      started.push(await coordinator.delegate({
        title: task.title,
        prompt: task.prompt,
        engine: task.engine,
        cliAgentId: task.cliAgentId,
        model: task.model,
        reuseWorktreeId: task.reuseWorktreeId,
      }));
    }

    return {
      started: started.length,
      workers: started.map(worker => ({
        id: worker.id,
        worktreeId: worker.worktreeId,
        title: worker.title,
        engine: worker.engine,
        branch: worker.branch,
        status: worker.status,
      })),
      nextStep: 'Poll check_workers until these finish, then collect_worker for the ones you need, then merge_worker.',
    };
  },
};

export const checkWorkersTool: ToolDefinition<{ ids?: string[] }, any> = {
  name: 'check_workers',
  description: [
    'Report the current state of delegated workers: running, finished, or failed, plus how many files they changed.',
    'Call this instead of assuming a worker is done. Workers are asynchronous.',
  ].join(' '),
  parameters: z.object({
    ids: z.array(z.string().trim().min(1).max(120)).max(24).optional().describe('Specific workers; omit for all of them.'),
  }),
  execute: async (args, context) => {
    const coordinator = requireCoordinator(context);
    const all = coordinator.listWorkers();
    const requested = args.ids?.length ? new Set(args.ids) : undefined;
    const workers = requested ? all.filter(worker => requested.has(worker.id)) : all;
    const missing = requested ? [...requested].filter(id => !all.some(worker => worker.id === id)) : [];

    return {
      workers: workers.map(describeWorker),
      missing,
      running: workers.filter(worker => worker.status === 'running').length,
      note: workers.some(worker => worker.status === 'running')
        ? 'Some workers are still running — poll again before merging.'
        : 'All listed workers have finished.',
    };
  },
};

export const collectWorkerTool: ToolDefinition<{ id: string }, any> = {
  name: 'collect_worker',
  description: [
    'Get one worker\'s result: its final report, the files it changed, and any test output it produced.',
    'Read this before deciding whether the work is acceptable or needs another round.',
  ].join(' '),
  parameters: z.object({ id: z.string().trim().min(1).max(120).describe('Worker id from delegate_tasks.') }),
  execute: async (args, context) => {
    const coordinator = requireCoordinator(context);
    const report = await coordinator.collectWorker(args.id);
    return {
      ...report,
      nextStep: report.status === 'done'
        ? 'If the result is acceptable, merge_worker. If not, delegate a follow-up task that names the specific problems.'
        : 'This worker did not finish cleanly. Read its detail, then delegate a follow-up task with the corrected instructions.',
    };
  },
};

export const verifyProjectTool: ToolDefinition<{ worktreeId?: string; includeBuild?: boolean; timeoutMs?: number }, any> = {
  name: 'run_verification',
  description: [
    'Run the project checks (tests, and typecheck when the project defines it) and report what failed.',
    'Run this yourself after workers finish, or in a worktree to check one worker in isolation. Use the failing test names verbatim when sending a follow-up task.',
  ].join(' '),
  parameters: z.object({
    worktreeId: z.string().trim().min(1).max(120).optional().describe('Check inside this worktree instead of the main workspace.'),
    includeBuild: z.boolean().optional().describe('Also run the build script. Slower; use before merging.'),
    timeoutMs: z.number().int().min(5000).max(1800000).optional().describe('Per-check time budget.'),
  }),
  execute: async (args, context) => {
    const coordinator = requireCoordinator(context);
    const report = await coordinator.verify({
      worktreeId: args.worktreeId,
      includeBuild: args.includeBuild === true,
      timeoutMs: args.timeoutMs,
    });
    return {
      ...report,
      nextStep: report.passed
        ? 'All checks passed. Merge the workers you want to keep, then run run_verification in the main workspace to confirm.'
        : 'Send the listed failures back to a worker verbatim, or delegate a new task that fixes them. Do not merge while checks fail.',
    };
  },
};

export const mergeWorkerTool: ToolDefinition<{ id: string; message?: string; commitMessage?: string }, any> = {
  name: 'merge_worker',
  description: [
    "Commit a worker's outstanding changes and merge its branch into the main workspace.",
    'Only merge a worker whose result you have actually read and whose checks passed. Conflicts are reported, not resolved for you.',
  ].join(' '),
  parameters: z.object({
    id: z.string().trim().min(1).max(120).describe('Worker id to merge.'),
    commitMessage: z.string().trim().min(1).max(4000).optional().describe('Commit message for any uncommitted changes.'),
    message: z.string().trim().max(4000).optional().describe('Merge commit message.'),
  }),
  execute: async (args, context) => {
    const coordinator = requireCoordinator(context);
    return coordinator.mergeWorker({ id: args.id, message: args.message, commitMessage: args.commitMessage });
  },
};

export const discardWorkerTool: ToolDefinition<{ id: string; deleteBranch?: boolean }, any> = {
  name: 'discard_worker',
  description: 'Delete a worker\'s worktree and optionally its branch. Use this for work you decided against.',
  parameters: z.object({
    id: z.string().trim().min(1).max(120).describe('Worker id to discard.'),
    deleteBranch: z.boolean().optional().describe('Also delete the branch. Defaults to true.'),
  }),
  execute: async (args, context) => {
    const coordinator = requireCoordinator(context);
    await coordinator.removeWorker(args.id, args.deleteBranch !== false);
    return { removed: true, id: args.id };
  },
};

/** Every coordination tool, registered only into the coordinator's registry. */
export const COORDINATOR_TOOLS: ToolDefinition<any, any>[] = [
  delegateTaskTool,
  checkWorkersTool,
  collectWorkerTool,
  verifyProjectTool,
  mergeWorkerTool,
  discardWorkerTool,
];

function describeWorker(worker: WorkerHandle): Record<string, unknown> {
  return {
    id: worker.id,
    worktreeId: worker.worktreeId,
    title: worker.title,
    engine: worker.engine,
    cliAgentId: worker.cliAgentId,
    branch: worker.branch,
    status: worker.status,
    detail: worker.detail,
    changedFiles: worker.changedFiles,
    additions: worker.additions,
    deletions: worker.deletions,
  };
}

/** System prompt that teaches the coordinator when to delegate and when not to. */
export function coordinatorSystemPrompt(options: {
  workspace: string;
  maxParallel: number;
  cliAgents: Array<{ id: string; label: string }>;
  autoApprove: boolean;
}): string {
  const cliList = options.cliAgents.length
    ? options.cliAgents.map(agent => `${agent.id} (${agent.label})`).join(', ')
    : 'none installed — use engine "alisa" only';

  return [
    'You are the coordinator agent in Project Alisa Studio. You do not usually write code yourself: you break work down, hand each part to a worker, verify the results with the project checks, and merge what is good.',
    '',
    '## Workers',
    `- engine "alisa" runs this app's own agent loop and is always available.`,
    `- engine "cli" runs an external CLI agent in its own process. Available here: ${cliList}.`,
    '- Every worker gets its own git worktree, so parallel workers cannot corrupt each other.',
    `- At most ${options.maxParallel} runs can be active at once.`,
    '',
    '## How to work',
    '1. Read the goal and decide the smallest set of subtasks that actually cover it.',
    '2. Delegate independent subtasks in ONE delegate_tasks call so they run in parallel. Delegate dependent steps one at a time instead.',
    '3. Poll check_workers. Workers are asynchronous: delegating does not mean the work is done.',
    '4. collect_worker each one you care about and judge the result honestly. A finished worker that did the wrong thing still needs a follow-up task.',
    '5. run_verification yourself. When it fails, send the failing test names back verbatim in a follow-up task rather than guessing.',
    '6. merge_worker only the results you want. Use discard_worker for the rest.',
    '',
    '## Rules',
    '- Never claim a task is done without run_verification or an explicit note that checks were not run.',
    '- Do not merge a worker whose checks failed.',
    '- Give each worker complete instructions: it cannot see this conversation.',
    `- The workspace is ${options.workspace}.`,
    options.autoApprove
      ? '- YOLO mode is on, so workers do not stop for approval prompts. Their writes stay inside their own worktree.'
      : '- YOLO mode is off. Workers stop for approval on gated tools, so prefer read-only investigation tasks while you decide.',
  ].join('\n');
}