import { test, expect } from 'bun:test';
import { OrchestratorRegistry, type OrchestratorEvent, type RunStatus } from '../src/server/orchestrator.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('a run reports start, progress and finish to subscribers', async () => {
  const registry = new OrchestratorRegistry();
  const events: OrchestratorEvent[] = [];
  registry.subscribeGlobal(event => events.push(event));

  const gate = deferred<{ status: RunStatus; detail: string }>();
  const { run, finished } = registry.start({
    workspace: 'C:/repo',
    cwd: 'C:/repo',
    sessionId: 'session-1',
    prompt: 'do the thing',
    model: 'test-model',
    mode: 'code',
    engine: 'alisa',
    label: 'Main workspace',
    runner: async context => {
      context.update('running', 'step 1');
      return gate.promise;
    },
  });

  expect(run.status).toBe('running');
  expect(registry.activeCount).toBe(1);
  expect(registry.isWorkspaceBusy('C:/repo')).toBe(true);

  gate.resolve({ status: 'done', detail: 'Completed' });
  const result = await finished;

  expect(result.status).toBe('done');
  expect(result.durationMs).toBeGreaterThanOrEqual(0);
  expect(result.completedAt).toBeGreaterThan(0);
  expect(events.map(event => event.type)).toEqual([
    'orchestrator_run_started',
    'orchestrator_run_updated',
    'orchestrator_run_finished',
  ]);
  expect(registry.activeCount).toBe(0);
  expect(registry.isWorkspaceBusy('C:/repo')).toBe(false);
});

test('many runs execute concurrently and each keeps its own snapshot', async () => {
  const registry = new OrchestratorRegistry({ maxParallel: 4 });
  const gates = [deferred<{ status: RunStatus; detail: string }>(), deferred<{ status: RunStatus; detail: string }>(), deferred<{ status: RunStatus; detail: string }>()];
  const finishes: Array<Promise<{ id: string; status: RunStatus }>> = [];

  for (const [index, gate] of gates.entries()) {
    const { run, finished } = registry.start({
      workspace: `C:/repo`,
      cwd: `C:/repo/.alisa-worktrees/repo/task-${index + 1}`,
      sessionId: `session-${index + 1}`,
      prompt: `task ${index + 1}`,
      model: 'test-model',
      mode: 'code',
      engine: 'alisa',
      label: `task-${index + 1}`,
      worktreeId: `wt-${index + 1}`,
      runner: async () => gate.promise,
    });
    finishes.push(finished.then(done => ({ id: done.id, status: done.status })));
    expect(run.worktreeId).toBe(`wt-${index + 1}`);
  }

  expect(registry.activeCount).toBe(3);
  expect(registry.active().map(entry => entry.label).sort()).toEqual(['task-1', 'task-2', 'task-3']);

  gates[1]!.resolve({ status: 'done', detail: 'second done' });
  gates[0]!.resolve({ status: 'error', detail: 'first failed' });
  gates[2]!.resolve({ status: 'done', detail: 'third done' });

  const results = await Promise.all(finishes);
  expect(results.map(entry => entry.status).sort()).toEqual(['done', 'done', 'error']);
  expect(registry.activeCount).toBe(0);
  expect(registry.recent(10)).toHaveLength(3);
});

test('the parallel limit is enforced', () => {
  const registry = new OrchestratorRegistry({ maxParallel: 2 });
  const gate = deferred<{ status: RunStatus; detail: string }>();
  const base = {
    workspace: 'C:/repo',
    cwd: 'C:/repo',
    prompt: 'x',
    model: 'm',
    mode: 'code' as const,
    engine: 'alisa' as const,
    runner: async () => gate.promise,
  };
  registry.start({ ...base, sessionId: 'a' });
  registry.start({ ...base, sessionId: 'b' });
  expect(() => registry.start({ ...base, sessionId: 'c' })).toThrow(/slots are busy/);
  expect(registry.capacity).toBe(2);
});

test('exclusive workspaces keep the single-run contract while other workspaces run in parallel', () => {
  const registry = new OrchestratorRegistry({ maxParallel: 4 });
  const gate = deferred<{ status: RunStatus; detail: string }>();
  const runner = async () => gate.promise;

  registry.start({ workspace: 'C:/main', cwd: 'C:/main', sessionId: 'a', prompt: 'x', model: 'm', mode: 'code', engine: 'alisa', exclusiveWorkspace: true, runner });
  expect(() => registry.start({ workspace: 'C:/main', cwd: 'C:/main', sessionId: 'b', prompt: 'x', model: 'm', mode: 'code', engine: 'alisa', exclusiveWorkspace: true, runner }))
    .toThrow(/already running in this workspace/);

  // A different workspace (a worktree) is unaffected by the main workspace guard.
  expect(() => registry.start({ workspace: 'C:/wt', cwd: 'C:/wt', sessionId: 'c', prompt: 'x', model: 'm', mode: 'code', engine: 'alisa', runner })).not.toThrow();
  expect(registry.activeCount).toBe(2);
});

test('abort signals the runner and marks the run cancelled', async () => {
  const registry = new OrchestratorRegistry();
  let sawAbort = false;
  const { run, finished } = registry.start({
    workspace: 'C:/repo',
    cwd: 'C:/repo',
    sessionId: 'a',
    prompt: 'x',
    model: 'm',
    mode: 'code',
    engine: 'alisa',
    runner: async context => {
      context.signal.addEventListener('abort', () => { sawAbort = true; });
      await Bun.sleep(20);
      return { status: 'cancelled', detail: 'Cancelled' };
    },
  });

  expect(registry.abort(run.id)).toBe(true);
  const result = await finished;
  expect(sawAbort).toBe(true);
  expect(result.status).toBe('cancelled');
  expect(registry.abort(run.id)).toBe(false);
});

test('a throwing runner becomes an error result instead of an unhandled rejection', async () => {
  const registry = new OrchestratorRegistry();
  const events: OrchestratorEvent[] = [];
  registry.subscribeGlobal(event => events.push(event));

  const { finished } = registry.start({
    workspace: 'C:/repo',
    cwd: 'C:/repo',
    sessionId: 'a',
    prompt: 'x',
    model: 'm',
    mode: 'code',
    engine: 'alisa',
    runner: async () => { throw new Error('provider exploded'); },
  });

  const result = await finished;
  expect(result.status).toBe('error');
  expect(result.detail).toBe('provider exploded');
  expect(events.at(-1)?.type).toBe('orchestrator_run_finished');
  expect(registry.activeCount).toBe(0);
});

test('a throwing subscriber cannot break a run', async () => {
  const registry = new OrchestratorRegistry();
  const seen: string[] = [];
  registry.subscribeGlobal(() => { throw new Error('bad ui listener'); });
  registry.subscribeGlobal(event => seen.push(event.type));

  const { finished } = registry.start({
    workspace: 'C:/repo',
    cwd: 'C:/repo',
    sessionId: 'a',
    prompt: 'x',
    model: 'm',
    mode: 'code',
    engine: 'alisa',
    runner: async () => ({ status: 'done', detail: 'ok' }),
  });

  expect((await finished).status).toBe('done');
  expect(seen).toEqual(['orchestrator_run_started', 'orchestrator_run_finished']);
});

test('updates after a run finishes are ignored', async () => {
  const registry = new OrchestratorRegistry();
  const gate = deferred<{ status: RunStatus; detail: string }>();
  const { run, finished } = registry.start({
    workspace: 'C:/repo', cwd: 'C:/repo', sessionId: 'a', prompt: 'x', model: 'm', mode: 'code', engine: 'alisa',
    runner: async () => gate.promise,
  });
  gate.resolve({ status: 'done', detail: 'done' });
  await finished;
  expect(registry.snapshot(run.id)).toBeUndefined();
});