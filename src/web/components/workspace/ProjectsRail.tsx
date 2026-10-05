import { useMemo, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  ChevronRight,
  FolderPlus,
  GitBranch,
  LayoutGrid,
  Loader2,
  Plus,
  RefreshCcw,
  Search,
  Settings,
  XCircle,
} from 'lucide-react';
import type { RunSnapshot, WorktreeRecord, WorktreeRepoInfo } from '../../orchestrator-types';
import type { WorkspaceProject } from '../WorktreeWorkspace.tsx';

interface ProjectsRailProps {
  projects: WorkspaceProject[];
  repo: WorktreeRepoInfo | null;
  worktrees: WorktreeRecord[];
  runs: RunSnapshot[];
  activeTabId: string;
  loading: boolean;
  onSelect: (tabId: string) => void;
  onRefresh: () => void;
  onNewProject: () => void;
}

function runDot(run?: RunSnapshot): { color: string; label: string } {
  if (!run) return { color: 'bg-slate-600', label: 'idle' };
  if (run.status === 'running' || run.status === 'queued') return { color: 'bg-sky-400', label: 'running' };
  if (run.status === 'done') return { color: 'bg-emerald-400', label: 'done' };
  if (run.status === 'error') return { color: 'bg-rose-400', label: 'error' };
  return { color: 'bg-amber-400', label: 'cancelled' };
}

/**
 * Left rail: navigation on top, then every known project, with
 * the active one expanding into its worktrees so each agent has a visible home.
 */
export function ProjectsRail(props: ProjectsRailProps) {
  const { projects, repo, worktrees, runs, activeTabId, loading, onSelect, onRefresh, onNewProject } = props;
  const [expanded, setExpanded] = useState<string[]>([]);
  const [filter, setFilter] = useState('');

  const visibleProjects = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter(project => project.name.toLowerCase().includes(query));
  }, [projects, filter]);

  const activeProject = projects.find(project => project.active);
  const toggle = (path: string) => {
    setExpanded(current => current.includes(path) ? current.filter(item => item !== path) : [...current, path]);
  };

  return (
    <aside className="flex w-[264px] shrink-0 flex-col overflow-hidden border-r border-white/[0.08] bg-[#11151d]">
      <div className="p-2.5">
        <label className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-black/30 px-2.5 py-1.5 text-xs text-slate-500 focus-within:border-white/20">
          <Search className="h-3.5 w-3.5 shrink-0" />
          <input
            value={filter}
            onChange={event => setFilter(event.target.value)}
            placeholder="Search projects"
            className="min-w-0 flex-1 bg-transparent text-xs text-slate-200 outline-none placeholder:text-slate-600"
          />
          {filter && <button type="button" onClick={() => setFilter('')}><XCircle className="h-3.5 w-3.5" /></button>}
        </label>
      </div>

      <nav className="space-y-0.5 px-2 pb-2 text-xs text-slate-400">
        {[
          { icon: LayoutGrid, label: 'Automations' },
          { icon: Bell, label: 'Tasks' },
        ].map(entry => (
          <button key={entry.label} type="button" onClick={onNewProject} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-white/[0.05] hover:text-slate-200">
            <entry.icon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            {entry.label}
          </button>
        ))}
      </nav>

      <div className="flex items-center gap-1 border-y border-white/[0.07] px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">Projects</span>
        <div className="ml-auto flex items-center gap-0.5">
          <button type="button" onClick={onRefresh} className="rounded p-1 text-slate-600 hover:bg-white/[0.06] hover:text-slate-300" title="Refresh">
            <RefreshCcw className={'h-3.5 w-3.5 ' + (loading ? 'animate-spin' : '')} />
          </button>
          <button type="button" onClick={onNewProject} className="rounded p-1 text-slate-600 hover:bg-white/[0.06] hover:text-slate-300" title="Open another project">
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="tab-scroll min-h-0 flex-1 overflow-y-auto p-2">
        {visibleProjects.map(project => {
          const isExpanded = expanded.includes(project.path);
          const isActiveProject = project.active;
          return (
            <div key={project.path} className="mb-1">
              <div
                className={'group flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition ' + (isActiveProject && isExpanded ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]')}
              >
                <button
                  type="button"
                  onClick={() => isActiveProject ? toggle(project.path) : onNewProject()}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  title={project.path}
                >
                  <ChevronRight className={'h-3 w-3 shrink-0 text-slate-600 transition-transform ' + (isExpanded ? 'rotate-90' : '')} />
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{project.name}</span>
                </button>
                {isActiveProject && (
                  <button type="button" onClick={() => onSelect('main')} className="shrink-0 rounded-md bg-white/[0.07] px-1.5 py-0.5 text-[9px] text-slate-400 hover:bg-white/[0.12]" title="Open the main workspace tab">
                    main
                  </button>
                )}
              </div>

              {isActiveProject && isExpanded && (
                <div className="ml-4 border-l border-white/[0.07] pl-2 pt-1">
                  <button
                    type="button"
                    onClick={() => onSelect('main')}
                    className={'flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[11px] transition ' + (activeTabId === 'main' ? 'bg-sky-300/10 text-sky-200' : 'text-slate-400 hover:bg-white/[0.04]')}
                  >
                    <GitBranch className="h-3 w-3 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">Main workspace</span>
                  </button>

                  {!repo?.available && (
                    <p className="px-2 py-1.5 text-[10px] leading-relaxed text-slate-600">{repo?.reason ?? 'Worktrees need a Git repository.'}</p>
                  )}

                  {worktrees.map(record => {
                    const run = runs.find(item => item.worktreeId === record.id);
                    const dot = runDot(run);
                    const isActive = activeTabId === record.id;
                    return (
                      <div
                        key={record.id}
                        className={'group flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition ' + (isActive ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]')}
                      >
                        <button type="button" onClick={() => onSelect(record.id)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot.color}`} title={dot.label} />
                          <span className="min-w-0 flex-1 truncate text-[11px] text-slate-300">{record.title}</span>
                        </button>
                        {run?.status === 'running' && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-sky-300" />}
                        {record.status.dirtyCount > 0 && (
                          <span className="shrink-0 text-[9px] text-amber-300">{record.status.dirtyCount}</span>
                        )}
                      </div>
                    );
                  })}

                  {repo?.available && !worktrees.length && (
                    <p className="px-2 py-1.5 text-[10px] text-slate-600">No worktrees yet — create one from the tab bar.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {!visibleProjects.length && <p className="px-2 py-3 text-[11px] text-slate-600">No project matches “{filter}”.</p>}
      </div>

      <div className="flex shrink-0 items-center gap-1 border-t border-white/[0.07] p-2">
        <button type="button" className="rounded-lg p-1.5 text-slate-600 hover:bg-white/[0.06] hover:text-slate-300" title="Settings"><Settings className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={onNewProject} className="ml-auto rounded-lg p-1.5 text-slate-600 hover:bg-white/[0.06] hover:text-slate-300" title="Add project"><Plus className="h-3.5 w-3.5" /></button>
      </div>
    </aside>
  );
}