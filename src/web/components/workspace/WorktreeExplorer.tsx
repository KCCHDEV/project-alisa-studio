import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  File,
  FileCode2,
  Folder,
  FolderOpen,
  GitBranch,
  Loader2,
  MoreHorizontal,
  RefreshCcw,
  Search,
} from 'lucide-react';
import { API_BASE } from '../WorktreeTile.tsx';

type TreeNode = { name: string; path: string; type: 'file' | 'directory'; size?: number; children?: TreeNode[] };

interface WorktreeExplorerProps {
  worktreeId?: string;
  rootLabel: string;
  rootPath: string;
  branch: string;
  changedCount: number;
  onOpenWorktree: () => void;
}

/** Git porcelain codes reduced to the single letter badge the tree shows. */
function badgeFor(status: string | undefined): { text: string; className: string } | null {
  if (!status) return null;
  if (status.includes('?')) return { text: 'U', className: 'text-emerald-300' };
  if (status[0] === 'M') return { text: 'M', className: 'text-amber-300' };
  if (status[0] === 'A') return { text: 'A', className: 'text-emerald-300' };
  if (status[0] === 'D') return { text: 'D', className: 'text-rose-300' };
  if (status[0] === 'R' || status[0] === 'C') return { text: 'R', className: 'text-violet-300' };
  return null;
}

function iconFor(node: TreeNode) {
  if (node.type === 'directory') return Folder;
  return /\.(ts|tsx|js|jsx|rs|json|css|html|md|yml|yaml|toml)$/i.test(node.name) ? FileCode2 : File;
}

/**
 * Right-hand file explorer scoped to the active tab's checkout, with git status
 * badges per file so changes are visible without leaving the agent view.
 */
export function WorktreeExplorer(props: WorktreeExplorerProps) {
  const { worktreeId, rootLabel, rootPath, branch, changedCount } = props;
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [mode, setMode] = useState<'names' | 'contents'>('names');
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['src', 'docs', 'tests']));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = worktreeId ? `?worktreeId=${encodeURIComponent(worktreeId)}` : '';
      const response = await fetch(`${API_BASE}/api/files/tree${query}`, { headers: { Origin: window.location.origin } });
      const payload = await response.json() as any;
      if (!response.ok) throw new Error(payload?.error || 'Unable to load files');
      setTree(payload.files ?? []);
      setStatuses(payload.statuses ?? {});
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load files');
    } finally {
      setLoading(false);
    }
  }, [worktreeId]);

  useEffect(() => { void load(); }, [load]);

  const matches = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return null;
    const found = new Set<string>();
    const walk = (nodes: TreeNode[], parents: string[]) => {
      for (const node of nodes) {
        const nextParents = [...parents, node.name];
        if (node.name.toLowerCase().includes(query)) {
          for (const parent of nextParents) found.add(parent);
        }
        if (node.children?.length) walk(node.children, nextParents);
      }
    };
    walk(tree, []);
    return found;
  }, [filter, tree]);

  const toggle = (path: string) => {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const renderNodes = (nodes: TreeNode[], depth = 0): React.ReactNode => nodes.map(node => {
    const isOpen = expanded.has(node.name) || (matches ? matches.has(node.name) : false);
    const Icon = iconFor(node);
    const badge = badgeFor(statuses[node.path.split('\\').join('/')]);
    const hidden = matches ? !matches.has(node.name) : false;
    if (hidden) return null;
    return (
      <div key={node.path}>
        <button
          type="button"
          onClick={() => node.type === 'directory' && toggle(node.name)}
          className="flex w-full items-center gap-1 rounded px-1 py-[3px] text-left text-[11px] text-slate-300 hover:bg-white/[0.05]"
          style={{ paddingLeft: `${depth * 10 + 4}px` }}
          title={node.path}
        >
          {node.type === 'directory'
            ? <ChevronRight className={'h-3 w-3 shrink-0 text-slate-600 transition-transform ' + (isOpen ? 'rotate-90' : '')} />
            : <span className="w-3 shrink-0" />}
          {node.type === 'directory' && isOpen
            ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-sky-300" />
            : <Icon className="h-3.5 w-3.5 shrink-0 text-slate-500" />}
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          {badge && <span className={`shrink-0 text-[10px] font-semibold ${badge.className}`}>{badge.text}</span>}
        </button>
        {node.type === 'directory' && node.children?.length ? (isOpen ? renderNodes(node.children, depth + 1) : null) : null}
      </div>
    );
  });

  return (
    <aside className="flex w-[300px] shrink-0 flex-col overflow-hidden border-l border-white/[0.08] bg-[#11151d]">
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-white/[0.07] px-3">
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-200" title={rootPath}>{rootLabel}</span>
        {changedCount > 0 && <span className="shrink-0 rounded-full bg-amber-300/15 px-1.5 py-0.5 text-[9px] text-amber-200">{changedCount}</span>}
        <button type="button" onClick={() => void load()} className="shrink-0 rounded p-1 text-slate-600 hover:bg-white/[0.06] hover:text-slate-300" title="Refresh">
          <RefreshCcw className={'h-3.5 w-3.5 ' + (loading ? 'animate-spin' : '')} />
        </button>
        <button type="button" className="shrink-0 rounded p-1 text-slate-600 hover:bg-white/[0.06] hover:text-slate-300" title="More"><MoreHorizontal className="h-3.5 w-3.5" /></button>
      </div>

      <div className="p-2">
        <label className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-black/30 px-2.5 py-1.5 text-xs text-slate-500 focus-within:border-white/20">
          <Search className="h-3.5 w-3.5 shrink-0" />
          <input
            value={filter}
            onChange={event => setFilter(event.target.value)}
            placeholder="Find files"
            className="min-w-0 flex-1 bg-transparent text-xs text-slate-200 outline-none placeholder:text-slate-600"
          />
        </label>
        <div className="mt-1.5 flex overflow-hidden rounded-lg border border-white/[0.08] text-[10px]">
          {(['names', 'contents'] as const).map(value => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={'flex-1 py-1 transition ' + (mode === value ? 'bg-white/[0.08] text-white' : 'text-slate-500 hover:text-slate-300')}
            >
              {value === 'names' ? 'Names' : 'Contents'}
            </button>
          ))}
        </div>
      </div>

      <div className="tab-scroll min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {error && <p className="px-2 py-2 text-[10px] text-rose-300">{error}</p>}
        {!error && !tree.length && !loading && <p className="px-2 py-2 text-[10px] text-slate-600">No files to show.</p>}
        {loading && !tree.length && (
          <p className="flex items-center gap-1.5 px-2 py-2 text-[10px] text-slate-600"><Loader2 className="h-3 w-3 animate-spin" /> Loading files</p>
        )}
        {tree.length > 0 && renderNodes(tree)}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 border-t border-white/[0.07] px-3 py-1.5 text-[10px] text-slate-600">
        <GitBranch className="h-3 w-3 shrink-0" />
        <span className="min-w-0 truncate">{branch || 'no branch'}</span>
      </div>
    </aside>
  );
}