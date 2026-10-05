import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Play, Square, Terminal as TerminalIcon } from 'lucide-react';
import { WS_URL } from '../WorktreeTile.tsx';
import type { RunSnapshot } from '../../orchestrator-types';

interface AgentTerminalPaneProps {
  /** Absent means the main workspace. */
  worktreeId?: string;
  cwdLabel: string;
  run?: RunSnapshot;
}

interface TerminalEvent {
  type: string;
  sessionId?: string;
  data?: string;
  stream?: 'stdout' | 'stderr';
  message?: string;
  cwd?: string;
  code?: number | null;
  reason?: string;
}

/**
 * A persistent local shell for one agent tab.
 *
 * It opens a PTY-less piped shell (the same protocol the studio terminal uses)
 * with the working directory pinned to that tab's checkout, and auto-restarts
 * when the backend reconnects so a tab is never left blank.
 */
export function AgentTerminalPane(props: AgentTerminalPaneProps) {
  const { worktreeId, cwdLabel } = props;
  const [output, setOutput] = useState('');
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const socketRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const buffer = { value: '' };
    pendingRef.current = null;

    const append = (text: string) => {
      buffer.value += text;
      const paint = () => setOutput(buffer.value);
      if (pendingRef.current !== null) return;
      pendingRef.current = window.setTimeout(() => {
        pendingRef.current = null;
        paint();
      }, 40);
    };

    const start = (socket: WebSocket) => {
      socket.send(JSON.stringify({
        type: 'terminal_start',
        target: 'local',
        worktreeId,
      }));
    };

    const connect = () => {
      if (closed) return;
      const socket = new WebSocket(WS_URL);
      socketRef.current = socket;
      socket.onopen = () => setConnected(true);
      socket.onclose = () => {
        setConnected(false);
        setSessionId('');
        if (!closed) retry = setTimeout(connect, 1200);
      };
      socket.onmessage = event => {
        let payload: TerminalEvent;
        try { payload = JSON.parse(String(event.data)); } catch { return; }
        if (payload.type === 'terminal_started') {
          setSessionId(payload.sessionId || '');
          setError('');
        } else if (payload.type === 'terminal_output' && payload.data) {
          append(payload.data);
        } else if (payload.type === 'terminal_exit') {
          append(`\n\x1b[90m— session ended (${payload.reason || `code ${payload.code ?? 'unknown'}`}) —\x1b[0m\n`);
          setSessionId('');
        } else if (payload.type === 'terminal_error' && payload.message) {
          setError(payload.message);
        }
      };
      socket.onerror = () => setConnected(false);
      // The shell only starts once the socket is open, and the tab key makes
      // each shell independent.
      socket.onopen = () => {
        setConnected(true);
        start(socket);
      };
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      if (pendingRef.current !== null) window.clearTimeout(pendingRef.current);
      try { socketRef.current?.close(); } catch { /* Already closing. */ }
    };
  }, [worktreeId]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [output]);

  const send = useCallback((value: string) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !sessionId) return;
    socket.send(JSON.stringify({ type: 'terminal_input', sessionId, data: value }));
  }, [sessionId]);

  const submit = useCallback(() => {
    if (!sessionId) return;
    send(`${input}\n`);
    setInput('');
  }, [input, send, sessionId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#080a0f]">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-1.5 text-[10px] text-slate-600">
        <TerminalIcon className="h-3 w-3 shrink-0" />
        <span className="min-w-0 truncate" title={cwdLabel}>{cwdLabel || 'no directory'}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {connected ? <span className="text-emerald-400">connected</span> : <span className="text-amber-400">connecting…</span>}
          {sessionId
            ? <button type="button" onClick={() => send('\x03')} className="rounded p-0.5 hover:text-slate-300" title="Send Ctrl+C"><Square className="h-3 w-3 fill-current" /></button>
            : <Loader2 className="h-3 w-3 animate-spin" />}
        </span>
      </div>

      {error && <div className="shrink-0 border-b border-rose-300/20 bg-rose-300/10 px-3 py-1.5 text-[10px] text-rose-200">{error}</div>}

      <pre
        ref={scrollRef}
        onClick={() => document.getElementById(`gent-input-${worktreeId ?? 'main'}`)?.focus()}
        className="tab-scroll min-h-0 flex-1 cursor-text overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-300"
      >
        {output || <span className="text-slate-700">Starting a shell in this checkout…</span>}
      </pre>

      <div className="flex shrink-0 items-center gap-2 border-t border-white/[0.06] px-3 py-1.5">
        <span className="shrink-0 font-mono text-[11px] text-slate-600">$</span>
        <input
          id={`gent-input-${worktreeId ?? 'main'}`}
          value={input}
          disabled={!sessionId}
          onChange={event => setInput(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); submit(); }
          }}
          placeholder={sessionId ? 'Run a command in this worktree' : 'Waiting for the shell…'}
          className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-slate-200 outline-none placeholder:text-slate-700 disabled:cursor-not-allowed"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!sessionId || !input.trim()}
          className="flex shrink-0 items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[10px] text-slate-300 hover:bg-white/[0.06] disabled:opacity-40"
        >
          <Play className="h-3 w-3" /> Run
        </button>
      </div>
    </div>
  );
}