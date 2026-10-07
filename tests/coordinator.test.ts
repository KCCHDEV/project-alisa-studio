import { test, expect } from 'bun:test';
import {
  COORDINATOR_TOOLS,
  checkWorkersTool,
  collectWorkerTool,
  coordinatorSystemPrompt,
  delegateTaskTool,
  discardWorkerTool,
  mergeWorkerTool,
  verifyProjectTool,
} from '../src/core/coordinator.ts';
import type { CoordinatorBridge, ExecutionContext, WorkerHandle } from '../src/core/types.ts';

function makeWorker(overrides: Partial<WorkerHandle> = {}): WorkerHandle {
  return {
    id: 'run-1',
    worktreeId: 'wt-1',
    title: 'Fix login',
    engine: 'alisa',
    branch: 'alisa/fix-login',
    status: 'running',
    detail: 'Starting task',
    startedAt: 1000,
    changedFiles: 0,
    additions: 0,
    deletions: 0,
    ...overrides,
  };
}

/** In-memory stand-in so coordinator behaviour can be tested without a server. */
function fakeBridge(workers: WorkerHandle[] = [], logs: Array<{ kind: string; passed: boolean; failures: string[] }> = []) {
  const calls: string[] = [];
  const bridge: CoordinatorBridge = {
    listWorkers: () => workers,
    delegate: async request => {
      calls.push(`delegate:${request.title}`);
      const worker = makeWorker({
        id: `run-${workers.length + 1}`,
        worktreeId: `wt-${workers.length + 1}`,
        title: request.title,
        engine: request.engine,
        cliAgentId: request.cliAgentId,
      });
      workers.push(worker);
      return worker;
    },
    getWorker: id => workers.find(worker => worker.id === id),
    collectWorker: async id => {
      calls.push(`collect:${id}`);
      const worker = bridge.getWorker(id);
      if (!worker) throw new Error('Unknown worker');
      return { id, title: worker.title, status: worker.status, detail: worker.detail, branch: worker.branch, summary: 'did the work', changedFiles: ['src/a.ts'] };
    },
    mergeWorker: async request => {
      calls.push(`merge:${request.id}`);
      return { merged: true, alreadyUpToDate: false, conflicted: false, message: 'merged', branch: 'alisa/x' };
    },
    removeWorker: async id => {
      calls.push(`discard:${id}`);
      const index = workers.findIndex(worker => worker.id === id);
      if (index >= 0) workers.splice(index, 1);
    },
    verify: async request => {
      calls.push(`verify:${request.worktreeId ?? 'main'}:${request.includeBuild === true}`);
      return {
        worktreeId: request.worktreeId ?? 'main',
        passed: logs.every(log => log.passed),
        checks: logs.map(log => ({ kind: 'test', passed: log.passed, summary: log.passed ? 'PASSED' : log.failures.join(', ') })),
        overall: logs.map(log => (log.passed ? 'test PASSED' : `test FAILED: ${log.failures.join(', ')}`)).join('\n'),
        failures: logs.flatMap(log => log.failures),
      };
    },
    stopAll: () => 0,
  };
  return { bridge, calls, workers };
}

function contextWith(bridge?: CoordinatorBridge): ExecutionContext {
  return {
    cwd: 'C:/repo',
    sessionId: 's1',
    env: {},
    emitEvent: () => undefined,
    coordinator: bridge,
  };
}

test('every coordination tool refuses to run without a coordinator bridge', async () => {
  for (const tool of COORDINATOR_TOOLS) {
    await expect(tool.execute({}, contextWith())).rejects.toThrow(/only available to the coordinator/);
  }
});

test('delegate_tasks starts every subtask and tells the coordinator to poll', async () => {
  const { bridge, calls, workers } = fakeBridge();
  const result = await delegateTaskTool.execute({
    tasks: [
      { title: 'Fix login', prompt: 'repair the login flow', engine: 'alisa' },
      { title: 'Add tests', prompt: 'cover the login flow', engine: 'cli', cliAgentId: 'opencode' },
    ],
  } as any, contextWith(bridge)) as any;

  expect(result.started).toBe(2);
  expect(calls).toEqual(['delegate:Fix login', 'delegate:Add tests']);
  expect(workers).toHaveLength(2);
  expect(result.workers[1]).toMatchObject({ title: 'Add tests', engine: 'cli' });
  expect(result.nextStep).toContain('check_workers');
});

test('delegate_tasks refuses a batch that would oversubscribe the runners', async () => {
  const running = Array.from({ length: 8 }, (_, index) => makeWorker({ id: `busy-${index}`, status: 'running' }));
  const { bridge } = fakeBridge(running);
  await expect(delegateTaskTool.execute({
    tasks: [
      { title: 'a', prompt: 'x', engine: 'alisa' },
      { title: 'b', prompt: 'x', engine: 'alisa' },
    ],
  } as any, contextWith(bridge))).rejects.toThrow(/Too many workers/);
});

test('check_workers reports state and flags that nobody has finished yet', async () => {
  const { bridge } = fakeBridge([makeWorker({ id: 'a' }), makeWorker({ id: 'b', status: 'done', changedFiles: 3, additions: 40, deletions: 5 })]);
  const all = await checkWorkersTool.execute({}, contextWith(bridge)) as any;
  expect(all.workers).toHaveLength(2);
  expect(all.running).toBe(1);
  expect(all.note).toContain('still running');

  const one = await checkWorkersTool.execute({ ids: ['b'] } as any, contextWith(bridge)) as any;
  expect(one.workers).toHaveLength(1);
  expect(one.running).toBe(0);
  expect(one.note).toContain('have finished');
  expect(one.workers[0].changedFiles).toBe(3);
});

test('check_workers names ids it does not recognise instead of silently dropping them', async () => {
  const { bridge } = fakeBridge([makeWorker({ id: 'a' })]);
  const result = await checkWorkersTool.execute({ ids: ['a', 'ghost'] } as any, contextWith(bridge)) as any;
  expect(result.workers.map((worker: WorkerHandle) => worker.id)).toEqual(['a']);
  expect(result.missing).toEqual(['ghost']);
});

test('collect_worker returns the report and pushes toward merge or a follow-up', async () => {
  const { bridge } = fakeBridge([makeWorker({ id: 'done-1', status: 'done' }), makeWorker({ id: 'bad-1', status: 'error', detail: 'exit code 1' })]);

  const good = await collectWorkerTool.execute({ id: 'done-1' } as any, contextWith(bridge)) as any;
  expect(good.summary).toBe('did the work');
  expect(good.changedFiles).toEqual(['src/a.ts']);
  expect(good.nextStep).toContain('merge_worker');

  const bad = await collectWorkerTool.execute({ id: 'bad-1' } as any, contextWith(bridge)) as any;
  expect(bad.detail).toBe('exit code 1');
  expect(bad.nextStep).toContain('follow-up task');
});

test('collect_worker rejects an unknown id', async () => {
  const { bridge } = fakeBridge();
  await expect(collectWorkerTool.execute({ id: 'nope' } as any, contextWith(bridge))).rejects.toThrow('Unknown worker');
});

test('run_verification hands back the failures verbatim and says not to merge', async () => {
  const { bridge, calls } = fakeBridge([], [
    { kind: 'test', passed: false, failures: ['(fail) login rejects valid token'] },
    { kind: 'typecheck', passed: true, failures: [] },
  ]);
  const result = await verifyProjectTool.execute({ includeBuild: true } as any, contextWith(bridge)) as any;

  expect(calls).toEqual(['verify:main:true']);
  expect(result.passed).toBe(false);
  expect(result.failures).toEqual(['(fail) login rejects valid token']);
  expect(result.overall).toContain('FAILED');
  expect(result.nextStep).toContain('Do not merge');
  expect(result.nextStep).toContain('verbatim');
});

test('run_verification confirms the merge path when everything passes', async () => {
  const { bridge } = fakeBridge([], [{ kind: 'test', passed: true, failures: [] }]);
  const result = await verifyProjectTool.execute({ worktreeId: 'wt-7' } as any, contextWith(bridge)) as any;
  expect(result.passed).toBe(true);
  expect(result.worktreeId).toBe('wt-7');
  expect(result.nextStep).toContain('Merge the workers');
});

test('merge_worker passes the commit message through for uncommitted work', async () => {
  const { bridge, calls } = fakeBridge();
  const result = await mergeWorkerTool.execute({ id: 'w1', commitMessage: 'finish the fix' } as any, contextWith(bridge)) as any;
  expect(calls).toEqual(['merge:w1']);
  expect(result.merged).toBe(true);
});

test('discard_worker defaults to deleting the branch', async () => {
  const { bridge, workers } = fakeBridge([makeWorker({ id: 'w1' })]);
  await discardWorkerTool.execute({ id: 'w1' } as any, contextWith(bridge));
  expect(workers).toHaveLength(0);

  const second = fakeBridge([makeWorker({ id: 'w2' })]);
  await discardWorkerTool.execute({ id: 'w2', deleteBranch: false } as any, contextWith(second.bridge));
  expect(second.workers).toHaveLength(0);
});

test('the system prompt teaches delegation, polling and the no-merge-on-failure rule', () => {
  const prompt = coordinatorSystemPrompt({
    workspace: 'C:/repo',
    maxParallel: 4,
    cliAgents: [{ id: 'opencode', label: 'OpenCode' }],
    autoApprove: true,
  });

  expect(prompt).toContain('coordinator agent');
  expect(prompt).toContain('opencode (OpenCode)');
  expect(prompt).toContain('4 runs can be active');
  expect(prompt).toContain('its own git worktree');
  // The three mistakes a coordinator actually makes.
  expect(prompt).toContain('Workers are asynchronous');
  expect(prompt).toContain('Do not merge a worker whose checks failed');
  expect(prompt).toContain('cannot see this conversation');
  expect(prompt).toContain('YOLO mode is on');
  expect(prompt).toContain('C:/repo');
});

test('the prompt says so plainly when no external CLI is installed', () => {
  const prompt = coordinatorSystemPrompt({ workspace: '/w', maxParallel: 1, cliAgents: [], autoApprove: false });
  expect(prompt).toContain('none installed');
  expect(prompt).toContain('YOLO mode is off');
});