import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  FlaskConical,
  Loader2,
  Send,
  Square,
  Users,
} from 'lucide-react';
import { API_BASE, WS_URL } from '../WorktreeTile.tsx';
import type { SuperAgentWorker } from './AgentChatPane.tsx';

interface VerificationCheck {
  kind: string;
  passed: boolean;
  summary: string;
}

interface VerifyReport {
  passed: boolean;
  checks: VerificationCheck[];
  overall: string;
  failures: string[];
}

interface ChatLine {
  role: 'user' | 'agent' | 'system';
  text: string;
  tool?: string;
}

interface SuperAgentViewProps {
  sessionId: string;
  model: string;
  yoloMode: boolean;
  onNotice: (message: string) => void;
  onClose: () => void;
}

/**
 * The Super Agent panel.
 *
 * The coordinator runs on its own socket so its delegation traffic does not
 * interleave with a worker's stream in the workspace view.
 */
export function SuperAgentView(props: SuperAgentViewProps) {
  const { sessionId, model, yoloMode, onNotice, onClose } = props;
  const [goal, setGoal] = useState('');
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [workers, setWorkers] = useState<SuperAgentWorker[]>([]);
  const [verify, setVerify] = useState<VerifyReport | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState('');
  const runIdRef = useRef<string>('');
  const socketRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const refreshWorkers = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/coordinator`, { headers: { Origin: window.location.origin } });
      if (!response.ok) return;
      const payload = await response.json() as { workers?: SuperAgentWorker[] };
      setWorkers(payload.workers ?? []);
    } catch { /* Best effort. */ }
  }, []);

  const runVerification = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/coordinator/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: window.location.origin },
        body: JSON.stringify({}),
      });
      const payload = await response.json() as VerifyReport & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Verification failed to start');
      setVerify(payload);
      onNotice(payload.passed ? 'All checks passed' : `${payload.failures.length} check failure(s)`);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setBusy(false);
    }
  }, [onNotice]);

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
        // The coordinator reports under a fixed run id; anything else belongs to
        // another agent in the workspace.
        if (payload.runId !== 'super' && !String(payload.type ?? '').startsWith('coordinator_')) return;

        if (payload.type === 'task_state') {
          setDetail(payload.detail || '');
        } else if (payload.type === 'tool_call_start') {
          setLines(current => [...current, { role: 'system', text: `→ ${payload.toolName}`, tool: payload.toolName }]);
        } else if (payload.type === 'message_added' && payload.message?.role === 'assistant') {
          setLines(current => [...current, { role: 'agent', text: String(payload.message.content ?? '') }]);
        } else if (payload.type === 'coordinator_worker_started') {
          setWorkers(current => [...current.filter(worker => worker.id !== payload.worker.id), payload.worker]);
        } else if (payload.type === 'coordinator_worker_updated') {
          setWorkers(current => current.map(worker => (worker.id === payload.worker.id ? payload.worker : worker)));
        } else if (payload.type === 'coordinator_verification') {
          setVerify(current => ({
            passed: current ? current.passed && payload.passed : payload.passed,
            checks: [...(current?.checks ?? []), { kind: payload.kind, passed: payload.passed, summary: payload.summary }],
            overall: `${current?.overall ? `${current.overall}\n` : ''}${payload.kind}: ${payload.passed ? 'PASSED' : 'FAILED'}`,
            failures: payload.passed ? (current?.failures ?? []) : [...(current?.failures ?? []), payload.summary],
          }));
        } else if (payload.type === 'session_saved') {
          setBusy(false);
          setDetail(payload.detail ?? '');
          void refreshWorkers();
        } else if (payload.type === 'error') {
          setLines(current => [...current, { role: 'system', text: `⚠ ${payload.message}` }]);
          setBusy(false);
        }
      };
    };
    connect();
    void refreshWorkers();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      try { socketRef.current?.close(); } catch { /* Already closing. */ }
    };
  }, [refreshWorkers]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines]);

  const start = useCallback(() => {
    const text = goal.trim();
    if (!text) return;
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setLines(current => [...current, { role: 'system', text: '⚠ Not connected to the backend yet' }]);
      return;
    }
    runIdRef.current = 'super';
    socket.send(JSON.stringify({ type: 'super_agent_start', goal: text, sessionId, model }));
    setLines(current => [...current, { role: 'user', text }]);
    setGoal('');
    setVerify(null);
    setBusy(true);
    setDetail('Starting the Super Agent');
  }, [goal, model, sessionId]);

  const stop = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'abort_task', runId: runIdRef.current }));
    setBusy(false);
  }, []);

  const running = workers.filter(worker => worker.status === 'running');

  return (
    <div className="fixed inset-0 z-45 flex flex-col bg-[#0b0d12] text-slate-200">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/[0.08] bg-[#11151d] px-4">
        <Cpu className="h-4 w-4 shrink-0 text-pink-300" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-slate-100">Super Agent</h1>
          <p className="truncate text-[11px] text-slate-500">Plans the work, delegates it to other agents, runs the checks, merges what is good</p>
        </div>
        <span className={'shrink-0 rounded-full border px-2 py-0.5 text-[10px] ' + (yoloMode ? 'border-rose-300/30 bg-rose-300/10 text-rose-200' : 'border-emerald-300/25 bg-emerald-300/10 text-emerald-200')}>
          {yoloMode ? 'YOLO' : 'Safe'}
        </span>
        <span className="hidden shrink-0 text-[10px] text-slate-600 sm:inline">{connected ? 'connected' : 'connecting…'}</span>
        <button type="button" onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200" title="Close">×</button>
      </header>

      {detail && <div className="shrink-0 border-b border-white/[0.07] bg-white/[0.02] px-4 py-1.5 text-[11px] text-slate-400">{detail}</div>}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={scrollRef} className="tab-scroll min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
            {!lines.length && (
              <div className="flex h-full items-center justify-center">
                <div className="max-w-md text-center">
                  <p className="text-xs text-slate-300">Give it an outcome, not a to-do list.</p>
                  <p className="mt-2 text-[10px] leading-relaxed text-slate-600">
                    It will break the work into subtasks, hand each one to another agent in an isolated worktree,
                    run your tests, and only merge what passes.
                  </p>
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
                      ? 'max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-white/[0.06] px-3 py-2 text-xs text-slate-200'
                      : 'rounded-lg bg-black/40 px-2.5 py-1 font-mono text-[10px] text-slate-500'
                }
              >
                {line.text}
              </div>
            ))}
          </div>

          <div className="flex shrink-0 items-center gap-2 border-t border-white/[0.07] px-4 py-3">
            <input
              value={goal}
              onChange={event => setGoal(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); start(); } }}
              placeholder="Describe the outcome you want…"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-pink-300/40"
            />
            {busy
              ? <button type="button" onClick={stop} className="flex shrink-0 items-center gap-1 rounded-lg bg-rose-300/15 px-3 py-2 text-xs text-rose-200 hover:bg-rose-300/25"><Square className="h-3 w-3 fill-current" /> Stop</button>
              : <button type="button" onClick={start} disabled={!goal.trim()} className="flex shrink-0 items-center gap-1 rounded-lg bg-pink-300/80 px-3 py-2 text-xs font-semibold text-[#171923] disabled:opacity-40"><Send className="h-3 w-3" /> Start</button>}
          </div>
        </div>

        <aside className="tab-scroll flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-white/[0.08] bg-[#11151d] p-3">
          <div className="mb-3">
            <div className="mb-1.5 flex items-center gap-1.5">
              <Users className="h-3 w-3 text-slate-500" />
              <h2 className="text-[11px] font-semibold text-slate-300">Workers</h2>
              {running.length > 0 && <span className="rounded-full bg-sky-300/15 px-1.5 text-[9px] text-sky-200">{running.length} running</span>}
            </div>
            {!workers.length && <p className="text-[10px] text-slate-600">None yet. The coordinator decides what to delegate.</p>}
            <div className="space-y-1.5">
              {workers.map(worker => (
                <div key={worker.id} className="rounded-lg border border-white/[0.07] bg-black/20 p-2">
                  <div className="flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${worker.status === 'running' ? 'animate-pulse bg-sky-400' : worker.status === 'done' ? 'bg-emerald-400' : worker.status === 'error' ? 'bg-rose-400' : 'bg-amber-400'}`} />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-slate-200">{worker.title}</span>
                    <span className="shrink-0 text-[9px] text-slate-600">{worker.engine === 'cli' ? worker.cliAgentId : 'alisa'}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[10px] text-slate-500" title={worker.detail}>{worker.detail}</p>
                  <div className="mt-1 flex items-center gap-1.5 text-[9px] text-slate-600">
                    <span>{worker.changedFiles} changed</span>
                    <span>+{worker.additions}/−{worker.deletions}</span>
                    {worker.durationMs !== undefined && <span>{Math.round(worker.durationMs / 1000)}s</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center gap-1.5">
              <FlaskConical className="h-3 w-3 text-slate-500" />
              <h2 className="text-[11px] font-semibold text-slate-300">Verification</h2>
              <button
                type="button"
                onClick={() => void runVerification()}
                disabled={busy}
                className="ml-auto rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/[0.06] disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Run'}
              </button>
            </div>
            {!verify && <p className="text-[10px] text-slate-600">No checks run yet.</p>}
            {verify && (
              <div className="space-y-1.5">
                {verify.checks.map((check, index) => (
                  <div key={index} className="flex items-start gap-1.5 rounded-lg border border-white/[0.07] bg-black/20 p-2">
                    {check.passed
                      ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
                      : <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-rose-400" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] text-slate-200">{check.kind} {check.passed ? 'passed' : 'failed'}</p>
                      {!check.passed && <pre className="mt-0.5 whitespace-pre-wrap font-mono text-[9px] leading-relaxed text-slate-500">{check.summary.split('\n').slice(0, 8).join('\n')}</pre>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}