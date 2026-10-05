import { useState } from 'react';
import { Loader2, Pin, Plus, X } from 'lucide-react';
import type { RunSnapshot, WorktreeRecord } from '../../orchestrator-types';

export interface AgentTab {
  id: string;
  kind: 'main' | 'worktree';
  title: string;
  record?: WorktreeRecord;
  run?: RunSnapshot;
}

interface AgentTabBarProps {
  tabs: AgentTab[];
  activeTabId: string;
  onSelect: (tabId: string) => void;
  newTitle: string;
  onNewTitleChange: (value: string) => void;
  onCreate: () => void;
  creating: boolean;
  capacity: number;
  activeRuns: number;
}

function tabTone(run?: RunSnapshot): string {
  if (!run) return 'bg-slate-600';
  if (run.status === 'running' || run.status === 'queued') return 'bg-sky-400';
  if (run.status === 'done') return 'bg-emerald-400';
  if (run.status === 'error') return 'bg-rose-400';
  return 'bg-amber-400';
}

/**
 * One tab per agent, so every parallel agent is a
 * first-class tab rather than a card in a grid.
 */
export function AgentTabBar(props: AgentTabBarProps) {
  const { tabs, activeTabId, onSelect, newTitle, onNewTitleChange, onCreate, creating, capacity, activeRuns } = props;
  const [composing, setComposing] = useState(false);
  const slotsFull = activeRuns >= capacity;

  return (
    <div className="tab-scroll flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-white/[0.08] bg-[#0f131b] px-2">
      {tabs.map(tab => {
        const isActive = tab.id === activeTabId;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelect(tab.id)}
            className={'group flex shrink-0 items-center gap-1.5 rounded-t-lg border-b-2 px-2.5 py-1.5 text-[11px] transition ' + (isActive
              ? 'border-sky-300/60 bg-white/[0.06] text-white'
              : 'border-transparent text-slate-500 hover:bg-white/[0.03] hover:text-slate-300')}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tabTone(tab.run)}`} />
            <Pin className="h-2.5 w-2.5 shrink-0 text-slate-600" />
            <span className="max-w-[190px] truncate">{tab.title}</span>
            {tab.record && tab.record.status.dirtyCount > 0 && (
              <span className="shrink-0 rounded bg-amber-300/15 px-1 text-[9px] text-amber-200">{tab.record.status.dirtyCount}</span>
            )}
          </button>
        );
      })}

      {composing ? (
        <div className="flex shrink-0 items-center gap-1 pl-1">
          <input
            autoFocus
            value={newTitle}
            onChange={event => onNewTitleChange(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') { event.preventDefault(); onCreate(); setComposing(false); }
              if (event.key === 'Escape') { setComposing(false); onNewTitleChange(''); }
            }}
            placeholder="New agent / worktree title"
            className="w-52 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-slate-200 outline-none placeholder:text-slate-600 focus:border-sky-300/40"
          />
          <button
            type="button"
            disabled={creating || !newTitle.trim()}
            onClick={() => { onCreate(); setComposing(false); }}
            className="rounded-md bg-sky-300/80 px-2 py-1 text-[10px] font-semibold text-[#171923] disabled:opacity-40"
          >
            {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Create'}
          </button>
          <button type="button" onClick={() => { setComposing(false); onNewTitleChange(''); }} className="rounded-md p-1 text-slate-600 hover:text-slate-300">
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setComposing(true)}
          disabled={slotsFull}
          title={slotsFull ? `All ${capacity} agent slots are busy` : 'Create a new agent worktree'}
          className="shrink-0 rounded-md p-1.5 text-slate-600 hover:bg-white/[0.06] hover:text-slate-300 disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}