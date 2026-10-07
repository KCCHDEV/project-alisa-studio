import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Cpu,
  FolderGit2,
  GitBranch,
  Loader2,
  Plus,
  RefreshCcw,
  Search,
  Settings,
  Terminal as TerminalIcon,
  X,
} from 'lucide-react';
import { API_BASE, WS_URL } from './WorktreeTile.tsx';
import type { RunSnapshot, WorktreeRecord, WorktreeRepoInfo } from '../orchestrator-types';
import { ProjectsRail } from './workspace/ProjectsRail.tsx';
import { AgentTabBar, type AgentTab } from './workspace/AgentTabBar.tsx';
import { AgentTerminalPane } from './workspace/AgentTerminalPane.tsx';
import { AgentChatPane } from './workspace/AgentChatPane.tsx';
import { WorktreeExplorer } from './workspace/WorktreeExplorer.tsx';
import { SuperAgentView } from './workspace/SuperAgentView.tsx';

export interface WorkspaceProject {
  path: string;
  name: string;
  active: boolean;
  isRepo: boolean;
}

interface WorktreeWorkspaceProps {
  /** Shared with the studio view so approval policy has a single source of truth. */
  yoloMode: boolean;
  yoloSaving: boolean;
  onToggleYolo: () => void;
  /** Session and model the Super Agent runs against. */
  sessionId: string;
  model: string;
  onClose: () => void;
  onNotice: (message: string) => void;
}

async function getJson<T>(route: string): Promise<T> {
  const response = await fetch(`${API_BASE}${route}`, { headers: { Origin: window.location.origin } });
  const payload = await response.json() as any;
  if (!response.ok) throw new Error(payload?.error || `Request failed: ${route}`);
  return payload as T;
}

async function postJson<T>(route: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${API_BASE}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: window.location.origin },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as any;
  if (!response.ok) throw new Error(payload?.error || `Request failed: ${route}`);
  return payload as T;
}

/**
 * Worktree-first shell: a projects rail on the left, one tab per agent/worktree in
 * the middle, and a file explorer for the active checkout on the right.
 *
 * This coexists with the chat-first studio view rather than replacing it, so the
 * two can be compared side by side while the layout settles.
 */
export function WorktreeWorkspace(props: WorktreeWorkspaceProps) {
  const { yoloMode, yoloSaving, onToggleYolo, sessionId, model, onClose, onNotice } = props;

  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [repo, setRepo] = useState<WorktreeRepoInfo | null>(null);
  const [worktrees, setWorktrees] = useState<WorktreeRecord[]>([]);
  const [runs, setRuns] = useState<RunSnapshot[]>([]);
  const [capacity, setCapacity] = useState(1);
  const [activeTabId, setActiveTabId] = useState('main');
  const [paneMode, setPaneMode] = useState<'terminal' | 'chat'>('terminal');
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [superAgentOpen, setSuperAgentOpen] = useState(false);

  const sessionIdRef = useRef('');

  const loadProjects = useCallback(async () => {
    const config = await getJson<any>('/api/config');
    sessionIdRef.current = config.sessionId || '';
    const active = config.workspaceDir as string;
    const recents = (config.recentWorkspaces || []) as string[];
    const paths = [active, ...recents.filter(item => item !== active)];
    setProjects(paths.map(item => ({
      path: item,
      name: item.split(/[\\/]/).filter(Boolean).pop() || item,
      active: item === active,
      isRepo: true,
    })));
  }, []);

  const loadWorktrees = useCallback(async () => {
    const payload = await getJson<any>('/api/worktrees');
    setRepo({
      repoRoot: payload.repoRoot ?? null,
      worktreeRoot: payload.worktreeRoot ?? null,
      baseRef: payload.baseRef ?? null,
      branches: payload.branches ?? [],
      available: payload.available === true,
      reason: payload.reason,
    });
    setWorktrees(payload.worktrees ?? []);
    setRuns(payload.runs ?? []);
    setCapacity(payload.capacity ?? 1);
    setError('');
  }, []);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        await loadProjects();
        await loadWorktrees();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load the workspace');
      } finally {
        setLoading(false);
      }
    })();
  }, [loadProjects, loadWorktrees]);

  /**
   * This view keeps its own socket so it can see every agent at once.
   * Events are routed by runId, which is what makes multi-agent tabs possible.
   */
  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (closed) return;
      const socket = new WebSocket(WS_URL);
      socket.onopen = () => {
        socket.send(JSON.stringify({ type: 'orchestrator_request' }));
      };
      socket.onclose = () => { if (!closed) retry = setTimeout(connect, 1200); };
      socket.onmessage = event => {
        try {
          const payload = JSON.parse(String(event.data));
          if (payload.type === 'orchestrator_snapshot' || payload.type === 'orchestrator_run_started' || payload.type === 'orchestrator_run_updated' || payload.type === 'orchestrator_run_finished') {
            void loadWorktrees();
          }
        } catch { /* Ignore malformed frames. */ }
      };
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
    };
  }, [loadWorktrees]);

  const tabs = useMemo<AgentTab[]>(() => {
    const main: AgentTab = { id: 'main', kind: 'main', title: 'Main workspace', record: undefined, run: undefined };
    const rest = worktrees.map<AgentTab>(record => ({
      id: record.id,
      kind: 'worktree',
      title: record.title,
      record,
      run: runs.find(run => run.worktreeId === record.id),
    }));
    return [main, ...rest];
  }, [worktrees, runs]);

  const activeTab = useMemo(() => tabs.find(tab => tab.id === activeTabId) ?? tabs[0], [tabs, activeTabId]);
  const activeWorktree = activeTab?.record;

  const createWorktree = useCallback(async () => {
    const title = newTitle.trim();
    if (!title) return;
    setCreating(true);
    try {
      const created = await postJson<any>('/api/worktrees', { title, prompt: title });
      setNewTitle('');
      await loadWorktrees();
      setActiveTabId(created.id);
      onNotice(`Created worktree ${created.branch}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create the worktree');
    } finally {
      setCreating(false);
    }
  }, [loadWorktrees, newTitle, onNotice]);

  return (
    <div className="fixed inset-0 z-40 flex bg-[#0b0d12] text-slate-200">
      <ProjectsRail
        projects={projects}
        repo={repo}
        worktrees={worktrees}
        runs={runs}
        activeTabId={activeTabId}
        loading={loading}
        onSelect={setActiveTabId}
        onRefresh={() => void loadWorktrees()}
        onNewProject={() => onNotice('Use the studio view to open another project folder')}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-white/[0.08] bg-[#11151d] px-3">
          <FolderGit2 className="h-4 w-4 shrink-0 text-pink-300" />
          <button
            type="button"
            onClick={() => setSuperAgentOpen(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-pink-300/25 bg-pink-300/10 px-2 py-1 text-[11px] font-semibold text-pink-200 hover:bg-pink-300/20"
            title="Super Agent — plans the work, delegates it to other agents, runs the checks, merges what passes"
          >
            <Cpu className="h-3 w-3" /> Super Agent
          </button>
          <span className="min-w-0 truncate text-xs font-semibold text-slate-100">
            {activeTab?.title ?? 'Workspace'}
          </span>
          {activeWorktree && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-slate-400">
              <GitBranch className="h-3 w-3" />
              {activeWorktree.branch}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <span className="hidden shrink-0 text-[10px] text-slate-500 sm:inline">
              {runs.length}/{capacity} agents
            </span>
            <div className="flex shrink-0 overflow-hidden rounded-lg border border-white/10">
              <button
                type="button"
                onClick={() => setPaneMode('terminal')}
                className={'flex items-center gap-1 px-2 py-1 text-[11px] transition ' + (paneMode === 'terminal' ? 'bg-white/[0.10] text-white' : 'text-slate-500 hover:text-slate-300')}
              >
                <TerminalIcon className="h-3 w-3" /> Terminal
              </button>
              <button
                type="button"
                onClick={() => setPaneMode('chat')}
                className={'flex items-center gap-1 px-2 py-1 text-[11px] transition ' + (paneMode === 'chat' ? 'bg-white/[0.10] text-white' : 'text-slate-500 hover:text-slate-300')}
              >
                <Bot className="h-3 w-3" /> Chat
              </button>
            </div>
            <button type="button" onClick={() => setExplorerOpen(value => !value)} className={'rounded-lg border p-1.5 transition ' + (explorerOpen ? 'border-white/15 bg-white/[0.08] text-white' : 'border-white/10 text-slate-500')} title="Toggle file explorer">
              <Search className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => onClose()} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200" title="Back to studio">
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {error && (
          <div className="shrink-0 border-b border-rose-300/20 bg-rose-300/10 px-3 py-1.5 text-[11px] text-rose-200">{error}</div>
        )}

        <AgentTabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelect={setActiveTabId}
          newTitle={newTitle}
          onNewTitleChange={setNewTitle}
          onCreate={() => void createWorktree()}
          creating={creating}
          capacity={capacity}
          activeRuns={runs.length}
        />

        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-16 text-[11px] text-slate-600">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading workspace
              </div>
            )}
            {!loading && activeTab && paneMode === 'terminal' && (
              <AgentTerminalPane
                key={activeTab.id}
                worktreeId={activeTab.kind === 'worktree' ? activeTab.id : undefined}
                cwdLabel={activeWorktree?.path ?? repo?.repoRoot ?? ''}
                run={activeTab.run}
              />
            )}
            {!loading && activeTab && paneMode === 'chat' && (
              <AgentChatPane
                key={activeTab.id}
                worktreeId={activeTab.kind === 'worktree' ? activeTab.id : undefined}
                title={activeTab.title}
                record={activeTab.record}
                run={activeTab.run}
                yoloMode={yoloMode}
                yoloSaving={yoloSaving}
                onToggleYolo={onToggleYolo}
                onNotice={onNotice}
                onChanged={() => void loadWorktrees()}
              />
            )}
          </section>

          {explorerOpen && (
            <WorktreeExplorer
              worktreeId={activeWorktree?.id}
              rootLabel={activeTab?.title ?? 'workspace'}
              rootPath={activeWorktree?.path ?? repo?.repoRoot ?? ''}
              branch={activeWorktree?.branch ?? repo?.baseRef ?? ''}
              changedCount={activeWorktree?.status.dirtyCount ?? 0}
              onOpenWorktree={() => onNotice('Switching projects is done from the studio view for now')}
            />
          )}
        </div>

        <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-white/[0.08] bg-[#0f131b] px-3 text-[10px] text-slate-500">
          <span className="flex items-center gap-1 text-slate-400">
            <GitBranch className="h-3 w-3" />
            {activeWorktree?.branch ?? repo?.baseRef ?? 'no branch'}
          </span>
          <span>{activeWorktree?.status.dirtyCount ?? 0} changed</span>
          {activeWorktree && <span>+{activeWorktree.status.ahead} / −{activeWorktree.status.behind}</span>}
          <span className="ml-auto flex items-center gap-1">
            <RefreshCcw className="h-3 w-3" />
            {repo?.repoRoot ? 'git worktree' : 'not a repository'}
          </span>
        </footer>
      </div>

      {superAgentOpen && (
        <SuperAgentView
          sessionId={sessionId}
          model={model}
          yoloMode={yoloMode}
          onNotice={onNotice}
          onClose={() => setSuperAgentOpen(false)}
        />
      )}
    </div>
  );
}

export { Plus, Settings };