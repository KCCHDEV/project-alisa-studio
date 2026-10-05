import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, GitMerge, Loader2, Send, Square, Trash2 } from 'lucide-react';
import { API_BASE, WS_URL } from '../WorktreeTile.tsx';
import type { RunSnapshot, WorktreeRecord } from '../../orchestrator-types';

interface AgentChatPaneProps {
  worktreeId?: string;
  title: string;
  record?: WorktreeRecord;
  run?: RunSnapshot;
  /** Mirrors the studio YOLO setting, so the approval policy is never a surprise. */
  yoloMode: boolean;
  yoloSaving: boolean;
  onToggleYolo: () => void;
  onNotice: (message: string) => void;
  onChanged: () => void;
}

interface ChatLine {
  role: 'user' | 'agent' | 'system';
  text: string;
}

async function postJson<T>(route: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${API_BASE}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: window.location.origin },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as any;
  if (!response.ok) throw new Error(payload?.error || 'Request failed');
  return payload as T;
}

/**
 * Chat view for one agent tab. Each tab owns its own socket so several agents can
 * stream independently, and events are filtered by the run that owns the tab.
 */
export function AgentChatPane(props: AgentChatPaneProps) {
  const { worktreeId, title, record, run, yoloMode, yoloSaving, onToggleYolo, onNotice, onChanged } = props;
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [input, setInput] = useState('');
  const [detail, setDetail] = useState('');
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [engine, setEngine] = useState<'alisa' | 'cli'>(record?.engine === 'cli' ? 'cli' : 'alisa');
  const runIdRef = useRef<string>('');
  const startedRef = useRef(false);
  const socketRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (closed) return;
      const socket = new WebSocket(WS_URL);
      socketRef.current = socket;
      socket.onopen = () => setConnected(true);
      socket.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1200);
      };
      socket.onmessage = event => {
        let payload: any;
        try { payload = JSON.parse(String(event.data)); } catch { return; }
        // Only accept events belonging to this tab's run, so sibling agents stay quiet.
        if (runIdRef.current && payload.runId && payload.runId !== runIdRef.current) return;
        if (payload.type === 'task_state') {
          setDetail(payload.detail || '');
        } else if (payload.type === 'message_added' && payload.message) {
          if (!payload.message.role || payload.message.role === 'user') return;
          setLines(current => [...current, { role: 'agent', text: String(payload.message.content ?? '') }]);
        } else if (payload.type === 'cli_agent_output' && payload.data) {
          setLines(current => {
            const last = current.at(-1);
            if (last?.role === 'system') return [...current.slice(0, -1), { role: 'system', text: last.text + payload.data }];
            return [...current, { role: 'system', text: payload.data }];
          });
        } else if (payload.type === 'error' && payload.message) {
          setLines(current => [...current, { role: 'system', text: `⚠ ${payload.message}` }]);
        } else if (payload.type === 'session_saved') {
          setBusy(false);
          onChanged();
        }
      };
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      try { socketRef.current?.close(); } catch { /* Already closing. */ }
    };
  }, [onChanged]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines]);

  const send = useCallback((prompt: string) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({
      type: 'start_task',
      prompt,
      worktreeId,
      engine,
      swarm: false,
    }));
    return true;
  }, [engine, worktreeId]);

  const submit = useCallback(() => {
    const prompt = input.trim();
    if (!prompt) return;
    if (!send(prompt)) {
      setLines(current => [...current, { role: 'system', text: '⚠ Not connected to the backend yet' }]);
      return;
    }
    setLines(current => [...current, { role: 'user', text: prompt }]);
    setInput('');
    setBusy(true);
    startedRef.current = true;
  }, [input, send]);

  // A tab that was already running before it opened still needs its run id so the
  // event filter can be installed.
  useEffect(() => {
    if (run?.id) runIdRef.current = run.id;
  }, [run?.id]);

  const stop = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (runIdRef.current) socket.send(JSON.stringify({ type: 'abort_task', runId: runIdRef.current }));
    setBusy(false);
  }, []);

  const merge = useCallback(async () => {
    if (!record) return;
    try {
      const result = await postJson<any>('/api/worktrees/merge', { id: record.id });
      onNotice(result.conflicted ? 'Merge hit conflicts in the main workspace' : result.alreadyUpToDate ? 'Already up to date' : `Merged ${record.branch}`);
      onChanged();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Unable to merge');
    }
  }, [record, onNotice, onChanged]);

  const remove = useCallback(async () => {
    if (!record) return;
    try {
      await postJson('/api/worktrees/remove', { id: record.id, deleteBranch: true });
      onNotice(`Removed ${record.title}`);
      onChanged();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Unable to remove the worktree');
    }
  }, [record, onNotice, onChanged]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#0b0d12]">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-1.5">
        <Bot className="h-3 w-3 shrink-0 text-pink-300" />
        <span className="min-w-0 truncate text-[11px] text-slate-300">{title}</span>
        <select
          value={engine}
          onChange={event => setEngine(event.target.value as 'alisa' | 'cli')}
          className="shrink-0 rounded border border-white/10 bg-black/40 px-1.5 py-0.5 text-[10px] text-slate-300 outline-none"
        >
          <option value="alisa">Alisa agent</option>
          <option value="cli">External CLI</option>
        </select>
        <button
          type="button"
          onClick={onToggleYolo}
          disabled={yoloSaving}
          title={yoloMode
            ? 'YOLO on: agents run without stopping for approval prompts'
            : 'Safe mode: approval-gated actions wait for confirmation'}
          className={'shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.1em] transition disabled:opacity-40 ' + (yoloMode
            ? 'border-rose-300/30 bg-rose-300/10 text-rose-200'
            : 'border-white/10 text-slate-500 hover:border-white/20 hover:text-slate-300')}
        >
          {yoloMode ? 'YOLO' : 'Safe'}
        </button>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[10px] text-slate-600">
          {connected ? <span className="text-emerald-400">live</span> : <span className="text-amber-400">connecting…</span>}
          {busy && <Loader2 className="h-3 w-3 animate-spin text-sky-300" />}
        </span>
        {record && (
          <>
            <button type="button" onClick={() => void merge()} className="flex shrink-0 items-center gap-1 rounded-md border border-emerald-300/25 bg-emerald-300/10 px-1.5 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-300/20" title="Merge into main">
              <GitMerge className="h-3 w-3" /> Merge
            </button>
            <button type="button" onClick={() => void remove()} className="shrink-0 rounded-md border border-white/10 p-1 text-slate-600 hover:border-rose-300/30 hover:text-rose-200" title="Remove worktree">
              <Trash2 className="h-3 w-3" />
            </button>
          </>
        )}
      </div>

      {detail && <div className="shrink-0 border-b border-white/[0.06] bg-white/[0.02] px-3 py-1 text-[10px] text-slate-500">{detail}</div>}

      <div ref={scrollRef} className="tab-scroll min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {!lines.length && (
          <div className="flex h-full items-center justify-center">
            <div className="max-w-sm text-center">
              <p className="text-xs text-slate-400">
                {record ? `Ask this agent to work inside its own checkout (${record.branch}).` : 'Ask the main workspace agent.'}
              </p>
              {!record && <p className="mt-1 text-[10px] text-slate-600">Create a worktree tab to run agents in parallel.</p>}
            </div>
          </div>
        )}
        {lines.map((line, index) => (
          <div
            key={index}
            className={
              line.role === 'user'
                ? 'ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-pink-300/15 px-3 py-2 text-xs text-pink-50'
                : line.role === 'agent'
                  ? 'max-w-[90%] rounded-2xl rounded-bl-sm bg-white/[0.06] px-3 py-2 text-xs text-slate-200'
                  : 'rounded-lg bg-black/40 px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-slate-500'
            }
          >
            <pre className="whitespace-pre-wrap break-words font-sans">{line.text}</pre>
          </div>
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-white/[0.07] px-3 py-2">
        <input
          value={input}
          onChange={event => setInput(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); submit(); } }}
          placeholder="Message this agent…"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-pink-300/40"
        />
        {busy
          ? <button type="button" onClick={stop} className="flex shrink-0 items-center gap-1 rounded-lg bg-rose-300/15 px-3 py-2 text-xs text-rose-200 hover:bg-rose-300/25"><Square className="h-3 w-3 fill-current" /> Stop</button>
          : <button type="button" onClick={submit} disabled={!input.trim()} className="flex shrink-0 items-center gap-1 rounded-lg bg-pink-300/80 px-3 py-2 text-xs font-semibold text-[#171923] disabled:opacity-40"><Send className="h-3 w-3" /> Send</button>}
      </div>
    </div>
  );
}