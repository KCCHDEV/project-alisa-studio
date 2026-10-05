import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  GitBranch,
  Layers,
  Loader2,
  Plus,
  RefreshCcw,
  Send,
  Square,
  X,
} from 'lucide-react';
import {
  useAnnotationCounts,
  useOrchestratorSocket,
  useWorktreeOverview,
  WorktreeTile,
} from './WorktreeTile.tsx';
import { WorktreeReviewModal } from './WorktreeReviewModal.tsx';
import { API_BASE } from './WorktreeTile.tsx';
import type { CliAgentAvailability, RunSnapshot, WorktreeRecord } from '../orchestrator-types';

async function postJson(route: string, body: Record<string, unknown>) {
  const response = await fetch(`${API_BASE}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: window.location.origin },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as any;
  if (!response.ok) throw new Error(payload?.error || 'Request failed');
  return payload;
}

interface OrchestratorViewProps {
  sessionId: string;
  model: string;
  onClose: () => void;
}

export function OrchestratorView(props: OrchestratorViewProps) {
  const { sessionId, model, onClose } = props;
  const { overview, loading, error: loadError, refresh } = useWorktreeOverview();
  const [runs, setRuns] = useState<RunSnapshot[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState<WorktreeRecord | null>(null);
  const [transcripts, setTranscripts] = useState<Record<string, string>>({});

  // Title becomes both the worktree slug and the initial task, so one field is
  // enough to spin up an isolated agent.
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [baseRef, setBaseRef] = useState('');
  const [engine, setEngine] = useState<'alisa' | 'cli'>('alisa');
  const [cliAgents, setCliAgents] = useState<CliAgentAvailability[]>([]);
  const [cliAgentId, setCliAgentId] = useState('');

  const handleEvent = useCallback((event: any) => {
    if (event?.type === 'orchestrator_snapshot') {
      setRuns(event.runs ?? []);
      return;
    }
    if (event?.type === 'orchestrator_run_started') {
      setRuns(current => [event.run, ...current.filter(run => run.id !== event.run.id)]);
      return;
    }
    if (event?.type === 'orchestrator_run_updated') {
      setRuns(current => current.map(run => (run.id === event.run.id ? event.run : run)));
      return;
    }
    if (event?.type === 'orchestrator_run_finished') {
      setRuns(current => current.filter(run => run.id !== event.run.id));
      setNotice(`${event.run.label} · ${event.run.detail}`);
      return;
    }
    if (event?.type === 'cli_agent_output' && typeof event.runId === 'string') {
      setTranscripts(current => ({ ...current, [event.runId]: `${current[event.runId] ?? ''}${event.data}` }));
      return;
    }
    if (event?.type === 'error') setError(event.message || 'Something went wrong');
  }, []);

  const { connected, send } = useOrchestratorSocket(handleEvent);

  useEffect(() => {
    if (overview?.repo.baseRef) setBaseRef(current => current || overview.repo.baseRef!);
  }, [overview?.repo.baseRef]);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(`${API_BASE}/api/cli-agents?versions=0&verifyYolo=1`, { headers: { Origin: window.location.origin } });
        if (!response.ok) return;
        const payload = await response.json() as { agents?: CliAgentAvailability[] };
        setCliAgents((payload.agents ?? []).filter(agent => agent.installed));
        setCliAgentId(current => current || (payload.agents ?? []).find(agent => agent.installed)?.id || '');
      } catch { /* Detection is best effort. */ }
    })();
  }, []);

  const worktrees = overview?.worktrees ?? [];
  const selectedCli = useMemo(() => cliAgents.find(entry => entry.id === cliAgentId), [cliAgents, cliAgentId]);
  const annotationCounts = useAnnotationCounts(worktrees);
  const runByWorktree = useMemo(() => {
    const map = new Map<string, RunSnapshot>();
    for (const run of runs) if (run.worktreeId) map.set(run.worktreeId, run);
    return map;
  }, [runs]);
  const capacity = overview?.capacity ?? 1;

  const startRun = useCallback((record: WorktreeRecord, overridePrompt?: string) => {
    const task = (overridePrompt ?? record.prompt ?? record.title).trim();
    if (!task) {
      setError(`Give ${record.title} a task before starting the agent`);
      return;
    }
    if (runs.length >= capacity) {
      setError(`All ${capacity} agent slots are busy. Stop one first.`);
      return;
    }
    setError('');
    const started = send({
      type: 'start_task',
      prompt: task,
      sessionId,
      model,
      worktreeId: record.id,
      engine: record.engine,
      cliAgentId: record.cliAgentId ?? cliAgentId,
    });
    if (!started) setError('Not connected to the backend yet');
    else setNotice(`Started ${record.title}`);
  }, [capacity, cliAgentId, model, runs.length, send, sessionId]);

  const createWorktree = useCallback(async () => {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError('Give the task a short title');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const created = await postJson('/api/worktrees', {
        title: cleanTitle,
        prompt: prompt.trim() || cleanTitle,
        baseRef: baseRef || undefined,
        engine,
        cliAgentId: engine === 'cli' ? cliAgentId || undefined : undefined,
        sessionId,
      });
      setTitle('');
      setPrompt('');
      await refresh();
      startRun(created as WorktreeRecord);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create the worktree');
    } finally {
      setBusy(false);
    }
  }, [baseRef, cliAgentId, engine, prompt, refresh, sessionId, startRun, title]);

  const mergeWorktree = useCallback(async (record: WorktreeRecord) => {
    setBusy(true);
    setError('');
    try {
      const result = await postJson('/api/worktrees/merge', { id: record.id });
      setNotice(result.conflicted ? 'Merge hit conflicts — resolve them in the main workspace' : result.alreadyUpToDate ? 'Already up to date' : `Merged ${record.branch}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to merge');
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const removeWorktree = useCallback(async (record: WorktreeRecord) => {
    setBusy(true);
    setError('');
    try {
      await postJson('/api/worktrees/remove', { id: record.id, deleteBranch: true });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove the worktree');
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const stopRun = useCallback((run: RunSnapshot) => {
    send({ type: 'abort_task', runId: run.id });
  }, [send]);

  const sendNotes = useCallback((record: WorktreeRecord, notePrompt: string) => {
    setReviewing(null);
    startRun(record, notePrompt);
  }, [startRun]);

  const repo = overview?.repo;
  const unavailable = Boolean(repo && !repo.available);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#0b0d12]">
      <header className="flex shrink-0 items-center gap-2 border-b border-white/[0.08] bg-[#11151d] px-4 py-3">
        <Boxes className="h-4 w-4 text-pink-300" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-slate-100">Orchestrator</h1>
          <p className="truncate text-[11px] text-slate-500">
            {repo?.repoRoot ? repo.repoRoot : 'No Git repository detected'}
            {repo?.worktreeRoot ? ` · worktrees in ${repo.worktreeRoot}` : ''}
          </p>
        </div>
        <span className={'shrink-0 rounded-full border px-2 py-0.5 text-[10px] ' + (runs.length >= capacity ? 'border-amber-300/30 bg-amber-300/10 text-amber-200' : 'border-white/10 bg-white/[0.04] text-slate-400')}>
          <Layers className="mr-1 inline h-3 w-3" />{runs.length}/{capacity} agents
        </span>
        <button type="button" onClick={() => void refresh()} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200" title="Refresh"><RefreshCcw className={'h-4 w-4 ' + (loading ? 'animate-spin' : '')} /></button>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200" title="Back to chat"><X className="h-4 w-4" /></button>
      </header>

      {(error || loadError) && <div className="flex shrink-0 items-start gap-2 border-b border-rose-300/20 bg-rose-300/10 px-4 py-2 text-[11px] text-rose-200"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{error || loadError}</div>}
      {notice && !error && <div className="shrink-0 border-b border-emerald-300/20 bg-emerald-300/10 px-4 py-2 text-[11px] text-emerald-200">{notice}</div>}
      {unavailable && <div className="flex shrink-0 items-start gap-2 border-b border-amber-300/20 bg-amber-300/10 px-4 py-2 text-[11px] text-amber-200"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{repo?.reason}</div>}
      {!connected && <div className="shrink-0 border-b border-white/[0.08] bg-white/[0.03] px-4 py-2 text-[11px] text-slate-400">Reconnecting to the backend…</div>}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <section className="mb-4 rounded-2xl border border-white/[0.08] bg-[#151a24]/80 p-3">
          <h2 className="mb-2 text-xs font-semibold text-slate-200">New isolated agent</h2>
          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <input
              value={title}
              onChange={event => setTitle(event.target.value)}
              placeholder="Task title — becomes the branch and folder name"
              className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-pink-300/40"
            />
            <textarea
              value={prompt}
              onChange={event => setPrompt(event.target.value)}
              rows={2}
              placeholder="What should this agent do in its worktree?"
              className="resize-y rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-pink-300/40"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <GitBranch className="h-3 w-3" />
              <select value={baseRef} onChange={event => setBaseRef(event.target.value)} className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-slate-300 outline-none">
                {(repo?.branches?.length ? repo.branches : baseRef ? [baseRef] : []).map(branch => <option key={branch} value={branch}>{branch}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
              engine
              <select value={engine} onChange={event => setEngine(event.target.value as 'alisa' | 'cli')} className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-slate-300 outline-none">
                <option value="alisa">Alisa agent</option>
                <option value="cli" disabled={!cliAgentId}>External CLI{cliAgentId ? ` · ${cliAgentId}` : ' (none installed)'}</option>
              </select>
              {engine === 'cli' && selectedCli && (
                <span className={'shrink-0 text-[10px] ' + (selectedCli.yoloVerified === true ? 'text-emerald-400/80' : 'text-amber-300/70')}>
                  {selectedCli.yoloVerified === true
                    ? `YOLO ✓ ${selectedCli.yoloArgs.join(' ')}`
                    : selectedCli.yoloVerified === false
                      ? 'YOLO flags not found in this CLI — YOLO skipped'
                      : 'no YOLO flag for this CLI'}
                </span>
              )}
            </label>
            <button
              type="button"
              disabled={busy || unavailable || runs.length >= capacity}
              onClick={() => void createWorktree()}
              className="alisa-primary-action ml-auto flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-[#171923] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Create &amp; run
            </button>
          </div>
          {runs.length >= capacity && <p className="mt-2 text-[10px] text-amber-200">Every agent slot is busy. Stop one to add more.</p>}
        </section>

        {runs.length > 0 && (
          <section className="mb-4 rounded-2xl border border-white/[0.08] bg-[#151a24]/80 p-3">
            <h2 className="mb-2 text-xs font-semibold text-slate-200">Running agents</h2>
            <div className="space-y-2">
              {runs.map(run => (
                <div key={run.id} className="rounded-xl border border-white/[0.07] bg-black/20 p-2.5">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin text-sky-300" />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-slate-200">{run.label}</span>
                    <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-slate-400">{run.engine === 'cli' ? 'CLI' : 'Alisa'}{run.swarm ? ' · swarm' : ''}</span>
                    <span className="shrink-0 text-[10px] text-slate-500">{formatElapsed(run)}</span>
                    <button type="button" onClick={() => stopRun(run)} className="flex shrink-0 items-center gap-1 rounded-lg border border-rose-300/25 bg-rose-300/10 px-2 py-1 text-[10px] text-rose-200 hover:bg-rose-300/20"><Square className="h-3 w-3 fill-current" /> Stop</button>
                  </div>
                  <p className="mt-1 truncate text-[10px] text-slate-500" title={run.detail}>{run.detail}</p>
                  {transcripts[run.id] && <pre className="tab-scroll mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-slate-400">{transcripts[run.id].slice(-2000)}</pre>}
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-xs font-semibold text-slate-200">Worktrees</h2>
            <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] text-slate-500">{worktrees.length}</span>
          </div>
          {!loading && !worktrees.length && (
            <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-[11px] text-slate-600">
              No worktrees yet. Create one above — each agent gets its own checkout so parallel runs never fight over files.
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {worktrees.map(record => (
              <WorktreeTile
                key={record.id}
                record={record}
                run={runByWorktree.get(record.id)}
                annotationCount={annotationCounts[record.id] ?? 0}
                busy={busy}
                onStart={target => startRun(target)}
                onReview={setReviewing}
                onSendNotes={target => void (async () => {
                  const payload = await fetch(`${API_BASE}/api/worktrees/annotations?id=${encodeURIComponent(target.id)}`, { headers: { Origin: window.location.origin } }).then(response => response.json()) as { prompt?: string };
                  if (payload.prompt) startRun(target, payload.prompt);
                  else setError(`${target.title} has no open review notes`);
                })()}
                onMerge={target => void mergeWorktree(target)}
                onRemove={target => void removeWorktree(target)}
              />
            ))}
          </div>
        </section>
      </div>

      {reviewing && (
        <WorktreeReviewModal
          record={reviewing}
          sessionId={sessionId}
          onClose={() => setReviewing(null)}
          onMerged={() => void refresh()}
          onSendNotes={sendNotes}
        />
      )}
    </div>
  );
}

function formatElapsed(run: RunSnapshot): string {
  const ms = (run.completedAt ?? Date.now()) - run.startedAt;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}