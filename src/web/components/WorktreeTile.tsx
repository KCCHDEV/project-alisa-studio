import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GitMerge, Loader2, MessageSquarePlus, Trash2 } from 'lucide-react';
import type { DiffAnnotation, WorktreeRecord, WorktreeOverview } from '../orchestrator-types';
import { statusTone, type RunSnapshot } from '../orchestrator-types';

/** Matches the desktop backend address used across the studio UI. */
export const API_BASE = 'http://127.0.0.1:3101';
export const WS_URL = 'ws://127.0.0.1:3101/ws';

const TONE_TEXT: Record<string, string> = {
  idle: 'text-slate-400 border-white/10 bg-white/[0.04]',
  busy: 'text-sky-200 border-sky-300/30 bg-sky-300/10',
  good: 'text-emerald-200 border-emerald-300/30 bg-emerald-300/10',
  warn: 'text-amber-200 border-amber-300/30 bg-amber-300/10',
  bad: 'text-rose-200 border-rose-300/30 bg-rose-300/10',
};

const STATUS_TEXT: Record<string, string> = {
  idle: 'Idle',
  busy: 'Working',
  good: 'Ready',
  warn: 'Changes',
  bad: 'Attention',
};

interface WorktreeTileProps {
  record: WorktreeRecord;
  run?: RunSnapshot;
  annotationCount: number;
  busy: boolean;
  onStart: (record: WorktreeRecord) => void;
  onReview: (record: WorktreeRecord) => void;
  onSendNotes: (record: WorktreeRecord) => void;
  onMerge: (record: WorktreeRecord) => void;
  onRemove: (record: WorktreeRecord) => void;
}

export function WorktreeTile(props: WorktreeTileProps) {
  const { record, run, annotationCount, busy, onStart, onReview, onSendNotes, onMerge, onRemove } = props;
  const status = record.status;
  const tone = statusTone(status, run);
  const running = run?.status === 'running' || run?.status === 'queued';
  const blocked = record.orphaned || status.missing;
  const canMerge = !blocked && !running && (status.ahead > 0 || status.dirtyCount > 0);

  return (
    <article className={'flex min-w-0 flex-col rounded-2xl border bg-[#151a24]/80 p-3 transition ' + (blocked ? 'border-rose-300/25 opacity-80' : 'border-white/[0.08] hover:border-white/[0.16]')}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-xs font-semibold text-slate-100" title={record.title}>{record.title}</h3>
            {record.engine === 'cli' && <span className="shrink-0 rounded-full bg-violet-300/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-violet-200">{record.cliAgentId || 'cli'}</span>}
          </div>
          <p className="mt-0.5 truncate text-[10px] text-slate-500" title={record.branch}>{record.branch}</p>
        </div>
        <span className={'shrink-0 rounded-full border px-2 py-0.5 text-[10px] ' + (TONE_TEXT[tone] ?? TONE_TEXT.idle)}>
          {running ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : null}
          {STATUS_TEXT[tone]}
        </span>
      </div>

      {run?.detail && <p className="mt-2 line-clamp-2 text-[10px] leading-relaxed text-slate-400" title={run.detail}>{run.detail}</p>}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
        <span className="rounded-md bg-white/[0.05] px-1.5 py-0.5">{status.dirtyCount} changed</span>
        <span className="rounded-md bg-white/[0.05] px-1.5 py-0.5">+{status.ahead} / −{status.behind}</span>
        {annotationCount > 0 && <span className="rounded-md bg-amber-300/10 px-1.5 py-0.5 text-amber-200">{annotationCount} note{annotationCount === 1 ? '' : 's'}</span>}
        {status.lastCommit && <span className="truncate" title={status.lastCommit.subject}>{status.lastCommit.hash.slice(0, 7)}</span>}
      </div>

      {blocked && <p className="mt-2 text-[10px] text-rose-300">Directory or branch is missing. Remove this tile to clean up.</p>}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={busy || blocked || running}
          onClick={() => onStart(record)}
          className="alisa-primary-action flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-[#171923] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <MessageSquarePlus className="h-3 w-3" /> {record.prompt ? 'Run prompt' : 'Give task'}
        </button>
        <button
          type="button"
          disabled={busy || blocked}
          onClick={() => onReview(record)}
          className="rounded-lg border border-white/10 px-2 py-1.5 text-[11px] text-slate-300 hover:bg-white/[0.06] disabled:opacity-40"
        >
          Review
        </button>
        <button
          type="button"
          disabled={busy || !annotationCount || blocked}
          onClick={() => onSendNotes(record)}
          title="Send review notes back to the agent"
          className="rounded-lg border border-white/10 px-2 py-1.5 text-[11px] text-slate-300 hover:bg-white/[0.06] disabled:opacity-40"
        >
          Send notes
        </button>
        <button
          type="button"
          disabled={busy || !canMerge}
          onClick={() => onMerge(record)}
          title={canMerge ? 'Merge into the main workspace' : 'Nothing to merge yet'}
          className="flex items-center gap-1 rounded-lg border border-emerald-300/25 bg-emerald-300/10 px-2 py-1.5 text-[11px] text-emerald-200 hover:bg-emerald-300/20 disabled:opacity-40"
        >
          <GitMerge className="h-3 w-3" /> Merge
        </button>
        <button
          type="button"
          disabled={busy || running}
          onClick={() => onRemove(record)}
          title="Remove worktree"
          className="ml-auto rounded-lg border border-white/10 p-1.5 text-slate-500 hover:border-rose-300/30 hover:text-rose-200 disabled:opacity-40"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </article>
  );
}

interface AnnotationCounts {
  [worktreeId: string]: number;
}

export function useAnnotationCounts(records: WorktreeRecord[]): AnnotationCounts {
  const [counts, setCounts] = useState<AnnotationCounts>({});
  const requested = useRef<string>('');

  useEffect(() => {
    const ids = records.map(record => record.id).sort().join(',');
    if (!ids || requested.current === ids) return;
    requested.current = ids;
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(ids.split(',').map(async id => {
        try {
          const response = await fetch(`${API_BASE}/api/worktrees/annotations?id=${encodeURIComponent(id)}`, { headers: { Origin: window.location.origin } });
          if (!response.ok) return [id, 0] as const;
          const payload = await response.json() as { annotations?: Array<{ resolved: boolean }> };
          return [id, (payload.annotations ?? []).filter(entry => !entry.resolved).length] as const;
        } catch {
          return [id, 0] as const;
        }
      }));
      if (!cancelled) setCounts(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [records]);

  return counts;
}

export function useOrchestratorSocket(onEvent: (event: any) => void) {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  const send = useCallback((message: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }, []);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (closed) return;
      // The webview origin is `tauri://` in the desktop app, so the backend
      // address cannot be derived from `window.location`.
      const socket = new WebSocket(WS_URL);
      socketRef.current = socket;
      socket.onopen = () => setConnected(true);
      socket.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1200);
      };
      socket.onerror = () => setConnected(false);
      socket.onmessage = event => {
        try { handlerRef.current(JSON.parse(String(event.data))); } catch { /* Ignore malformed frames. */ }
      };
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      try { socketRef.current?.close(); } catch { /* Already closing. */ }
    };
  }, []);

  return { connected, send };
}

export function useWorktreeOverview() {
  const [overview, setOverview] = useState<WorktreeOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/worktrees`, { headers: { Origin: window.location.origin } });
      const payload = await response.json() as any;
      if (!response.ok) throw new Error(payload?.error || 'Unable to load worktrees');
      setOverview({
        repo: {
          repoRoot: payload.repoRoot ?? null,
          worktreeRoot: payload.worktreeRoot ?? null,
          baseRef: payload.baseRef ?? null,
          branches: payload.branches ?? [],
          available: payload.available === true,
          reason: payload.reason,
        },
        worktrees: payload.worktrees ?? [],
        runs: payload.runs ?? [],
        capacity: payload.capacity ?? 1,
      });
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load worktrees');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return useMemo(() => ({ overview, loading, error, refresh, setOverview }), [overview, loading, error, refresh]);
}