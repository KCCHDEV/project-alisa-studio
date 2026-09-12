import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowUpRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  Code2,
  File,
  FileCode2,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  Gauge,
  GitBranch,
  Globe,
  Loader2,
  MessageSquare,
  PanelLeft,
  PanelRight,
  Pencil,
  Pin,
  Play,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  Target,
  Undo2,
  Users,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import type { AgentMode, AgentStatus, ContextUsage, Goal, GoalStatus, Message, PlanItem, SwarmAgent } from '../core/types.ts';
import { AlisaAvatar } from './components/AlisaAvatar';
import { AlisaLogo } from './components/AlisaLogo';
import { MarkdownRenderer } from './components/MarkdownRenderer';
import { DiffViewerModal } from './components/DiffViewerModal';
import { ChibiSwarmPanel } from './components/ChibiSwarmPanel';
import { ConfettiCanvas } from './components/ConfettiCanvas';
import { LiveWebPreview } from './components/LiveWebPreview';
import { TemplateShowcaseModal } from './components/TemplateShowcaseModal';
import {
  playChime,
  isSoundEnabled,
  setSoundEnabled,
  getSoundVolume,
  setSoundVolume,
  toggleSound,
} from './audio/sound-fx';

// The frontend is an internal Tauri webview. It is never a standalone browser client.
const API_BASE = 'http://127.0.0.1:3101';

type FileNode = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: FileNode[];
};

type ProviderProfile = {
  id: string;
  name: string;
  baseURL: string;
  model: string;
  isPreset?: boolean;
  hasKey?: boolean;
  apiKeyMasked?: string;
};

type ProviderModelsResponse = {
  providerId: string;
  providerName: string;
  models: string[];
  modelDetails?: Array<{ id: string; contextWindow?: number }>;
  cached?: boolean;
  fetchedAt?: number;
};

type PublicConfig = {
  workspaceDir: string;
  recentWorkspaces: string[];
  activeProviderId: string;
  baseURL: string;
  model: string;
  providers: ProviderProfile[];
  hasKey?: boolean;
  apiKeyMasked?: string;
  yoloMode?: boolean;
};

type CapabilityStatusView = {
  mcp?: {
    skillInstalled: boolean;
    availability: 'ready' | 'manual' | 'unavailable';
    configuredFiles?: Array<{ path: string; serverCount: number }>;
    serverCount?: number;
  };
  computerUse?: {
    skillInstalled: boolean;
    availability: 'ready' | 'manual' | 'unavailable';
    inputBridges?: string[];
    platform?: string;
  };
};

type SessionSummary = {
  id: string;
  title: string;
  workspace: string;
  createdAt: number;
  updatedAt: number;
  messageCount?: number;
  pinned?: boolean;
  archived?: boolean;
  customTitle?: boolean;
  mode?: AgentMode;
  model?: string;
  swarm?: boolean;
  goal?: Goal;
  plan?: PlanItem[];
  lastRun?: {
    status: AgentStatus;
    detail?: string;
    durationMs: number;
    completedAt: number;
  };
};

type ToolRun = {
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  result?: string;
  error?: string;
  status: 'running' | 'success' | 'error';
  agentRole?: string;
};

type ActivityEntry = {
  id: string;
  label: string;
  detail?: string;
  kind: 'status' | 'tool' | 'system' | 'error';
  timestamp: number;
};

type TerminalSessionView = {
  id: string;
  kind: 'local' | 'ssh';
  cwd?: string;
  host?: string;
  username?: string;
  port?: number;
  startedAt: number;
  status: 'connecting' | 'connected' | 'exited' | 'error';
  output: string;
};

type GitState = {
  branch: string;
  status: string;
  diff: string;
};

type ApprovalRequest = {
  resolveId: string;
  action: string;
  details: Record<string, unknown>;
};

type InspectorTab = 'plan' | 'goal' | 'agents' | 'context' | 'changes' | 'activity';
type SidebarTab = 'chats' | 'files';

type CommandItem = {
  id: string;
  label: string;
  detail: string;
  run: () => void;
};

const SLASH_COMMANDS = [
  { id: 'help', label: '/help', detail: 'Show available commands' },
  { id: 'models', label: '/models', detail: 'Change current model' },
  { id: 'agents', label: '/agents', detail: 'Cycle agent mode' },
  { id: 'swarm', label: '/swarm', detail: 'Toggle the multi-agent coding swarm' },
  { id: 'yolo', label: '/yolo', detail: 'Toggle no-confirmation execution mode' },
  { id: 'skills', label: '/skills', detail: 'Show bundled MCP and Computer Use skills' },
  { id: 'character', label: '/character', detail: 'Show or hide the Yurachi companion' },
  { id: 'goal', label: '/goal', detail: 'Open the persistent session goal' },
  { id: 'files', label: '/files', detail: 'Open the project file system' },
  { id: 'terminal', label: '/terminal', detail: 'Open the integrated local / SSH terminal' },
  { id: 'ssh', label: '/ssh', detail: 'Open the remote SSH terminal connector' },
  { id: 'sessions', label: '/sessions', detail: 'Open sessions' },
  { id: 'new', label: '/new', detail: 'Start a new session' },
  { id: 'clear', label: '/clear', detail: 'Clear the local transcript' },
  { id: 'compact', label: '/compact', detail: 'Ask the agent to compact context' },
  { id: 'diff', label: '/diff', detail: 'Review side-by-side visual diffs of changes' },
  { id: 'preview', label: '/preview', detail: 'Toggle live in-app localhost web preview' },
  { id: 'templates', label: '/templates', detail: 'Browse 1-click project starter templates' },
  { id: 'theme', label: '/theme', detail: 'Open appearance settings' },
  { id: 'settings', label: '/settings', detail: 'Open provider settings' },
] as const;

const MODES: Array<{ id: AgentMode; label: string; description: string }> = [
  { id: 'auto', label: 'Auto', description: 'ดำเนินงานและตรวจสอบให้ครบ' },
  { id: 'code', label: 'Code', description: 'แก้ไฟล์และรันคำสั่งเมื่ออนุมัติ' },
  { id: 'plan', label: 'Plan', description: 'สำรวจและสร้างแผนโดยไม่แก้ไฟล์' },
  { id: 'ask', label: 'Ask', description: 'ตอบและวิเคราะห์อย่างเดียว' },
];

const DEFAULT_SKILLS = ['openclaude-code-standards', 'systematic-debugging', 'mcp', 'computer-use'];

type CompanionPose = 'coding' | 'thinking' | 'terminal' | 'review' | 'success';

const COMPANION_POSES: Record<CompanionPose, { src: string; label: string }> = {
  coding: { src: './yurachi-chibi-coding.webp', label: 'coding' },
  thinking: { src: './yurachi-chibi-thinking.webp', label: 'thinking' },
  terminal: { src: './yurachi-chibi-terminal.webp', label: 'running terminal' },
  review: { src: './yurachi-chibi-review.webp', label: 'reviewing changes' },
  success: { src: './yurachi-chibi-success.webp', label: 'task complete' },
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(API_BASE + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : 'Request failed (' + response.status + ')');
  }
  return data as T;
}

function websocketUrl() {
  return 'ws://127.0.0.1:3101/ws';
}

function formatRelativeTime(timestamp?: number) {
  if (!timestamp) return '';
  const delta = Math.max(0, Date.now() - timestamp);
  if (delta < 60_000) return 'now';
  if (delta < 3_600_000) return Math.floor(delta / 60_000) + 'm';
  if (delta < 86_400_000) return Math.floor(delta / 3_600_000) + 'h';
  if (delta < 604_800_000) return Math.floor(delta / 86_400_000) + 'd';
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatDuration(durationMs?: number) {
  if (!Number.isFinite(durationMs) || !durationMs || durationMs < 1000) return durationMs ? `${Math.max(1, Math.round(durationMs))}ms` : '';
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${String(remainingSeconds).padStart(2, '0')}s`;
}

function formatTokenCount(tokens?: number) {
  if (!Number.isFinite(tokens)) return '0';
  const value = Math.max(0, Number(tokens));
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'm';
  if (value >= 1_000) return Math.round(value / 1_000) + 'k';
  return String(Math.round(value));
}

function estimateContextUsage(messages: Message[], maxTokens: number): ContextUsage {
  const characters = messages.reduce((total, message) => total + (message.content?.length || 0) + (message.tool_calls ? JSON.stringify(message.tool_calls).length : 0) + 24, 0);
  const usedTokens = Math.ceil(characters / 4);
  return { usedTokens, maxTokens, percent: Math.min(100, Math.round((usedTokens / Math.max(1, maxTokens)) * 100)) };
}

function shortPath(value: string, max = 42) {
  if (!value) return 'No project selected';
  if (value.length <= max) return value;
  return '…' + value.slice(-max + 1);
}

function basename(value: string) {
  return value.split(/[\\/]/).filter(Boolean).pop() || value;
}

function flattenFiles(nodes: FileNode[]): FileNode[] {
  return nodes.flatMap(node => [node, ...(node.children ? flattenFiles(node.children) : [])]);
}

function fileIcon(name: string, directory = false) {
  if (directory) return <Folder className="h-3.5 w-3.5 text-sky-300" />;
  const lower = name.toLowerCase();
  if (/\.(ts|tsx|js|jsx|py|go|rs|java|c|cpp|h|css|html|vue|svelte)$/.test(lower)) {
    return <FileCode2 className="h-3.5 w-3.5 text-violet-300" />;
  }
  return <File className="h-3.5 w-3.5 text-slate-400" />;
}

function statusLabel(status: AgentStatus, connected: boolean) {
  if (!connected) return 'Backend offline';
  if (status === 'thinking') return 'Thinking';
  if (status === 'acting') return 'Working';
  if (status === 'waiting_approval') return 'Waiting for approval';
  if (status === 'self_correcting') return 'Self-checking';
  if (status === 'done') return 'Completed';
  if (status === 'error') return 'Needs attention';
  return 'Ready';
}

function runLabel(status: AgentStatus) {
  if (status === 'error') return 'Failed';
  if (status === 'idle') return 'Cancelled';
  return 'Completed';
}

function statusColor(status: AgentStatus, connected: boolean) {
  if (!connected || status === 'error') return 'bg-rose-400';
  if (status === 'thinking' || status === 'acting' || status === 'waiting_approval' || status === 'self_correcting') return 'bg-amber-300';
  if (status === 'done') return 'bg-emerald-300';
  return 'bg-sky-300';
}

function toolLabel(tool: ToolRun) {
  if (tool.toolName === 'read_file') return 'Read ' + String(tool.args.path || 'file');
  if (tool.toolName === 'write_file') return 'Write ' + String(tool.args.path || 'file');
  if (tool.toolName === 'patch_file') return 'Patch ' + String(tool.args.path || 'file');
  if (tool.toolName === 'list_directory') return 'List ' + String(tool.args.path || '.');
  if (tool.toolName === 'search_files') return 'Search workspace';
  if (tool.toolName === 'update_plan') return 'Update plan';
  if (tool.toolName === 'update_goal') return 'Update goal';
  if (tool.toolName === 'manage_skill') return 'Manage skill';
  if (tool.toolName === 'terminal') return 'Run terminal command';
  return tool.toolName;
}

function visibleMessages(messages: Message[]) {
  return messages.filter(message => message.role === 'user' || message.role === 'assistant');
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function terminalTextForDisplay(value: string) {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001bP[\s\S]*?\u001b\\/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[()][0-2A-Z]/g, '')
    .replace(/\u001b./g, '')
    .replace(/\r/g, '');
}

function IconButton(props: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      className={'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-slate-400 transition hover:border-white/10 hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 ' + (props.active ? 'bg-white/[0.08] text-white ' : '') + (props.className || '')}
    >
      {props.children}
    </button>
  );
}

type SshDraft = { host: string; username: string; port: string; identityFile: string; remoteCwd: string };

function TerminalPanel(props: {
  connected: boolean;
  workspaceDir: string;
  preferredKind: 'local' | 'ssh';
  sessions: TerminalSessionView[];
  activeSessionId: string;
  error: string;
  onStart: (kind: 'local' | 'ssh', ssh: SshDraft) => void;
  onSelect: (sessionId: string) => void;
  onStop: (sessionId: string) => void;
  onClear: (sessionId: string) => void;
  onSend: (sessionId: string, input: string) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<'local' | 'ssh'>('local');
  const [ssh, setSsh] = useState<SshDraft>({ host: '', username: '', port: '22', identityFile: '', remoteCwd: '' });
  const [input, setInput] = useState('');
  const outputRef = useRef<HTMLPreElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const active = props.sessions.find(session => session.id === props.activeSessionId);

  useEffect(() => setKind(props.preferredKind), [props.preferredKind]);
  useEffect(() => setInput(''), [props.activeSessionId]);

  // Auto-start a local terminal session if drawer opens with zero sessions
  useEffect(() => {
    if (props.connected && props.sessions.length === 0) {
      props.onStart('local', ssh);
    }
  }, [props.connected, props.sessions.length]);

  // Auto-scroll output on updates
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [active?.output]);

  // Focus input when session is ready
  useEffect(() => {
    if (active && active.status !== 'exited' && active.status !== 'error') {
      inputRef.current?.focus();
    }
  }, [active?.id, active?.status]);

  const send = () => {
    if (!active || !input.trim()) return;
    props.onSend(active.id, input + '\n');
    setInput('');
  };

  return (
    <section className="terminal-drawer alisa-surface-enter absolute inset-x-3 bottom-3 z-[35] flex h-[min(500px,65vh)] min-h-[300px] flex-col overflow-hidden border border-[#292929] bg-[#050505]" aria-label="Integrated terminal">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[#1a1a1a] px-3 text-[11px]">
        <Terminal className="h-3.5 w-3.5 text-[#8da4c6]" />
        <span className="text-[#f2f2f2] font-medium">Terminal</span>
        <span className="text-[#555]">local shell + SSH</span>
        <div className="ml-auto flex items-center gap-1">
          {props.sessions.map(session => (
            <button key={session.id} type="button" onClick={() => props.onSelect(session.id)} className={'max-w-[180px] truncate px-2 py-1 font-mono text-[10px] ' + (session.id === props.activeSessionId ? 'bg-[#151515] text-[#f2f2f2]' : 'text-[#666] hover:bg-[#101010] hover:text-[#aaa]')}>
              {session.kind === 'ssh' ? `${session.username}@${session.host}` : 'local'}
            </button>
          ))}
          <IconButton label="Close terminal" onClick={props.onClose}><X className="h-3.5 w-3.5" /></IconButton>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="w-[235px] shrink-0 overflow-y-auto border-r border-[#1a1a1a] p-3 max-sm:w-[190px]">
          <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-[#555]">New connection</div>
          <div className="mb-3 flex border-b border-[#1a1a1a]">
            {(['local', 'ssh'] as const).map(option => <button key={option} type="button" onClick={() => setKind(option)} className={'flex-1 border-b px-2 py-1.5 text-[10px] uppercase tracking-[0.12em] ' + (kind === option ? 'border-[#8da4c6] text-[#f2f2f2]' : 'border-transparent text-[#666] hover:text-[#aaa]')}>{option}</button>)}
          </div>
          {kind === 'local' ? (
            <div className="mb-3 border-l border-[#26344a] pl-2 text-[10px] leading-5 text-[#666]">
              <div className="text-[#999]">Workspace shell</div>
              <div className="truncate" title={props.workspaceDir}>{shortPath(props.workspaceDir, 30)}</div>
            </div>
          ) : (
            <div className="mb-3 space-y-2">
              <input value={ssh.host} onChange={event => setSsh(previous => ({ ...previous, host: event.target.value }))} placeholder="host or IP" className="terminal-field" autoComplete="off" />
              <div className="flex gap-2"><input value={ssh.username} onChange={event => setSsh(previous => ({ ...previous, username: event.target.value }))} placeholder="user" className="terminal-field min-w-0 flex-1" autoComplete="off" /><input value={ssh.port} onChange={event => setSsh(previous => ({ ...previous, port: event.target.value }))} placeholder="22" className="terminal-field w-12" inputMode="numeric" /></div>
              <input value={ssh.remoteCwd} onChange={event => setSsh(previous => ({ ...previous, remoteCwd: event.target.value }))} placeholder="remote directory (optional)" className="terminal-field" autoComplete="off" />
              <input value={ssh.identityFile} onChange={event => setSsh(previous => ({ ...previous, identityFile: event.target.value }))} placeholder="identity file (optional)" className="terminal-field" autoComplete="off" />
              <div className="text-[9px] leading-4 text-[#555]">Password and host-key prompts stay inside the terminal. Credentials are not saved.</div>
            </div>
          )}
          <button type="button" onClick={() => props.onStart(kind, ssh)} disabled={!props.connected || (kind === 'ssh' && (!ssh.host.trim() || !ssh.username.trim()))} className="flex w-full items-center justify-center gap-1.5 border border-[#303030] px-2 py-2 text-[10px] text-[#c8d5e8] hover:bg-[#111] disabled:cursor-not-allowed disabled:opacity-40"><Plus className="h-3 w-3" /> Start {kind === 'ssh' ? 'SSH' : 'local shell'}</button>
          {props.error && <div className="mt-3 border-l border-[#9f4f4f] pl-2 text-[10px] leading-5 text-[#d98a8a]">{props.error}</div>}
          <div className="mt-5 border-t border-[#1a1a1a] pt-3">
            <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-[#555]">Sessions · {props.sessions.length}</div>
            <div className="space-y-0.5">
              {props.sessions.map(session => <button key={session.id} type="button" onClick={() => props.onSelect(session.id)} className={'flex w-full items-center gap-2 px-2 py-1.5 text-left text-[10px] ' + (session.id === props.activeSessionId ? 'bg-[#151515] text-[#f2f2f2]' : 'text-[#777] hover:bg-[#101010] hover:text-[#aaa]')}>
                <span className={'terminal-status ' + (session.status === 'connected' ? 'terminal-success' : session.status === 'error' ? 'terminal-error' : session.status === 'connecting' ? 'terminal-running' : 'text-[#555]')}>{session.status === 'connected' ? '●' : session.status === 'error' ? '×' : session.status === 'connecting' ? '◐' : '○'}</span>
                <span className="min-w-0 flex-1 truncate">{session.kind === 'ssh' ? `${session.username}@${session.host}` : 'local shell'}</span>
                <span className="text-[9px] text-[#555]">{session.status}</span>
              </button>)}
              {!props.sessions.length && <div className="px-2 py-2 text-[10px] leading-5 text-[#555]">No terminal sessions yet.</div>}
            </div>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[#1a1a1a] px-3 text-[10px] text-[#666]">
            <span className="text-[#444]">cwd</span><span className="min-w-0 truncate text-[#888]">{active?.cwd || (active ? 'connecting…' : 'select a session')}</span>
            {active && <><span className="text-[#333]">·</span><span className="text-[#555]">{active.kind === 'ssh' ? 'remote' : 'local'}</span><button type="button" onClick={() => props.onClear(active.id)} className="ml-auto text-[#555] hover:text-[#aaa]">clear</button><button type="button" onClick={() => props.onStop(active.id)} disabled={active.status === 'exited'} className="text-[#9b6f6f] hover:text-[#d98a8a] disabled:opacity-30">stop</button></>}
          </div>
          <pre ref={outputRef} className="terminal-drawer-output min-h-0 flex-1 overflow-auto px-3 py-3 font-mono text-[11px] leading-5 text-[#b8b8b8]">{active ? (terminalTextForDisplay(active.output) || (active.status === 'connecting' ? 'Connecting to shell…' : '(no output)')) : 'Starting local shell...'}</pre>

          {active && (active.status === 'exited' || active.status === 'error') && (
            <div className="flex items-center justify-between border-t border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-[11px] text-rose-300">
              <span>Terminal session {active.status === 'error' ? 'encountered an error' : 'exited'}.</span>
              <button
                type="button"
                onClick={() => props.onStart('local', ssh)}
                className="flex items-center gap-1 rounded border border-rose-400/30 bg-rose-500/20 px-2 py-0.5 text-[10px] text-rose-100 hover:bg-rose-500/30 transition"
              >
                <RefreshCcw className="h-2.5 w-2.5" /> Restart Shell
              </button>
            </div>
          )}

          <form onSubmit={event => { event.preventDefault(); send(); }} className="flex shrink-0 items-center gap-2 border-t border-[#1a1a1a] px-3 py-2">
            <span className="text-[#8da4c6] font-mono text-sm font-bold">›</span>
            <input
              ref={inputRef}
              value={input}
              onChange={event => setInput(event.target.value)}
              onKeyDown={event => {
                if (event.ctrlKey && event.key.toLowerCase() === 'c' && active) {
                  event.preventDefault();
                  props.onSend(active.id, '\u0003');
                  setInput('');
                }
              }}
              disabled={!active || active.status === 'exited' || active.status === 'error'}
              placeholder={active ? (active.status === 'exited' ? 'Session exited · click Restart Shell above' : 'type a command · Enter · Ctrl+C to interrupt') : 'Starting shell session…'}
              className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-[#f2f2f2] outline-none placeholder:text-[#444] disabled:cursor-not-allowed"
              autoComplete="off"
            />
            <button type="submit" disabled={!active || !input.trim() || active.status === 'exited' || active.status === 'error'} className="border border-[#303030] px-2.5 py-1 text-[10px] text-[#999] hover:bg-[#111] hover:text-[#f2f2f2] disabled:opacity-30 transition">send</button>
          </form>
        </div>
      </div>
    </section>
  );
}

function PlanList(props: { items: PlanItem[]; compact?: boolean }) {
  if (!props.items.length) {
    return (
      <div className="terminal-empty-line text-xs leading-5 text-slate-600">
        แผนจะปรากฏที่นี่เมื่อเป็นงานหลายขั้นตอน
      </div>
    );
  }
  return (
    <div className="terminal-plan space-y-1">
      {props.items.map(item => {
        const completed = item.status === 'completed';
        const active = item.status === 'in_progress';
        const blocked = item.status === 'blocked';
        return (
          <div key={item.id} className={'flex items-start gap-2 px-1 py-1 text-xs ' + (active ? 'text-slate-100' : blocked ? 'text-rose-300' : 'text-slate-500')}>
            {completed ? <span className="terminal-status terminal-success">✓</span> : active ? <Loader2 className="terminal-status alisa-spinner text-amber-300" /> : blocked ? <span className="terminal-status terminal-error">×</span> : <span className="terminal-status text-slate-700">○</span>}
            <span className={completed ? 'line-through opacity-60' : ''}>{item.title}</span>
          </div>
        );
      })}
    </div>
  );
}

const FileTree = memo(function FileTree(props: {
  nodes: FileNode[];
  onOpen: (path: string) => void;
  query: string;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const matches = (node: FileNode): boolean => {
    if (!props.query.trim()) return true;
    const query = props.query.toLowerCase();
    return node.name.toLowerCase().includes(query) || Boolean(node.children?.some(matches));
  };
  const renderNodes = (nodes: FileNode[], depth = 0): ReactNode[] => nodes
    .filter(matches)
    .sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name))
    .flatMap(node => {
      const isOpen = !collapsed.has(node.path);
      const row = (
        <button
          type="button"
          key={node.path}
          onClick={() => node.type === 'directory' ? setCollapsed(previous => {
            const next = new Set(previous);
            if (next.has(node.path)) next.delete(node.path); else next.add(node.path);
            return next;
          }) : props.onOpen(node.path)}
          className="group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11px] text-slate-400 transition hover:bg-white/[0.06] hover:text-slate-100"
          style={{ paddingLeft: (8 + depth * 14) + 'px' }}
        >
          {node.type === 'directory' ? (isOpen ? <ChevronDown className="h-3 w-3 text-slate-600" /> : <ChevronRight className="h-3 w-3 text-slate-600" />) : <span className="w-3" />}
          {fileIcon(node.name, node.type === 'directory')}
          <span className="truncate">{node.name}</span>
        </button>
      );
      return node.type === 'directory' && isOpen && node.children?.length ? [row, ...renderNodes(node.children, depth + 1)] : [row];
    });
  return <div className="space-y-0.5">{renderNodes(props.nodes)}</div>;
});

const ToolCard = memo(function ToolCard(props: { tool: ToolRun }) {
  const [open, setOpen] = useState(false);
  const tool = props.tool;
  return (
    <div className="tool-event mt-3 text-xs">
      <button type="button" onClick={() => setOpen(value => !value)} className="tool-event-trigger flex w-full items-center gap-2 py-1 text-left text-slate-400 hover:text-slate-200">
        {tool.status === 'running' ? <span className="terminal-status terminal-running">●</span> : tool.status === 'success' ? <span className="terminal-status terminal-success">✓</span> : <span className="terminal-status terminal-error">×</span>}
        <span className="min-w-0 flex-1 truncate">{toolLabel(tool)}</span>
        {tool.agentRole && <span className="shrink-0 text-[9px] uppercase tracking-[0.12em] text-slate-700">{tool.agentRole}</span>}
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>
      {open && (
        <div className="tool-output border-l border-white/[0.12] pl-4">
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-5 text-slate-500">{tool.error || tool.result || JSON.stringify(tool.args, null, 2)}</pre>
        </div>
      )}
    </div>
  );
});

const MessageBubble = memo(function MessageBubble(props: {
  message: Message;
  tools: ToolRun[];
  messages?: Message[];
  isStreaming?: boolean;
  onRetryTask?: () => void;
  onOpenModelMenu?: () => void;
}) {
  const isUser = props.message.role === 'user';
  const isError = Boolean(props.message.metadata?.error);
  const relatedTools = (props.message.tool_calls || []).map(call => {
    const active = props.tools.find(tool => tool.toolCallId === call.id);
    if (active) return active;
    const result = props.messages?.find(item => item.role === 'tool' && item.tool_call_id === call.id);
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* Keep malformed arguments collapsed. */ }
    return { toolName: call.function.name, toolCallId: call.id, args, result: result?.content, error: result?.metadata?.error ? result.content : undefined, status: result?.metadata?.error ? 'error' : 'success' } as ToolRun;
  });
  return (
    <div className={'terminal-message ' + (isUser ? 'terminal-user' : isError ? 'terminal-error-message' : 'terminal-assistant')}>
      <div className="terminal-message-head flex items-center gap-2 text-[10px] uppercase tracking-[0.14em]">
        <span className="terminal-message-mark">{isUser ? '┃' : isError ? '!' : props.isStreaming ? '●' : ' '}</span>
        <span>{isUser ? 'You' : 'Alisa'}</span>
        {!isUser && props.message.metadata?.model && <span className="max-w-[260px] truncate normal-case tracking-normal text-slate-600" title={props.message.metadata.model}>via {props.message.metadata.model}</span>}
        <span className="text-slate-700">{formatRelativeTime(props.message.timestamp)}</span>
      </div>
      <div className="terminal-message-body text-sm leading-6">
        {isUser ? (
          <div className="whitespace-pre-wrap">{props.message.content}</div>
        ) : isError ? (
          <div className="my-2 rounded-xl border border-rose-500/30 bg-rose-950/20 p-4 text-xs text-rose-200 shadow-lg">
            <div className="flex items-center gap-2 font-medium text-rose-300">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
              <span>เกิดข้อผิดพลาดในการเชื่อมต่อโมเดล / OmniRoute Gateway</span>
            </div>
            <div className="mt-2 font-mono text-[11px] leading-5 text-slate-300 break-words">
              {props.message.content.replace(/^\[Error\]\s*/, '')}
            </div>
            <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
              {props.onRetryTask && (
                <button
                  type="button"
                  onClick={props.onRetryTask}
                  className="flex items-center gap-1.5 rounded-lg border border-rose-400/40 bg-rose-500/15 px-3 py-1.5 text-xs font-medium text-rose-200 transition hover:bg-rose-500/25 active:scale-95"
                >
                  <RefreshCcw className="h-3.5 w-3.5" />
                  ลองใหม่อีกครั้ง (Retry)
                </button>
              )}
              {props.onOpenModelMenu && (
                <button
                  type="button"
                  onClick={props.onOpenModelMenu}
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/10"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  เปลี่ยน Model / Route
                </button>
              )}
            </div>
          </div>
        ) : (
          <MarkdownRenderer content={props.message.content || (relatedTools.length ? '' : '…')} />
        )}
        {relatedTools.map(tool => <ToolCard key={tool.toolCallId} tool={tool} />)}
      </div>
    </div>
  );
});

type EditorTokenKind = 'plain' | 'comment' | 'string' | 'keyword' | 'number' | 'function' | 'type' | 'constant' | 'property' | 'tag' | 'attribute' | 'operator';
type EditorToken = { text: string; kind: EditorTokenKind };
type EditorLexerState = { blockComment: boolean; inTag: boolean; tagNameSeen: boolean };

const EDITOR_KEYWORDS = new Set([
  'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'delete', 'do', 'else', 'export',
  'extends', 'finally', 'for', 'from', 'function', 'get', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'keyof',
  'let', 'new', 'of', 'private', 'protected', 'public', 'return', 'set', 'static', 'super', 'switch', 'throw', 'try', 'type',
  'typeof', 'var', 'void', 'while', 'with', 'yield', 'def', 'elif', 'except', 'False', 'finally', 'from', 'global', 'lambda',
  'None', 'nonlocal', 'pass', 'raise', 'True', 'and', 'as', 'assert', 'async', 'await', 'class', 'del', 'is', 'not', 'or',
  'print', 'select', 'where', 'insert', 'update', 'values', 'return',
]);
const EDITOR_TYPES = new Set([
  'Array', 'Boolean', 'Date', 'Error', 'Map', 'Never', 'Number', 'Object', 'Promise', 'Record', 'RegExp', 'Set', 'String', 'Symbol',
  'bigint', 'boolean', 'enum', 'float', 'int', 'number', 'string', 'unknown', 'undefined', 'void', 'any', 'never',
]);
const EDITOR_CONSTANTS = new Set(['false', 'null', 'true', 'undefined', 'NaN', 'Infinity', 'None', 'True', 'False']);

function editorLanguage(filePath: string) {
  const extension = (filePath.split('.').pop() || '').toLowerCase();
  if (extension === 'tsx' || extension === 'jsx') return 'tsx';
  if (extension === 'ts' || extension === 'mts' || extension === 'cts') return 'ts';
  if (extension === 'js' || extension === 'mjs' || extension === 'cjs') return 'js';
  if (extension === 'py') return 'py';
  if (extension === 'html' || extension === 'htm' || extension === 'xml' || extension === 'svg' || extension === 'vue') return 'html';
  if (extension === 'css' || extension === 'scss' || extension === 'less') return 'css';
  if (extension === 'json') return 'json';
  if (extension === 'yaml' || extension === 'yml') return 'yaml';
  if (extension === 'sh' || extension === 'bash' || extension === 'zsh') return 'shell';
  return extension || 'text';
}

function editorTokenizeLine(line: string, language: string, state: EditorLexerState): EditorToken[] {
  const tokens: EditorToken[] = [];
  const supportsMarkup = language === 'html' || language === 'tsx';
  const hashComments = language === 'py' || language === 'shell' || language === 'yaml';
  const add = (text: string, kind: EditorTokenKind = 'plain') => { if (text) tokens.push({ text, kind }); };
  const nextNonSpace = (index: number) => line.slice(index).match(/\S/)?.[0] || '';
  const previousNonSpace = (index: number) => line.slice(0, index).match(/\S(?=\s*$)/)?.[0] || '';

  let index = 0;
  while (index < line.length) {
    if (state.blockComment) {
      const end = line.indexOf('*/', index);
      if (end < 0) { add(line.slice(index), 'comment'); return tokens; }
      add(line.slice(index, end + 2), 'comment');
      state.blockComment = false;
      index = end + 2;
      continue;
    }

    if (line.startsWith('//', index) || (hashComments && line[index] === '#') || line.startsWith('<!--', index)) {
      add(line.slice(index), 'comment');
      return tokens;
    }
    if (line.startsWith('/*', index)) {
      const end = line.indexOf('*/', index + 2);
      if (end < 0) { add(line.slice(index), 'comment'); state.blockComment = true; return tokens; }
      add(line.slice(index, end + 2), 'comment');
      index = end + 2;
      continue;
    }

    const character = line[index];
    if (character === '"' || character === "'" || character === '`') {
      let end = index + 1;
      while (end < line.length) {
        if (line[end] === '\\') { end += 2; continue; }
        if (line[end] === character) { end += 1; break; }
        end += 1;
      }
      add(line.slice(index, end), 'string');
      index = end;
      continue;
    }

    if (supportsMarkup && character === '<' && /[A-Za-z/]/.test(line[index + 1] || '')) {
      const close = line[index + 1] === '/' ? '</' : '<';
      add(close, 'tag');
      state.inTag = true;
      state.tagNameSeen = false;
      index += close.length;
      continue;
    }
    if (state.inTag && character === '>') {
      add('>', 'tag');
      state.inTag = false;
      state.tagNameSeen = false;
      index += 1;
      continue;
    }
    if (/\d/.test(character) && (index === 0 || !/[A-Za-z_$]/.test(line[index - 1]))) {
      const number = line.slice(index).match(/^(?:0x[\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?n?)/i)?.[0] || character;
      add(number, 'number');
      index += number.length;
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      const word = line.slice(index).match(/^[A-Za-z_$][\w$-]*/)?.[0] || character;
      const after = nextNonSpace(index + word.length);
      const before = previousNonSpace(index);
      let kind: EditorTokenKind = 'plain';
      if (state.inTag && !state.tagNameSeen) {
        kind = 'tag';
        state.tagNameSeen = true;
      } else if (state.inTag && after === '=') {
        kind = 'attribute';
      } else if (EDITOR_CONSTANTS.has(word)) {
        kind = 'constant';
      } else if (EDITOR_KEYWORDS.has(word)) {
        kind = 'keyword';
      } else if (EDITOR_TYPES.has(word)) {
        kind = 'type';
      } else if (after === '(') {
        kind = 'function';
      } else if (before === '.' || after === ':') {
        kind = 'property';
      }
      add(word, kind);
      index += word.length;
      continue;
    }

    const operator = line.slice(index).match(/^(?:===|!==|=>|==|!=|<=|>=|&&|\|\||\+\+|--|\?\?|\?\.|\+=|-=|\*=|\/=|\*\*|[{}()[\].,;:+\-*\/%=<>!?|&])/i)?.[0];
    if (operator) {
      add(operator, 'operator');
      index += operator.length;
      continue;
    }
    const plain = line.slice(index).match(/^\s+|^./)?.[0] || character;
    add(plain);
    index += plain.length;
  }
  return tokens;
}

function highlightedEditorLines(source: string, filePath: string) {
  const state: EditorLexerState = { blockComment: false, inTag: false, tagNameSeen: false };
  const language = editorLanguage(filePath);
  return source.split('\n').map(line => editorTokenizeLine(line, language, state));
}

function VscodeEditor(props: {
  selectedFile: string;
  openFiles: string[];
  draft: string;
  original: string;
  nodes: FileNode[];
  saving: boolean;
  error: string;
  onOpen: (path: string) => void;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const lineRef = useRef<HTMLDivElement | null>(null);
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const scrollFrameRef = useRef<number | null>(null);
  const lineCount = Math.max(1, props.draft.split('\n').length);
  const language = editorLanguage(props.selectedFile).toUpperCase();
  const highlightedLines = useMemo(() => highlightedEditorLines(props.draft, props.selectedFile), [props.draft, props.selectedFile]);

  const updateCursor = (target: HTMLTextAreaElement) => {
    const before = target.value.slice(0, target.selectionStart || 0);
    const lines = before.split('\n');
    setCursor({ line: lines.length, column: (lines[lines.length - 1]?.length || 0) + 1 });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      props.onSave();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const target = event.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      props.onChange(props.draft.slice(0, start) + '  ' + props.draft.slice(end));
      window.requestAnimationFrame(() => {
        target.selectionStart = start + 2;
        target.selectionEnd = start + 2;
      });
    }
  };

  const handleScroll = () => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const top = editorRef.current?.scrollTop || 0;
      const left = editorRef.current?.scrollLeft || 0;
      setScroll(previous => previous.top === top && previous.left === left ? previous : { top, left });
    });
  };

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  return (
    <div className="alisa-editor-overlay fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-0 md:p-4">
      <div className="alisa-editor-window flex h-full w-full flex-col overflow-hidden border border-white/10 bg-[#1e1e1e] shadow-2xl md:h-[min(860px,94vh)] md:max-w-6xl md:rounded-xl">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-black/30 bg-[#181818] px-3 text-[11px] text-slate-400">
          <div className="flex items-center gap-1.5"><Code2 className="h-3.5 w-3.5 text-sky-300" /><span className="font-medium text-slate-300">Alisa Editor</span></div>
          <span className="text-slate-700">›</span><span className="truncate text-slate-500">{shortPath(props.selectedFile, 64)}</span>
          <div className="ml-auto flex items-center gap-1.5"><span className="hidden text-[10px] text-slate-600 sm:inline">Ctrl/Cmd + S</span><button type="button" onClick={props.onSave} disabled={props.saving || props.draft === props.original} className="flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[10px] text-slate-400 hover:bg-white/[0.08] hover:text-white disabled:opacity-40"><Save className="h-3 w-3" />{props.saving ? 'Saving…' : 'Save'}</button><button type="button" onClick={props.onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-white/[0.08] hover:text-white"><X className="h-3.5 w-3.5" /></button></div>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="hidden w-56 shrink-0 flex-col border-r border-black/30 bg-[#181818] md:flex">
            <div className="flex h-9 items-center justify-between border-b border-black/30 px-3 text-[10px] uppercase tracking-[0.14em] text-slate-500"><span>Explorer</span><FolderOpen className="h-3.5 w-3.5" /></div>
            <div className="min-h-0 flex-1 overflow-y-auto py-2"><FileTree nodes={props.nodes} query="" onOpen={props.onOpen} /></div>
            <div className="border-t border-black/30 px-3 py-2 text-[10px] text-slate-600">{props.openFiles.length} open file{props.openFiles.length === 1 ? '' : 's'}</div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="tab-scroll flex h-9 shrink-0 overflow-x-auto border-b border-black/30 bg-[#181818]">
              {props.openFiles.map(file => <div key={file} className={'group flex min-w-[130px] max-w-[220px] items-center gap-2 border-r border-black/30 px-3 text-[11px] ' + (file === props.selectedFile ? 'border-t border-t-sky-300 bg-[#1e1e1e] text-slate-200' : 'text-slate-500')}><button type="button" onClick={() => props.onSelectTab(file)} className="min-w-0 flex-1 truncate text-left">{basename(file)}</button><button type="button" onClick={() => props.onCloseTab(file)} className="rounded p-0.5 opacity-0 hover:bg-white/10 hover:text-white group-hover:opacity-100"><X className="h-3 w-3" /></button></div>)}
            </div>
            <div className="flex h-8 shrink-0 items-center gap-1 border-b border-black/30 bg-[#1e1e1e] px-4 text-[10px] text-slate-500"><span>workspace</span><ChevronRight className="h-3 w-3 text-slate-700" /><span>{props.selectedFile.split(/[\\/]/).slice(-2, -1)[0] || 'root'}</span><ChevronRight className="h-3 w-3 text-slate-700" /><span className="text-slate-300">{basename(props.selectedFile)}</span></div>
            <div className="relative min-h-0 flex-1 overflow-hidden bg-[#1e1e1e]">
              <div ref={lineRef} className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 overflow-hidden bg-[#1e1e1e] text-right font-mono text-[12px] leading-6 text-[#5a5a5a]" style={{ paddingTop: '14px' }}>
                <div style={{ transform: 'translateY(-' + scroll.top + 'px)' }}>{Array.from({ length: lineCount }, (_, index) => <div key={index} className={'h-6 pr-3 ' + (index + 1 === cursor.line ? 'text-[#c6c6c6]' : '')}>{index + 1}</div>)}</div>
              </div>
              <div className="editor-code-highlight" aria-hidden="true" style={{ transform: 'translate(' + (-scroll.left) + 'px, ' + (-scroll.top) + 'px)' }}>
                {highlightedLines.map((tokens, lineIndex) => <div key={lineIndex} className={'editor-code-line ' + (lineIndex + 1 === cursor.line ? 'editor-code-line-active' : '')}>{tokens.length ? tokens.map((token, tokenIndex) => <span key={lineIndex + '-' + tokenIndex} className={'editor-token-' + token.kind}>{token.text}</span>) : '\u00a0'}</div>)}
              </div>
              <textarea ref={editorRef} value={props.draft} onChange={event => { props.onChange(event.target.value); updateCursor(event.currentTarget); }} onScroll={handleScroll} onKeyDown={handleKeyDown} onClick={event => updateCursor(event.currentTarget)} onKeyUp={event => updateCursor(event.currentTarget)} onSelect={event => updateCursor(event.currentTarget)} spellCheck={false} wrap="off" autoFocus className="editor-code-input absolute inset-0 z-20 h-full w-full resize-none overflow-auto bg-transparent py-3.5 pl-14 pr-5 font-mono text-[12px] leading-6 outline-none selection:bg-sky-300/20" />
              <div className="pointer-events-none absolute right-0 top-0 hidden h-full w-20 border-l border-white/[0.03] bg-gradient-to-l from-white/[0.025] to-transparent lg:block" />
            </div>
            {props.error && <div className="border-t border-rose-300/20 bg-rose-300/[0.08] px-4 py-2 text-xs text-rose-200">{props.error}</div>}
            <div className="flex h-6 shrink-0 items-center justify-between bg-[#007acc] px-3 text-[10px] text-white"><div className="flex items-center gap-3"><span>Ln {cursor.line}, Col {cursor.column}</span><span className="hidden sm:inline">Spaces: 2</span><span className="hidden sm:inline">UTF-8</span></div><div className="flex items-center gap-3"><span>{language}</span><span>{props.saving ? 'Saving…' : props.draft !== props.original ? '● Unsaved' : 'Saved'}</span></div></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AppV2() {
  const [workspaceDir, setWorkspaceDir] = useState('');
  const workspaceRef = useRef('');
  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>([]);
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [activeProviderId, setActiveProviderId] = useState('');
  const [model, setModel] = useState('');
  const [modelDraft, setModelDraft] = useState('');
  const [modelCatalog, setModelCatalog] = useState<Record<string, string[]>>({});
  const [modelContextWindows, setModelContextWindows] = useState<Record<string, number>>({});
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState('');
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelMenuQuery, setModelMenuQuery] = useState('');
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionId, setSessionId] = useState('');
  const sessionIdRef = useRef('');
  const [sessionTitle, setSessionTitle] = useState('New chat');
  const [lastRun, setLastRun] = useState<SessionSummary['lastRun']>();
  const [goal, setGoal] = useState<Goal | undefined>();
  const [goalDraftTitle, setGoalDraftTitle] = useState('');
  const [goalDraftDescription, setGoalDraftDescription] = useState('');
  const [goalDraftStatus, setGoalDraftStatus] = useState<GoalStatus>('active');
  const [goalDraftProgress, setGoalDraftProgress] = useState('0');
  const [goalSaving, setGoalSaving] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [mode, setMode] = useState<AgentMode>('code');
  const [swarmEnabled, setSwarmEnabled] = useState(false);
  const [yoloMode, setYoloMode] = useState(false);
  const [yoloSaving, setYoloSaving] = useState(false);
  const [swarmAgents, setSwarmAgents] = useState<SwarmAgent[]>([]);
  const [swarmPhase, setSwarmPhase] = useState('');
  const [contextUsage, setContextUsage] = useState<ContextUsage>({ usedTokens: 0, maxTokens: 128_000, percent: 0 });
  const [input, setInput] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);
  const [fileReferenceIndex, setFileReferenceIndex] = useState(0);
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [statusDetail, setStatusDetail] = useState('Connecting to backend…');
  const [connected, setConnected] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingThought, setStreamingThought] = useState('');
  const [toolRuns, setToolRuns] = useState<ToolRun[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1024);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('chats');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('plan');
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [fileSearch, setFileSearch] = useState('');
  const [git, setGit] = useState<GitState | null>(null);
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null);
  const [webPreviewOpen, setWebPreviewOpen] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [selectedFile, setSelectedFile] = useState('');
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [fileOriginal, setFileOriginal] = useState('');
  const [fileDraft, setFileDraft] = useState('');
  const [fileSaving, setFileSaving] = useState(false);
  const [fileError, setFileError] = useState('');
  const [terminalCommand, setTerminalCommand] = useState('');
  const [terminalOutput, setTerminalOutput] = useState('');
  const [terminalRunning, setTerminalRunning] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalPreferredKind, setTerminalPreferredKind] = useState<'local' | 'ssh'>('local');
  const [terminalSessions, setTerminalSessions] = useState<TerminalSessionView[]>([]);
  const [activeTerminalSessionId, setActiveTerminalSessionId] = useState('');
  const [terminalError, setTerminalError] = useState('');
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsProviderId, setSettingsProviderId] = useState('');
  const [providerName, setProviderName] = useState('');
  const [providerBaseURL, setProviderBaseURL] = useState('');
  const [providerApiKey, setProviderApiKey] = useState('');
  const [providerModel, setProviderModel] = useState('');
  const [providerNotice, setProviderNotice] = useState('');
  const [providerTesting, setProviderTesting] = useState(false);
  const [providerTestModels, setProviderTestModels] = useState<string[]>([]);
  const [toast, setToast] = useState('');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [commandIndex, setCommandIndex] = useState(0);
  const [autoFollow, setAutoFollow] = useState(true);
  const [skills, setSkills] = useState<string[]>(DEFAULT_SKILLS);
  const [capabilities, setCapabilities] = useState<CapabilityStatusView>({});
  const [showYurachiCompanion, setShowYurachiCompanion] = useState(true);
  const [soundEnabledState, setSoundEnabledState] = useState(() => isSoundEnabled());
  const [soundVolumeState, setSoundVolumeState] = useState(() => getSoundVolume());
  const [workspaceTransition, setWorkspaceTransition] = useState<{ path: string; stage: 'opening' | 'ready'; closing?: boolean } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const bootstrapInFlight = useRef(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const modelInputRef = useRef<HTMLInputElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const swarmEnabledRef = useRef(false);
  const streamPendingRef = useRef({ content: '', thought: '' });
  const streamPaintFrameRef = useRef<number | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const terminalOutputPendingRef = useRef<Record<string, string>>({});
  const terminalPaintFrameRef = useRef<number | null>(null);
  const fileRefreshTimerRef = useRef<number | null>(null);
  const workspaceTransitionTimerRef = useRef<number | null>(null);
  const workspaceTransitionExitTimerRef = useRef<number | null>(null);

  useEffect(() => {
    swarmEnabledRef.current = swarmEnabled;
  }, [swarmEnabled]);

  useEffect(() => {
    try { window.localStorage.setItem('alisa.showYurachiCompanion', showYurachiCompanion ? '1' : '0'); } catch { /* Webview storage can be unavailable in private mode. */ }
  }, [showYurachiCompanion]);

  useEffect(() => {
    try { window.localStorage.setItem('alisa.inspectorOpen', inspectorOpen ? '1' : '0'); } catch { /* Webview storage can be unavailable in private mode. */ }
  }, [inspectorOpen]);

  useEffect(() => {
    const preloadTimer = window.setTimeout(() => {
      for (const pose of Object.values(COMPANION_POSES)) {
        const image = new window.Image();
        image.src = pose.src;
      }
    }, 650);
    return () => window.clearTimeout(preloadTimer);
  }, []);

  useEffect(() => () => {
    if (terminalPaintFrameRef.current !== null) window.cancelAnimationFrame(terminalPaintFrameRef.current);
    if (fileRefreshTimerRef.current !== null) window.clearTimeout(fileRefreshTimerRef.current);
    if (workspaceTransitionTimerRef.current !== null) window.clearTimeout(workspaceTransitionTimerRef.current);
    if (workspaceTransitionExitTimerRef.current !== null) window.clearTimeout(workspaceTransitionExitTimerRef.current);
  }, []);

  const queueStreamingPaint = useCallback((field: 'content' | 'thought', value: string) => {
    if (!value) return;
    streamPendingRef.current[field] += value;
    if (streamPaintFrameRef.current !== null) return;
    streamPaintFrameRef.current = window.requestAnimationFrame(() => {
      const pending = streamPendingRef.current;
      streamPendingRef.current = { content: '', thought: '' };
      streamPaintFrameRef.current = null;
      if (pending.content) setStreamingContent(previous => previous + pending.content);
      if (pending.thought) setStreamingThought(previous => previous + pending.thought);
    });
  }, []);

  const resetStreaming = useCallback(() => {
    if (streamPaintFrameRef.current !== null) window.cancelAnimationFrame(streamPaintFrameRef.current);
    streamPaintFrameRef.current = null;
    streamPendingRef.current = { content: '', thought: '' };
    setStreamingContent('');
    setStreamingThought('');
  }, []);

  const queueTerminalOutput = useCallback((sessionId: string, value: string) => {
    if (!value) return;
    terminalOutputPendingRef.current[sessionId] = (terminalOutputPendingRef.current[sessionId] || '') + value;
    if (terminalPaintFrameRef.current !== null) return;
    terminalPaintFrameRef.current = window.requestAnimationFrame(() => {
      const pending = terminalOutputPendingRef.current;
      terminalOutputPendingRef.current = {};
      terminalPaintFrameRef.current = null;
      setTerminalSessions(previous => previous.map(session => {
        const append = pending[session.id];
        if (!append) return session;
        return { ...session, status: session.status === 'connecting' ? 'connected' : session.status, output: (session.output + append).slice(-180_000) };
      }));
    });
  }, []);

  const addActivity = useCallback((entry: Omit<ActivityEntry, 'id' | 'timestamp'>) => {
    setActivity(previous => [{ ...entry, id: String(Date.now()) + Math.random(), timestamp: Date.now() }, ...previous].slice(0, 80));
  }, []);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(current => current === message ? '' : current), 3200);
  }, []);

  const applyConfig = useCallback((next: PublicConfig) => {
    workspaceRef.current = next.workspaceDir;
    setWorkspaceDir(next.workspaceDir);
    setRecentWorkspaces(next.recentWorkspaces || []);
    setProviders(next.providers || []);
    setActiveProviderId(next.activeProviderId || '');
    setModel(next.model || '');
    setModelDraft(next.model || '');
    setYoloMode(next.yoloMode === true);
  }, []);

  const loadConfig = useCallback(async () => {
    const next = await api<PublicConfig>('/api/config');
    applyConfig(next);
    return next;
  }, [applyConfig]);

  const loadCapabilities = useCallback(async () => {
    const next = await api<CapabilityStatusView>('/api/capabilities');
    setCapabilities(next);
    return next;
  }, []);

  const loadProviderModels = useCallback(async (providerId: string, force = false) => {
    if (!providerId) return [];
    setModelLoading(true);
    try {
      const suffix = '?providerId=' + encodeURIComponent(providerId) + (force ? '&refresh=true' : '');
      const data = await api<ProviderModelsResponse>('/api/providers/models' + suffix);
      const models = Array.from(new Set((data.models || []).filter(item => typeof item === 'string' && item.trim()).map(item => item.trim())));
      setModelCatalog(previous => ({ ...previous, [providerId]: models }));
      if (data.modelDetails?.length) {
        setModelContextWindows(previous => {
          const next = { ...previous };
          for (const detail of data.modelDetails || []) {
            if (detail.id && Number.isFinite(detail.contextWindow) && Number(detail.contextWindow) > 0) next[detail.id] = Number(detail.contextWindow);
          }
          return next;
        });
      }
      setModelError('');
      return models;
    } catch (error) {
      setModelError(errorText(error));
      return [];
    } finally {
      setModelLoading(false);
    }
  }, []);

  const loadFiles = useCallback(async () => {
    try {
      const data = await api<{ files: FileNode[] }>('/api/files/tree');
      setFileTree(data.files || []);
      const gitData = await api<GitState>('/api/git').catch(() => null);
      setGit(gitData);
      setWorkspaceError('');
    } catch (error) {
      setWorkspaceError(errorText(error));
    }
  }, []);

  const scheduleFilesRefresh = useCallback(() => {
    if (fileRefreshTimerRef.current !== null) return;
    fileRefreshTimerRef.current = window.setTimeout(() => {
      fileRefreshTimerRef.current = null;
      void loadFiles();
    }, 180);
  }, [loadFiles]);

  const handleDiscardFile = useCallback(async (filePath: string) => {
    try {
      const res = await api<{ success: boolean }>('/api/git/discard-file', {
        method: 'POST',
        body: JSON.stringify({ filePath }),
      });
      if (res.success) {
        notify(`Discarded modifications in ${filePath}`);
        await loadFiles();
      }
    } catch (error) {
      notify(errorText(error));
    }
  }, [loadFiles, notify]);

  const loadSessionList = useCallback(async (query = '', includeArchived = showArchived) => {
    try {
      if (query.trim()) {
        const data = await api<{ sessions: SessionSummary[] }>('/api/sessions/search?workspace=' + encodeURIComponent(workspaceRef.current) + '&q=' + encodeURIComponent(query) + '&includeArchived=' + String(includeArchived));
        setSessions(data.sessions || []);
      } else {
        const data = await api<{ sessions: SessionSummary[] }>('/api/sessions?workspace=' + encodeURIComponent(workspaceRef.current) + '&includeArchived=' + String(includeArchived));
        setSessions(data.sessions || []);
      }
      setWorkspaceError('');
    } catch (error) {
      setWorkspaceError(errorText(error));
    }
  }, [showArchived]);

  const loadSession = useCallback(async (id?: string, preserveSwarmState = false) => {
    if (!workspaceRef.current) return;
    const suffix = id ? '&id=' + encodeURIComponent(id) : '';
    const data = await api<{ sessionId: string; messages: Message[]; plan?: PlanItem[]; goal?: Goal; sessions: SessionSummary[] }>('/api/sessions?workspace=' + encodeURIComponent(workspaceRef.current) + suffix);
    const nextId = data.sessionId;
    sessionIdRef.current = nextId;
    setSessionId(nextId);
    setMessages(data.messages || []);
    setPlan(data.plan || []);
    const summary = (data.sessions || []).find(item => item.id === nextId);
    setSessionTitle(summary?.title || 'New chat');
    setMode(summary?.mode || 'code');
    setSwarmEnabled(Boolean(summary?.swarm));
    setGoal(data.goal || summary?.goal);
    setGoalDraftTitle((data.goal || summary?.goal)?.title || '');
    setGoalDraftDescription((data.goal || summary?.goal)?.description || '');
    setGoalDraftStatus((data.goal || summary?.goal)?.status || 'active');
    setGoalDraftProgress(String((data.goal || summary?.goal)?.progress || 0));
    setContextUsage(estimateContextUsage(data.messages || [], 128_000));
    setLastRun(summary?.lastRun);
    setSessions(data.sessions || []);
    resetStreaming();
    setToolRuns([]);
    setApproval(null);
    if (!preserveSwarmState) {
      setSwarmAgents([]);
      setSwarmPhase('');
    }
  }, [resetStreaming]);

  const handleServerEvent = useCallback((data: any) => {
    if (data.type === 'terminal_started') {
      const session: TerminalSessionView = {
        id: String(data.id),
        kind: data.kind === 'ssh' ? 'ssh' : 'local',
        cwd: typeof data.cwd === 'string' ? data.cwd : undefined,
        host: typeof data.host === 'string' ? data.host : undefined,
        username: typeof data.username === 'string' ? data.username : undefined,
        port: Number.isFinite(Number(data.port)) ? Number(data.port) : undefined,
        startedAt: Number(data.startedAt) || Date.now(),
        status: 'connected',
        output: '',
      };
      setTerminalSessions(previous => [...previous.filter(item => item.id !== session.id), session]);
      setActiveTerminalSessionId(session.id);
      setTerminalError('');
      addActivity({ kind: 'system', label: session.kind === 'ssh' ? 'SSH terminal connected' : 'Local terminal started', detail: session.kind === 'ssh' ? `${session.username}@${session.host}:${session.port}` : session.cwd });
      return;
    }
    if (data.type === 'terminal_output') {
      queueTerminalOutput(String(data.sessionId || ''), String(data.data || ''));
      return;
    }
    if (data.type === 'terminal_exit') {
      const sessionId = String(data.sessionId || '');
      setTerminalSessions(previous => previous.map(session => session.id === sessionId ? { ...session, status: 'exited' } : session));
      addActivity({ kind: 'system', label: 'Terminal exited', detail: data.reason || `exit ${String(data.code ?? data.signal ?? 0)}` });
      return;
    }
    if (data.type === 'terminal_error') {
      const sessionId = String(data.sessionId || '');
      setTerminalSessions(previous => previous.map(session => session.id === sessionId ? { ...session, status: 'error' } : session));
      setTerminalError(data.message || 'Terminal process failed');
      notify(data.message || 'Terminal process failed');
      return;
    }
    if (data.type === 'task_state') {
      setStatus(data.status || 'idle');
      setStatusDetail(data.detail || (data.status === 'idle' ? 'Ready' : statusLabel(data.status, true)));
      if (typeof data.yolo === 'boolean') setYoloMode(data.yolo);
      if (Number.isFinite(Number(data.contextWindow)) && Number(data.contextWindow) > 0) setContextUsage(previous => ({ ...previous, maxTokens: Number(data.contextWindow), percent: Math.min(100, Math.round((previous.usedTokens / Number(data.contextWindow)) * 100)) }));
      return;
    }
    if (data.type === 'status_change') {
      const eventStatus = data.agentRole && swarmEnabledRef.current && (data.status === 'done' || data.status === 'idle') ? 'acting' : (data.status || 'idle');
      setStatus(eventStatus);
      setStatusDetail((data.agentRole ? `${data.agentRole} · ` : '') + (data.detail || (eventStatus === 'idle' ? 'Ready' : statusLabel(eventStatus, true))));
      addActivity({ kind: 'status', label: data.status || 'status', detail: data.detail });
      if (data.status !== 'waiting_approval') setApproval(null);
      return;
    }
    if (data.type === 'stream_reset') {
      resetStreaming();
      return;
    }
    if (data.type === 'retry_attempt') {
      resetStreaming();
      addActivity({ kind: 'status', label: `OmniRoute retry ${data.attempt}/${data.maxRetries}`, detail: data.error });
      return;
    }
    if (data.type === 'token_stream' || data.type === 'token') {
      queueStreamingPaint('content', data.delta || data.token || '');
      return;
    }
    if (data.type === 'thought_stream' || data.type === 'thought') {
      queueStreamingPaint('thought', data.delta || data.thought || '');
      return;
    }
    if (data.type === 'context_usage') {
      if (data.usage) setContextUsage(data.usage as ContextUsage);
      return;
    }
    if (data.type === 'swarm_update') {
      setSwarmAgents(Array.isArray(data.agents) ? data.agents : []);
      setSwarmPhase(data.phase || 'Agent swarm active');
      if (data.phase) addActivity({ kind: 'system', label: 'Swarm', detail: data.phase });
      return;
    }
    if (data.type === 'goal_update') {
      const nextGoal = data.goal as Goal | undefined;
      setGoal(nextGoal);
      setGoalDraftTitle(nextGoal?.title || '');
      setGoalDraftDescription(nextGoal?.description || '');
      setGoalDraftStatus(nextGoal?.status || 'active');
      setGoalDraftProgress(String(nextGoal?.progress || 0));
      addActivity({ kind: 'system', label: 'Goal updated', detail: nextGoal ? `${nextGoal.progress}% · ${nextGoal.status}` : 'Goal cleared' });
      return;
    }
    if (data.type === 'plan_update') {
      setPlan(data.items || []);
      addActivity({ kind: 'system', label: 'Plan updated', detail: String((data.items || []).length) + ' steps' });
      return;
    }
    if (data.type === 'tool_call_start' || data.type === 'tool_start') {
      const next: ToolRun = { toolName: data.toolName, toolCallId: data.toolCallId || String(Date.now()), args: data.args || {}, status: 'running', agentRole: data.agentRole };
      setToolRuns(previous => [...previous.filter(item => item.toolCallId !== next.toolCallId), next]);
      addActivity({ kind: 'tool', label: toolLabel(next), detail: JSON.stringify(next.args) });
      return;
    }
    if (data.type === 'tool_call_end' || data.type === 'tool_end') {
      setToolRuns(previous => previous.map(item => item.toolCallId === data.toolCallId ? { ...item, result: String(data.result || ''), error: data.error, status: data.error ? 'error' : 'success', agentRole: data.agentRole || item.agentRole } : item));
      addActivity({ kind: data.error ? 'error' : 'tool', label: (data.error ? 'Failed: ' : 'Completed: ') + String(data.toolName || 'tool'), detail: data.error || undefined });
      scheduleFilesRefresh();
      return;
    }
    if (data.type === 'approval_requested') {
      setApproval({ resolveId: data.resolveId, action: data.action, details: data.details || {} });
      addActivity({ kind: 'system', label: 'Approval requested', detail: data.action });
      return;
    }
    if (data.type === 'message_added') {
      const message = data.message as Message;
      if (!message) return;
      setMessages(previous => {
        const withoutOptimistic = message.role === 'user'
          ? previous.filter(item => !(item.id.startsWith('local_') && item.role === 'user' && item.content === message.content))
          : previous;
        return withoutOptimistic.some(item => item.id === message.id) ? withoutOptimistic : [...withoutOptimistic, message];
      });
      if (message.role === 'assistant') {
        resetStreaming();
      }
      return;
    }
    if (data.type === 'session_saved') {
      const finalStatus = data.status || 'done';
      const durationMs = Number.isFinite(Number(data.durationMs)) ? Math.max(0, Number(data.durationMs)) : 0;
      const duration = formatDuration(durationMs);
      const baseDetail = data.detail || (finalStatus === 'error' ? 'Task failed' : finalStatus === 'idle' ? 'Cancelled' : 'Ready');
      setLastRun({ status: finalStatus, detail: baseDetail, durationMs, completedAt: Number(data.completedAt) || Date.now() });
      setStatus(finalStatus === 'error' ? 'error' : finalStatus === 'idle' ? 'idle' : 'done');
      setStatusDetail(duration ? `${baseDetail} · ${duration}` : baseDetail);
      addActivity({ kind: finalStatus === 'error' ? 'error' : 'system', label: finalStatus === 'error' ? 'Task failed' : finalStatus === 'idle' ? 'Task cancelled' : 'Task completed', detail: duration ? `${baseDetail} · ${duration}` : baseDetail });
      setApproval(null);
      setToolRuns([]);
      resetStreaming();
      if (typeof data.swarm === 'boolean') setSwarmEnabled(data.swarm);
      if (Array.isArray(data.agents)) setSwarmAgents(data.agents as SwarmAgent[]);
      if (data.swarm) setSwarmPhase(baseDetail);
      void loadSession(data.sessionId, true).catch(error => {
        setWorkspaceError(errorText(error));
        setStatus('error');
        setStatusDetail('Could not reload the saved session');
      });
      return;
    }
    if (data.type === 'error') {
      resetStreaming();
      setToolRuns([]);
      setApproval(null);
      setStatus('error');
      setStatusDetail(data.message || 'Request failed');
      addActivity({ kind: 'error', label: 'Error', detail: data.message });
      notify(data.message || 'Request failed');
    }
  }, [addActivity, loadSession, notify, queueStreamingPaint, queueTerminalOutput, resetStreaming, scheduleFilesRefresh]);

  useEffect(() => {
    let disposed = false;
    let retryTimer: number | undefined;
    const connect = () => {
      if (disposed) return;
      let socket: WebSocket;
      try {
        socket = new WebSocket(websocketUrl());
      } catch {
        setConnected(false);
        retryTimer = window.setTimeout(connect, 2500);
        return;
      }
      wsRef.current = socket;
      socket.onopen = () => {
        setConnected(true);
        setStatusDetail('Ready');
        addActivity({ kind: 'system', label: 'Backend connected' });
      };
      socket.onmessage = event => {
        try { handleServerEvent(JSON.parse(event.data)); } catch { /* Ignore malformed backend events. */ }
      };
      socket.onclose = () => {
        setConnected(false);
        setTerminalSessions(previous => previous.map(session => session.status === 'exited' ? session : { ...session, status: 'error' }));
        if (!disposed) retryTimer = window.setTimeout(connect, 2500);
      };
      socket.onerror = () => setConnected(false);
    };
    connect();
    return () => {
      disposed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      wsRef.current?.close();
    };
  }, [addActivity, handleServerEvent]);

  useEffect(() => {
    const bootstrap = async () => {
      if (bootstrapInFlight.current) return;
      bootstrapInFlight.current = true;
      try {
        const next = await loadConfig();
        workspaceRef.current = next.workspaceDir;
        await Promise.all([loadSession(), loadFiles()]);
        void loadProviderModels(next.activeProviderId);
        const skillData = await api<{ skills: Array<{ name: string }> }>('/api/skills').catch(() => ({ skills: [] }));
        const names = skillData.skills?.map(skill => skill.name).filter(Boolean) || [];
        if (names.length) setSkills(names.slice(0, 20));
        void loadCapabilities().catch(() => undefined);
      } catch (error) {
        setWorkspaceError(errorText(error));
        setStatusDetail('Backend is not available');
      } finally {
        bootstrapInFlight.current = false;
      }
    };
    void bootstrap();
  }, [connected, loadCapabilities, loadConfig, loadFiles, loadProviderModels, loadSession]);

  useEffect(() => {
    if (!autoFollow) return;
    if (autoScrollFrameRef.current !== null) window.cancelAnimationFrame(autoScrollFrameRef.current);
    autoScrollFrameRef.current = window.requestAnimationFrame(() => {
      const scroller = chatScrollRef.current;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      autoScrollFrameRef.current = null;
    });
    return () => {
      if (autoScrollFrameRef.current !== null) window.cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    };
  }, [autoFollow, messages, streamingContent, streamingThought, toolRuns]);

  useEffect(() => {
    if (!search.trim()) {
      void loadSessionList('', showArchived);
      return;
    }
    const timer = window.setTimeout(() => void loadSessionList(search, true), 220);
    return () => window.clearTimeout(timer);
  }, [loadSessionList, search, showArchived]);

  const activeProvider = providers.find(provider => provider.id === activeProviderId) || providers[0];
  const activeModelOptions = useMemo(() => {
    const known = modelCatalog[activeProviderId] || [];
    return model && !known.includes(model) ? [model, ...known] : known;
  }, [activeProviderId, model, modelCatalog]);
  const visibleModelOptions = useMemo(() => {
    const query = modelMenuQuery.trim().toLowerCase();
    if (!query) return activeModelOptions;
    return activeModelOptions.filter(option => option.toLowerCase().includes(query));
  }, [activeModelOptions, modelMenuQuery]);
  const settingsModelOptions = useMemo(() => Array.from(new Set([
    ...(modelCatalog[settingsProviderId] || []),
    ...providerTestModels,
    ...(providerModel ? [providerModel] : []),
  ])), [modelCatalog, providerModel, providerTestModels, settingsProviderId]);
  const slashQueryMatch = input.match(/^\/([^\s]*)$/);
  const slashMatches = useMemo(() => {
    if (!slashQueryMatch) return [];
    const query = slashQueryMatch[1].toLowerCase();
    return SLASH_COMMANDS.filter(command => command.id.includes(query) || command.label.includes(query));
  }, [slashQueryMatch?.[1]]);
  const fileReferenceMatch = input.match(/(?:^|\s)@([^\s]*)$/);
  const fileReferenceOptions = useMemo(() => {
    if (!fileReferenceMatch) return [];
    const query = fileReferenceMatch[1].toLowerCase();
    const score = (file: FileNode) => {
      const haystack = file.path.toLowerCase();
      if (!query) return 0;
      if (haystack.startsWith(query)) return 100;
      if (haystack.includes(query)) return 60;
      let position = 0;
      for (const char of query) {
        position = haystack.indexOf(char, position);
        if (position < 0) return -1;
        position++;
      }
      return 20;
    };
    return flattenFiles(fileTree)
      .filter(file => file.type === 'file')
      .map(file => ({ file, score: score(file) }))
      .filter(item => item.score >= 0)
      .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
      .slice(0, 12)
      .map(item => item.file);
  }, [fileReferenceMatch?.[1], fileTree]);
  const currentMode = MODES.find(item => item.id === mode) || MODES[1];
  const selectedContextWindow = modelContextWindows[model] || 128_000;
  const busy = status === 'thinking' || status === 'acting' || status === 'waiting_approval' || status === 'self_correcting';
  const chatMessages = useMemo(() => visibleMessages(messages), [messages]);
  const changedFiles = useMemo(() => {
    const fromStatus = (git?.status || '').split('\n').map(line => line.slice(3).trim()).filter(Boolean);
    const fromTools = toolRuns.filter(tool => tool.toolName === 'write_file' || tool.toolName === 'patch_file').map(tool => String(tool.args.path || '')).filter(Boolean);
    return Array.from(new Set([...fromStatus, ...fromTools]));
  }, [git, toolRuns]);
  const companionPose = useMemo<CompanionPose>(() => {
    if (busy) return status === 'thinking' || status === 'self_correcting' ? 'thinking' : 'terminal';
    if (lastRun?.status === 'done') return 'success';
    if (lastRun?.status === 'error') return 'thinking';
    if (changedFiles.length) return 'review';
    return 'coding';
  }, [busy, changedFiles.length, lastRun?.status, status]);
  const companion = COMPANION_POSES[companionPose];

  useEffect(() => {
    if (busy) return;
    setContextUsage(estimateContextUsage(messages, selectedContextWindow));
  }, [busy, messages, selectedContextWindow]);

  const selectSession = async (id: string) => {
    if (busy) return;
    try {
      await loadSession(id);
      addActivity({ kind: 'system', label: 'Chat opened' });
    } catch (error) { notify(errorText(error)); }
  };

  const newChat = async () => {
    if (busy) return;
    try {
      const data = await api<{ sessionId: string }>('/api/sessions', { method: 'POST', body: JSON.stringify({ mode }) });
      await loadSession(data.sessionId);
      setInput('');
      setLastRun(undefined);
      setAutoFollow(true);
    } catch (error) { notify(errorText(error)); }
  };

  const toggleSwarm = async () => {
    if (busy) {
      notify('Stop the active task before changing swarm mode');
      return;
    }
    const next = !swarmEnabled;
    setSwarmEnabled(next);
    if (!sessionIdRef.current) return;
    try {
      await api('/api/sessions/action', { method: 'POST', body: JSON.stringify({ id: sessionIdRef.current, action: 'set_swarm', swarm: next }) });
      notify(next ? 'Agent swarm enabled · Explorer → Planner → Builder → Reviewer' : 'Single agent mode enabled');
    } catch (error) {
      setSwarmEnabled(!next);
      notify(errorText(error));
    }
  };

  const toggleYolo = async () => {
    if (busy) {
      notify('Stop the active task before changing YOLO mode');
      return;
    }
    if (yoloSaving) return;
    const next = !yoloMode;
    setYoloMode(next);
    setYoloSaving(true);
    try {
      const data = await api<{ success: boolean; config: PublicConfig }>('/api/config', {
        method: 'POST',
        body: JSON.stringify({ yoloMode: next }),
      });
      applyConfig(data.config);
      notify(next ? 'YOLO enabled · approval prompts bypassed' : 'YOLO disabled · approvals enabled');
    } catch (error) {
      setYoloMode(!next);
      notify(errorText(error));
    } finally {
      setYoloSaving(false);
    }
  };

  const saveGoal = async () => {
    const title = goalDraftTitle.trim();
    if (!title || !sessionIdRef.current) {
      notify('Goal title is required');
      return;
    }
    const nextGoal: Goal = {
      id: goal?.id || `goal_${Date.now()}`,
      title,
      description: goalDraftDescription.trim(),
      status: goalDraftStatus,
      progress: Math.max(0, Math.min(100, Number.parseInt(goalDraftProgress, 10) || 0)),
      steps: goal?.steps || [],
      createdAt: goal?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    setGoalSaving(true);
    try {
      const data = await api<{ goal?: Goal }>('/api/goals', { method: 'POST', body: JSON.stringify({ sessionId: sessionIdRef.current, goal: nextGoal }) });
      const saved = data.goal || nextGoal;
      setGoal(saved);
      setGoalDraftTitle(saved.title);
      setGoalDraftDescription(saved.description || '');
      setGoalDraftStatus(saved.status);
      setGoalDraftProgress(String(saved.progress));
      notify('Goal saved');
    } catch (error) { notify(errorText(error)); }
    finally { setGoalSaving(false); }
  };

  const clearGoal = async () => {
    if (!sessionIdRef.current) return;
    setGoalSaving(true);
    try {
      await api('/api/goals', { method: 'POST', body: JSON.stringify({ sessionId: sessionIdRef.current, goal: null }) });
      setGoal(undefined);
      setGoalDraftTitle('');
      setGoalDraftDescription('');
      setGoalDraftStatus('active');
      setGoalDraftProgress('0');
      notify('Goal cleared');
    } catch (error) { notify(errorText(error)); }
    finally { setGoalSaving(false); }
  };

  const createWorkspaceEntry = async (directory: boolean) => {
    const label = window.prompt(directory ? 'New folder path' : 'New file path', directory ? 'src/new-folder' : 'src/new-file.ts')?.trim();
    if (!label) return;
    try {
      await api('/api/files/create', { method: 'POST', body: JSON.stringify({ path: label, isDirectory: directory }) });
      await loadFiles();
      if (!directory) await openFile(label, true);
      notify((directory ? 'Created folder ' : 'Created file ') + label);
    } catch (error) { notify(errorText(error)); }
  };

  const runSlashCommand = (commandId: string) => {
    setInput('');
    setSlashIndex(0);
    if (commandId === 'help') {
      notify('/models  /agents  /swarm  /skills  /character  /goal  /files  /terminal  /ssh  /sessions  /new  /clear  /compact  /settings');
      return;
    }
    if (commandId === 'models') {
      window.requestAnimationFrame(() => modelInputRef.current?.focus());
      return;
    }
    if (commandId === 'agents') {
      const nextIndex = (MODES.findIndex(item => item.id === mode) + 1) % MODES.length;
      setMode(MODES[nextIndex].id);
      notify('Agent: ' + MODES[nextIndex].label);
      return;
    }
    if (commandId === 'swarm') {
      void toggleSwarm();
      return;
    }
    if (commandId === 'yolo') {
      void toggleYolo();
      return;
    }
    if (commandId === 'skills') {
      const mcp = capabilities.mcp?.availability === 'ready' ? 'MCP ready' : 'MCP skill ready';
      const computerUse = capabilities.computerUse?.availability === 'ready' ? 'Computer Use bridge detected' : 'Computer Use skill ready';
      notify(`${mcp} · ${computerUse}`);
      return;
    }
    if (commandId === 'character') {
      const next = !showYurachiCompanion;
      setShowYurachiCompanion(next);
      notify(next ? 'Yurachi companion shown' : 'Yurachi companion hidden');
      return;
    }
    if (commandId === 'goal') {
      setInspectorTab('goal');
      setInspectorOpen(true);
      return;
    }
    if (commandId === 'files') {
      setSidebarTab('files');
      setSidebarOpen(true);
      return;
    }
    if (commandId === 'terminal' || commandId === 'ssh') {
      setTerminalPreferredKind(commandId === 'ssh' ? 'ssh' : 'local');
      setTerminalOpen(true);
      return;
    }
    if (commandId === 'sessions') {
      setSidebarOpen(true);
      setSidebarTab('chats');
      return;
    }
    if (commandId === 'new') {
      void newChat();
      return;
    }
    if (commandId === 'clear') {
      setMessages([]);
      setPlan([]);
      setStreamingContent('');
      setStreamingThought('');
      notify('Transcript cleared from view');
      return;
    }
    if (commandId === 'compact') {
      setInput('Please compact the current context, keep the important decisions, and continue the task.');
      window.requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }
    if (commandId === 'diff') {
      if (changedFiles.length > 0) {
        setSelectedDiffFile(changedFiles[0]);
      } else {
        notify('Working tree clean — no modified files to diff');
      }
      return;
    }
    if (commandId === 'preview') {
      setWebPreviewOpen(prev => !prev);
      return;
    }
    if (commandId === 'templates') {
      setTemplateModalOpen(true);
      return;
    }
    if (commandId === 'theme') {
      notify('Theme is fixed to the pure-black terminal workspace');
      return;
    }
    if (commandId === 'settings') openSettings();
  };

  const insertFileReference = (filePath: string) => {
    setInput(previous => previous.replace(/@[^\s]*$/, '@' + filePath + ' '));
    setFileReferenceIndex(0);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const sessionAction = async (id: string, action: 'rename' | 'pin' | 'unpin' | 'archive' | 'restore') => {
    try {
      let title: string | undefined;
      if (action === 'rename') {
        title = window.prompt('ชื่อแชต', sessions.find(item => item.id === id)?.title || '')?.trim();
        if (!title) return;
      }
      await api('/api/sessions/action', { method: 'POST', body: JSON.stringify({ id, action, title }) });
      await loadSessionList('', showArchived);
      if (id === sessionIdRef.current) await loadSession(id);
    } catch (error) { notify(errorText(error)); }
  };

  const sendPrompt = (event?: FormEvent) => {
    event?.preventDefault();
    const prompt = input.trim();
    if (!prompt || busy || !sessionIdRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const optimistic: Message = { id: 'local_' + Date.now(), role: 'user', content: prompt, timestamp: Date.now() };
    setMessages(previous => [...previous, optimistic]);
    setInput('');
    setAutoFollow(true);
    setStatus('thinking');
    setStatusDetail('Thinking…');
    addActivity({ kind: 'system', label: 'Task started', detail: prompt });
    wsRef.current.send(JSON.stringify({ type: 'start_task', sessionId: sessionIdRef.current, prompt, skills, mode, model, swarm: swarmEnabled, yolo: yoloMode }));
  };

  const retryLastPrompt = useCallback(() => {
    const lastUserMsg = [...messages].reverse().find(item => item.role === 'user');
    if (!lastUserMsg || !lastUserMsg.content.trim()) return;
    const prompt = lastUserMsg.content.trim();
    if (busy || !sessionIdRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const optimistic: Message = { id: 'local_' + Date.now(), role: 'user', content: prompt, timestamp: Date.now() };
    setMessages(previous => [...previous, optimistic]);
    setAutoFollow(true);
    setStatus('thinking');
    setStatusDetail('Retrying prompt…');
    addActivity({ kind: 'system', label: 'Task retried', detail: prompt });
    wsRef.current.send(JSON.stringify({ type: 'start_task', sessionId: sessionIdRef.current, prompt, skills, mode, model, swarm: swarmEnabled, yolo: yoloMode }));
  }, [messages, busy, skills, mode, model, swarmEnabled, yoloMode, addActivity]);

  const stopTask = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: 'abort_task' }));
  };

  const respondApproval = (approved: boolean) => {
    if (!approval || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'approval_response', resolveId: approval.resolveId, approved }));
    setApproval(null);
  };

  const openFile = async (filePath: string, skipUnsavedGuard = false) => {
    if (selectedFile === filePath) return;
    if (!skipUnsavedGuard && selectedFile && fileDraft !== fileOriginal && !window.confirm('ยังไม่ได้บันทึก ' + basename(selectedFile) + ' ต้องการละทิ้งการแก้ไขไหม?')) return;
    try {
      const data = await api<{ content: string; path: string }>('/api/files/read?path=' + encodeURIComponent(filePath));
      const openedPath = data.path || filePath;
      setSelectedFile(openedPath);
      setOpenFiles(previous => previous.includes(openedPath) ? previous : [...previous, openedPath]);
      setFileOriginal(data.content);
      setFileDraft(data.content);
      setFileError('');
    } catch (error) { setFileError(errorText(error)); }
  };

  const saveFile = async () => {
    if (!selectedFile || fileDraft === fileOriginal) return;
    setFileSaving(true);
    try {
      await api('/api/files/write', { method: 'POST', body: JSON.stringify({ path: selectedFile, content: fileDraft, originalContent: fileOriginal }) });
      setFileOriginal(fileDraft);
      notify('Saved ' + basename(selectedFile));
      void loadFiles();
    } catch (error) { setFileError(errorText(error)); }
    finally { setFileSaving(false); }
  };

  const runTerminal = async () => {
    const command = terminalCommand.trim();
    if (!command || terminalRunning) return;
    setTerminalRunning(true);
    setTerminalOutput('$ ' + command + '\n');
    addActivity({ kind: 'tool', label: 'Terminal', detail: command });
    try {
      const result = await api<{ output?: string; exitCode?: number; timedOut?: boolean }>('/api/terminal', { method: 'POST', body: JSON.stringify({ command, timeout_s: 120 }) });
      setTerminalOutput('$ ' + command + '\n' + (result.output || '') + '\n[exit ' + String(result.exitCode ?? 0) + ']');
    } catch (error) {
      setTerminalOutput('$ ' + command + '\n' + errorText(error));
    } finally { setTerminalRunning(false); }
  };

  const sendTerminalMessage = (message: Record<string, unknown>) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      setTerminalError('Backend is offline. Reconnect before opening a terminal.');
      return false;
    }
    wsRef.current.send(JSON.stringify(message));
    return true;
  };

  const startTerminal = (kind: 'local' | 'ssh', ssh: SshDraft) => {
    setTerminalOpen(true);
    setTerminalError('');
    if (kind === 'ssh') {
      sendTerminalMessage({
        type: 'terminal_start',
        target: 'ssh',
        host: ssh.host.trim(),
        username: ssh.username.trim(),
        port: Number.parseInt(ssh.port, 10) || 22,
        identityFile: ssh.identityFile.trim() || undefined,
        remoteCwd: ssh.remoteCwd.trim() || undefined,
      });
      return;
    }
    sendTerminalMessage({ type: 'terminal_start', target: 'local', workdir: workspaceRef.current });
  };

  const sendTerminalInput = (sessionId: string, data: string) => {
    if (!data) return;
    const isInterrupt = data.startsWith('\u0003');
    queueTerminalOutput(sessionId, isInterrupt ? '^C\n' : `› ${data}`);
    sendTerminalMessage({ type: 'terminal_input', sessionId, data });
  };

  const stopTerminal = (sessionId: string) => {
    sendTerminalMessage({ type: 'terminal_stop', sessionId });
  };

  const clearTerminal = (sessionId: string) => {
    setTerminalSessions(previous => previous.map(session => session.id === sessionId ? { ...session, output: '' } : session));
  };

  const switchProvider = async (providerId: string) => {
    try {
      const data = await api<{ config: PublicConfig }>('/api/providers/switch', { method: 'POST', body: JSON.stringify({ providerId }) });
      applyConfig(data.config);
      setModelMenuOpen(false);
      setModelMenuQuery('');
      setModelError('');
      void loadProviderModels(providerId);
      notify('Using ' + (data.config.providers.find(item => item.id === providerId)?.name || providerId));
    } catch (error) { notify(errorText(error)); }
  };

  const commitModel = async (value = modelDraft) => {
    const nextModel = value.trim();
    if (!nextModel) {
      setModelDraft(model);
      return;
    }
    if (status === 'thinking' || status === 'acting' || status === 'waiting_approval' || status === 'self_correcting') {
      setModelDraft(model);
      notify('Stop the active task before changing the model');
      return;
    }
    if (!activeProviderId || nextModel === model) {
      setModelDraft(nextModel);
      return;
    }
    const previousModel = model;
    try {
      const data = await api<{ config: PublicConfig }>('/api/providers/switch', {
        method: 'POST',
        body: JSON.stringify({ providerId: activeProviderId, model: nextModel }),
      });
      applyConfig(data.config);
      setModelDraft(data.config.model || nextModel);
      setModelMenuOpen(false);
      setModelMenuQuery('');
      setModelError('');
      if (sessionIdRef.current) {
        void api('/api/sessions/action', {
          method: 'POST',
          body: JSON.stringify({ id: sessionIdRef.current, action: 'set_model', model: data.config.model || nextModel }),
        }).catch(() => undefined);
      }
      addActivity({ kind: 'system', label: 'Model changed', detail: nextModel });
      notify('Model: ' + nextModel);
    } catch (error) {
      setModel(previousModel);
      setModelDraft(previousModel);
      notify(errorText(error));
    }
  };

  const chooseWorkspace = async (selected?: string) => {
    try {
      const nextPath = selected || await window.desktopAPI?.openFolderPicker?.();
      if (!nextPath) return;
      if (workspaceTransitionTimerRef.current !== null) window.clearTimeout(workspaceTransitionTimerRef.current);
      if (workspaceTransitionExitTimerRef.current !== null) window.clearTimeout(workspaceTransitionExitTimerRef.current);
      setWorkspaceTransition({ path: nextPath, stage: 'opening' });
      setShowProjectMenu(false);
      setStatusDetail('Opening project…');
      terminalSessions.forEach(session => sendTerminalMessage({ type: 'terminal_stop', sessionId: session.id }));
      setTerminalSessions([]);
      setActiveTerminalSessionId('');
      setSelectedFile('');
      setOpenFiles([]);
      setFileOriginal('');
      setFileDraft('');
      const data = await api<{ config: PublicConfig }>('/api/config', { method: 'POST', body: JSON.stringify({ workspaceDir: nextPath }) });
      applyConfig(data.config);
      setWorkspaceError('');
      await Promise.all([loadSession(), loadFiles()]);
      setWorkspaceTransition(previous => previous ? { ...previous, path: data.config.workspaceDir, stage: 'ready' } : previous);
      workspaceTransitionTimerRef.current = window.setTimeout(() => {
        workspaceTransitionTimerRef.current = null;
        setWorkspaceTransition(previous => previous ? { ...previous, closing: true } : previous);
        workspaceTransitionExitTimerRef.current = window.setTimeout(() => {
          workspaceTransitionExitTimerRef.current = null;
          setWorkspaceTransition(null);
        }, 180);
      }, 120);
    } catch (error) {
      if (workspaceTransitionTimerRef.current !== null) window.clearTimeout(workspaceTransitionTimerRef.current);
      if (workspaceTransitionExitTimerRef.current !== null) window.clearTimeout(workspaceTransitionExitTimerRef.current);
      workspaceTransitionTimerRef.current = null;
      workspaceTransitionExitTimerRef.current = null;
      setWorkspaceTransition(null);
      setWorkspaceError(errorText(error));
    }
  };

  const openSettings = (providerId = activeProviderId) => {
    const selected = providers.find(provider => provider.id === providerId) || activeProvider;
    setSettingsProviderId(selected?.id || '');
    setProviderName(selected?.name || '');
    setProviderBaseURL(selected?.baseURL || '');
    setProviderModel(selected?.model || model);
    setProviderApiKey('');
    setProviderNotice('');
    setProviderTestModels(modelCatalog[selected?.id || ''] || []);
    if (selected?.id) void loadProviderModels(selected.id);
    setShowSettings(true);
  };

  const saveProvider = async (setActive = false) => {
    try {
      const data = await api<{ config: PublicConfig }>('/api/providers/save', {
        method: 'POST',
        body: JSON.stringify({ id: settingsProviderId || undefined, name: providerName, baseURL: providerBaseURL, apiKey: providerApiKey, model: providerModel, setActive }),
      });
      applyConfig(data.config);
      setProviderNotice('Saved locally · atomic write · 3 recovery copies updated');
      if (setActive) setSettingsProviderId(data.config.activeProviderId);
      const savedProvider = data.config.providers.find(item => item.name === providerName.trim() && item.baseURL === providerBaseURL.trim().replace(/\/+$/, ''));
      if (savedProvider && providerTestModels.length) {
        setModelCatalog(previous => ({ ...previous, [savedProvider.id]: providerTestModels }));
      }
      if (setActive || data.config.activeProviderId === savedProvider?.id) void loadProviderModels(data.config.activeProviderId, true);
    } catch (error) { setProviderNotice(errorText(error)); }
  };

  const testProvider = async () => {
    setProviderTesting(true);
    setProviderNotice('Testing connection…');
    try {
      const data = await api<{ models: string[]; message: string }>('/api/provider/test', { method: 'POST', body: JSON.stringify({ baseURL: providerBaseURL, apiKey: providerApiKey, model: providerModel }) });
      setProviderTestModels(data.models || []);
      if (settingsProviderId) setModelCatalog(previous => ({ ...previous, [settingsProviderId]: data.models || [] }));
      setProviderNotice(data.message + (data.models.length ? ` ${data.models.length} models ready for selection.` : ''));
    } catch (error) { setProviderNotice(errorText(error)); }
    finally { setProviderTesting(false); }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashMatches.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSlashIndex(previous => Math.min(previous + 1, slashMatches.length - 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashIndex(previous => Math.max(previous - 1, 0));
        return;
      }
      if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        runSlashCommand(slashMatches[slashIndex]?.id || slashMatches[0].id);
        return;
      }
    }
    if (fileReferenceOptions.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setFileReferenceIndex(previous => Math.min(previous + 1, fileReferenceOptions.length - 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setFileReferenceIndex(previous => Math.max(previous - 1, 0));
        return;
      }
      if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        if (fileReferenceOptions[fileReferenceIndex]) insertFileReference(fileReferenceOptions[fileReferenceIndex].path);
        return;
      }
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      sendPrompt();
    }
  };

  const commandItems = useMemo<CommandItem[]>(() => [
    { id: 'new-session', label: 'New session', detail: 'Start a clean project conversation', run: () => void newChat() },
    { id: 'open-sessions', label: 'Open sessions', detail: 'Show the project transcript list', run: () => { setSidebarOpen(true); setSidebarTab('chats'); } },
    { id: 'change-model', label: 'Change model', detail: 'Choose an OmniRouter model route', run: () => window.requestAnimationFrame(() => modelInputRef.current?.focus()) },
    { id: 'refresh-models', label: 'Refresh models', detail: 'Fetch every model from the active provider', run: () => void loadProviderModels(activeProviderId, true) },
    { id: 'change-agent', label: 'Change agent', detail: 'Cycle Auto, Code, Plan, and Ask', run: () => setMode(MODES[(MODES.findIndex(item => item.id === mode) + 1) % MODES.length].id) },
    { id: 'toggle-swarm', label: swarmEnabled ? 'Use single agent' : 'Enable agent swarm', detail: 'Run Explorer, Planner, Builder, and Reviewer', run: () => void toggleSwarm() },
    { id: 'toggle-yolo', label: yoloMode ? 'Disable YOLO mode' : 'Enable YOLO mode', detail: 'Run approval-gated tools without confirmation prompts', run: () => void toggleYolo() },
    { id: 'toggle-character', label: showYurachiCompanion ? 'Hide Yurachi companion' : 'Show Yurachi companion in right menu', detail: 'Toggle the animated companion docked in the right menu', run: () => { const next = !showYurachiCompanion; setShowYurachiCompanion(next); if (next && !inspectorOpen) setInspectorOpen(true); notify(next ? 'Yurachi companion docked in right menu' : 'Yurachi companion hidden'); } },
    { id: 'open-goal', label: 'Open goal', detail: 'Set the persistent session goal and progress', run: () => { setInspectorTab('goal'); setInspectorOpen(true); } },
    { id: 'open-files', label: 'Open project files', detail: 'Browse files or open the VSCode-style editor', run: () => { setSidebarTab('files'); setSidebarOpen(true); } },
    { id: 'open-terminal', label: 'Open terminal', detail: 'Start a local shell or connect through SSH', run: () => { setTerminalPreferredKind('local'); setTerminalOpen(true); } },
    { id: 'open-context', label: 'Show context window', detail: 'View estimated tokens and model window', run: () => { setInspectorTab('context'); setInspectorOpen(true); } },
    { id: 'open-project', label: 'Open project', detail: 'Choose another local workspace', run: () => void chooseWorkspace() },
    { id: 'settings', label: 'Settings', detail: 'Providers, model endpoint, and project', run: () => openSettings() },
    { id: 'toggle-inspector', label: 'Toggle inspector', detail: 'Show plan, changes, and activity', run: () => setInspectorOpen(value => !value) },
  ], [activeProviderId, loadProviderModels, mode, notify, showYurachiCompanion, swarmEnabled, yoloMode]);
  const filteredCommandItems = useMemo(() => {
    const query = commandQuery.trim().toLowerCase();
    if (!query) return commandItems;
    return commandItems.filter(item => (item.label + ' ' + item.detail).toLowerCase().includes(query));
  }, [commandItems, commandQuery]);

  useEffect(() => {
    setCommandIndex(previous => Math.min(previous, Math.max(0, filteredCommandItems.length - 1)));
  }, [filteredCommandItems.length]);

  useEffect(() => {
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && ['p', 'k'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        setCommandPaletteOpen(true);
        setCommandQuery('');
        setCommandIndex(0);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === '`') {
        event.preventDefault();
        setTerminalOpen(value => !value);
        return;
      }
      if (!commandPaletteOpen) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setCommandPaletteOpen(false);
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setCommandIndex(previous => Math.min(previous + 1, Math.max(0, filteredCommandItems.length - 1)));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setCommandIndex(previous => Math.max(previous - 1, 0));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const command = filteredCommandItems[commandIndex];
        if (command) {
          setCommandPaletteOpen(false);
          setCommandQuery('');
          command.run();
        }
      }
    };
    window.addEventListener('keydown', onWindowKeyDown);
    return () => window.removeEventListener('keydown', onWindowKeyDown);
  }, [commandIndex, commandPaletteOpen, filteredCommandItems]);

  const handleChatScroll = () => {
    const element = chatScrollRef.current;
    if (!element) return;
    setAutoFollow(element.scrollHeight - element.scrollTop - element.clientHeight < 72);
  };

  const closeEditor = () => {
    if (fileDraft !== fileOriginal && !window.confirm('ยังมีการแก้ไขที่ยังไม่ได้บันทึก ปิดเลยไหม?')) return;
    setSelectedFile('');
    setOpenFiles([]);
    setFileError('');
  };

  const closeEditorTab = (filePath: string) => {
    if (filePath === selectedFile && fileDraft !== fileOriginal && !window.confirm('ยังมีการแก้ไขที่ยังไม่ได้บันทึก ปิดแท็บนี้ไหม?')) return;
    const remaining = openFiles.filter(item => item !== filePath);
    setOpenFiles(remaining);
    if (filePath !== selectedFile) return;
    if (!remaining.length) {
      setSelectedFile('');
      return;
    }
    setSelectedFile('');
    void openFile(remaining[remaining.length - 1], true);
  };

  const projectName = basename(workspaceDir);
  const recent = recentWorkspaces.filter(item => item !== workspaceDir);
  const statusText = lastRun && !busy
    ? runLabel(lastRun.status) + (formatDuration(lastRun.durationMs) ? ' · ' + formatDuration(lastRun.durationMs) : '')
    : statusLabel(status, connected);

  return (
    <div className="alisa-shell flex h-full min-h-0 flex-col overflow-hidden bg-[#0b0d12] text-slate-200">
      <header className="alisa-topbar relative z-20 flex h-14 shrink-0 items-center justify-between border-b border-white/[0.08] px-3 md:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <IconButton label="Toggle chats panel" onClick={() => setSidebarOpen(value => !value)}><PanelLeft className="h-4 w-4" /></IconButton>
          <AlisaLogo size={29} showText textClassName="hidden sm:flex" />
          <span className="rounded-md border border-pink-200/15 bg-pink-300/[0.08] px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.12em] text-pink-200">V2</span>
          <span className="mx-1 hidden h-5 w-px bg-white/10 sm:block" />
          <div className="relative min-w-0">
            <button type="button" onClick={() => setShowProjectMenu(value => !value)} className="flex max-w-[240px] items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-white/[0.06]">
              <FolderOpen className="h-4 w-4 shrink-0 text-sky-300" />
              <span className="truncate text-xs font-medium text-slate-200">{projectName || 'Select project'}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            </button>
            {showProjectMenu && (
              <div className="project-menu-enter absolute left-0 top-11 z-50 w-80 rounded-2xl border border-white/10 bg-[#171b25]/[0.98] p-2 shadow-2xl shadow-black/40">
                <button type="button" onClick={() => void chooseWorkspace()} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs text-slate-200 hover:bg-white/[0.07]">
                  <Plus className="h-4 w-4 text-pink-300" /> Open another project
                </button>
                <div className="my-1 border-t border-white/[0.07]" />
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-slate-600">Recent projects</div>
                {recent.length ? recent.map(item => (
                  <button key={item} type="button" onClick={() => void chooseWorkspace(item)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-slate-400 hover:bg-white/[0.07] hover:text-white">
                    <Folder className="h-3.5 w-3.5 text-slate-500" /><span className="min-w-0 flex-1 truncate">{shortPath(item, 48)}</span>
                  </button>
                )) : <div className="px-3 py-2 text-xs text-slate-600">No other projects yet</div>}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="hidden items-center gap-1.5 rounded-full border border-white/[0.08] px-2.5 py-1.5 text-[10px] text-slate-500 lg:flex">
            <span className={'h-1.5 w-1.5 rounded-full ' + statusColor(status, connected)} />
            <span>{statusText}</span>
            <span className="text-slate-700">· ctx {contextUsage.percent}%</span>
          </div>
          <select value={mode} onChange={event => setMode(event.target.value as AgentMode)} className="hidden max-w-[110px] rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-[11px] text-slate-300 outline-none hover:bg-white/[0.08] md:block">
            {MODES.map(item => <option key={item.id} value={item.id} className="bg-[#171b25]">{item.label}</option>)}
          </select>
          <button type="button" onClick={() => void toggleSwarm()} disabled={busy} aria-label="Toggle agent swarm" title="Toggle staged multi-agent swarm" className={'hidden rounded-lg border px-2 py-1.5 text-[10px] uppercase tracking-[0.12em] md:block ' + (swarmEnabled ? 'border-violet-300/25 bg-violet-300/10 text-violet-200' : 'border-white/[0.08] text-slate-600 hover:bg-white/[0.06] hover:text-slate-300')}>
            {swarmEnabled ? 'Swarm' : 'Solo'}
          </button>
          <button type="button" onClick={() => void toggleYolo()} disabled={busy || yoloSaving} aria-label="Toggle YOLO mode" title={yoloMode ? 'YOLO enabled: approval-gated tools run without confirmation' : 'Safe mode: approval-gated tools ask before running'} className={'hidden rounded-lg border px-2 py-1.5 text-[10px] uppercase tracking-[0.12em] md:block ' + (yoloMode ? 'border-rose-300/30 bg-rose-300/10 text-rose-200' : 'border-white/[0.08] text-slate-600 hover:bg-white/[0.06] hover:text-slate-300')}>
            {yoloMode ? 'YOLO' : 'Safe'}
          </button>
          <div className="flex min-w-0 items-center gap-1.5">
            <select value={activeProviderId} onChange={event => void switchProvider(event.target.value)} aria-label="Provider" className="hidden max-w-[130px] rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-[11px] text-slate-300 outline-none hover:bg-white/[0.08] lg:block">
              {providers.map(provider => <option key={provider.id} value={provider.id} className="bg-[#171b25]">{provider.name}</option>)}
            </select>
            <div
              ref={modelMenuRef}
              className="relative min-w-0"
              onBlur={event => {
                const nextFocus = event.relatedTarget as Node | null;
                if (!nextFocus || !event.currentTarget.contains(nextFocus)) {
                  window.setTimeout(() => { setModelMenuOpen(false); setModelMenuQuery(''); }, 120);
                  void commitModel();
                }
              }}
            >
              <div className="alisa-model-control flex min-w-0 max-w-[250px] items-center rounded-lg border border-white/[0.08] bg-white/[0.04]">
                <input
                  ref={modelInputRef}
                  value={modelDraft}
                  onChange={event => { setModelDraft(event.target.value); setModelMenuQuery(event.target.value); }}
                  onFocus={() => { setModelMenuOpen(true); setModelMenuQuery(''); }}
                  onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void commitModel(); } if (event.key === 'Escape') { setModelDraft(model); setModelMenuOpen(false); event.currentTarget.blur(); } }}
                  aria-label="Model"
                  aria-haspopup="listbox"
                  aria-expanded={modelMenuOpen}
                  title={modelError || 'Choose or type an OmniRouter model route'}
                  placeholder="model"
                  disabled={!activeProviderId || busy}
                  className="min-w-0 flex-1 bg-transparent px-2 py-1.5 font-mono text-[11px] text-slate-300 outline-none placeholder:text-slate-600 disabled:opacity-50"
                />
                <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => { setModelMenuOpen(value => !value); setModelMenuQuery(''); }} disabled={!activeProviderId || busy} aria-label="Open model list" title="Open model list" className="rounded p-1 text-slate-600 hover:bg-white/[0.08] hover:text-slate-300 disabled:opacity-40">
                  <ChevronDown className="h-3 w-3" />
                </button>
                <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => void loadProviderModels(activeProviderId, true)} disabled={!activeProviderId || modelLoading || busy} aria-label="Refresh model list" title="Refresh model list" className="mr-1 rounded p-1 text-slate-600 hover:bg-white/[0.08] hover:text-slate-300 disabled:opacity-40">
                  <RefreshCcw className={'h-3 w-3 ' + (modelLoading ? 'alisa-spinner' : '')} />
                </button>
              </div>
              {modelMenuOpen && (
                <div className="model-menu absolute right-0 top-[calc(100%+6px)] z-50 w-[min(360px,calc(100vw-24px))] border border-[#242424] bg-[#080808] p-1.5" role="listbox" aria-label="Available OmniRouter models">
                  <div className="flex items-center justify-between border-b border-[#1a1a1a] px-2 py-1.5 text-[10px] text-[#666]">
                    <span className="uppercase tracking-[0.14em]">OmniRouter models</span>
                    <span>{activeModelOptions.length} routes</span>
                  </div>
                  <div className="max-h-64 overflow-y-auto py-1">
                    {visibleModelOptions.length ? visibleModelOptions.map(option => (
                      <button
                        key={option}
                        type="button"
                        role="option"
                        aria-selected={option === model}
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => { setModelMenuOpen(false); setModelMenuQuery(''); void commitModel(option); }}
                        className={'flex w-full items-center gap-2 px-2 py-1.5 text-left font-mono text-[11px] transition ' + (option === model ? 'bg-[#151515] text-[#f2f2f2]' : 'text-[#999] hover:bg-[#111] hover:text-[#f2f2f2]')}
                      >
                        <span className={'terminal-status ' + (option === model ? 'terminal-success' : 'text-[#444]')}>{option === model ? '✓' : '·'}</span>
                        <span className="min-w-0 flex-1 truncate">{option}</span>
                      </button>
                    )) : <div className="px-2 py-2 text-[11px] text-[#666]">{modelLoading ? 'Loading model routes…' : modelError || 'No matching model route'}</div>}
                  </div>
                  <div className="border-t border-[#1a1a1a] px-2 py-1.5 text-[10px] text-[#444]">Choose a route or type a custom OmniRouter model ID</div>
                </div>
              )}
            </div>
          </div>
          <IconButton
            label={showYurachiCompanion ? 'Hide Yurachi companion' : 'Show Yurachi companion in right menu'}
            active={showYurachiCompanion && inspectorOpen}
            onClick={() => {
              if (!showYurachiCompanion) {
                setShowYurachiCompanion(true);
                setInspectorOpen(true);
                notify('Yurachi companion docked in right menu');
              } else if (!inspectorOpen) {
                setInspectorOpen(true);
                notify('Opened right menu with Yurachi companion');
              } else {
                setShowYurachiCompanion(false);
                notify('Yurachi companion hidden');
              }
            }}
          >
            <Sparkles className="h-4 w-4" />
          </IconButton>
          <IconButton label="Open integrated terminal · Ctrl/Cmd + `" active={terminalOpen} onClick={() => setTerminalOpen(value => !value)}><Terminal className="h-4 w-4" /></IconButton>
          <IconButton label="Open project files" onClick={() => { setSidebarOpen(true); setSidebarTab('files'); }}><FolderOpen className="h-4 w-4" /></IconButton>
          <IconButton label="Provider and workspace settings" onClick={() => openSettings()}><Settings2 className="h-4 w-4" /></IconButton>
          <IconButton label="Toggle inspector" onClick={() => setInspectorOpen(value => !value)}><PanelRight className="h-4 w-4" /></IconButton>
          {!connected ? <WifiOff className="ml-1 h-4 w-4 text-rose-300" /> : <Wifi className="ml-1 h-4 w-4 text-emerald-300" />}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
          <aside className={'alisa-sidebar flex shrink-0 flex-col overflow-hidden border-r border-white/[0.08] bg-[#11151d]/90 transition-[width,opacity] duration-200 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:shadow-2xl ' + (sidebarOpen ? 'w-[280px] opacity-100' : 'w-0 opacity-0')}>
          <div className="flex items-center gap-2 p-3">
            <button type="button" onClick={() => void newChat()} disabled={busy} className="alisa-primary-action flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border border-transparent px-3 py-2.5 text-xs font-semibold text-[#171923] transition disabled:cursor-not-allowed disabled:opacity-50">
              <Plus className="h-4 w-4" /> New chat
            </button>
            <IconButton label="Collapse chats panel" onClick={() => setSidebarOpen(false)}><PanelLeft className="h-4 w-4" /></IconButton>
          </div>
          <div className="px-3 pb-2">
            <label className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2 text-xs text-slate-500">
              <Search className="h-3.5 w-3.5 shrink-0" />
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search chats" className="min-w-0 flex-1 bg-transparent text-xs text-slate-200 outline-none placeholder:text-slate-600" />
              {search && <button type="button" onClick={() => setSearch('')}><X className="h-3.5 w-3.5" /></button>}
            </label>
          </div>
          <div className="flex items-center gap-1 border-b border-white/[0.07] px-3 pb-2">
            {(['chats', 'files'] as SidebarTab[]).map(tab => (
              <button key={tab} type="button" onClick={() => setSidebarTab(tab)} className={'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] capitalize transition ' + (sidebarTab === tab ? 'bg-white/[0.08] text-white' : 'text-slate-500 hover:text-slate-300')}>
                {tab === 'chats' ? <MessageSquare className="h-3.5 w-3.5" /> : <Folder className="h-3.5 w-3.5" />}{tab}
              </button>
            ))}
            {sidebarTab === 'chats' && <button type="button" onClick={() => setShowArchived(value => !value)} className={'ml-auto rounded-lg p-1.5 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200 ' + (showArchived ? 'bg-white/[0.08] text-white' : '')} title="Show archived chats"><Archive className="h-3.5 w-3.5" /></button>}
            {sidebarTab === 'files' && <div className="ml-auto flex items-center gap-0.5"><IconButton label="New file" onClick={() => void createWorkspaceEntry(false)}><FilePlus2 className="h-3.5 w-3.5" /></IconButton><IconButton label="New folder" onClick={() => void createWorkspaceEntry(true)}><FolderPlus className="h-3.5 w-3.5" /></IconButton><IconButton label="Refresh project files" onClick={() => void loadFiles()}><RefreshCcw className="h-3.5 w-3.5" /></IconButton></div>}
          </div>
          <div className="tab-scroll min-h-0 flex-1 overflow-y-auto p-2">
            {sidebarTab === 'chats' ? (
              <div className="space-y-1">
                {sessions.filter(item => showArchived || !item.archived).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt).map(item => (
                  <div key={item.id} className={'group flex items-center gap-1 rounded-xl border px-2 py-1.5 transition ' + (item.id === sessionId ? 'alisa-session-current border-sky-200/15 bg-sky-300/[0.08]' : 'border-transparent hover:border-white/[0.06] hover:bg-white/[0.04]')}>
                    <button type="button" disabled={busy} onClick={() => void selectSession(item.id)} className="min-w-0 flex-1 px-1 text-left disabled:opacity-50">
                      <div className="flex items-center gap-1.5">
                        {item.pinned && <Pin className="h-3 w-3 shrink-0 text-pink-300" />}
                        <span className="truncate text-xs text-slate-300">{item.title || 'New chat'}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-600"><Clock3 className="h-3 w-3" />{formatRelativeTime(item.updatedAt)}{item.messageCount ? <span>· {item.messageCount} msgs</span> : null}</div>
                    </button>
                    <div className="hidden items-center gap-0.5 group-hover:flex">
                      <IconButton label={item.pinned ? 'Unpin chat' : 'Pin chat'} onClick={() => void sessionAction(item.id, item.pinned ? 'unpin' : 'pin')}><Pin className="h-3 w-3" /></IconButton>
                      <IconButton label="Rename chat" onClick={() => void sessionAction(item.id, 'rename')}><Pencil className="h-3 w-3" /></IconButton>
                      <IconButton label={item.archived ? 'Restore chat' : 'Archive chat'} onClick={() => void sessionAction(item.id, item.archived ? 'restore' : 'archive')}><Archive className="h-3 w-3" /></IconButton>
                    </div>
                  </div>
                ))}
                {!sessions.length && <div className="px-3 py-10 text-center text-xs leading-5 text-slate-600">ยังไม่มีแชต<br />สร้างแชตแรกเพื่อเริ่มงาน</div>}
              </div>
            ) : (
              <div>
                <div className="mb-2 flex items-center justify-between px-2 text-[10px] uppercase tracking-[0.16em] text-slate-600"><span>Project files</span><span className="text-slate-700">IDE</span></div>
                <div className="mb-2 flex items-center gap-2 rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2 text-xs text-slate-500">
                  <Search className="h-3.5 w-3.5" /><input value={fileSearch} onChange={event => setFileSearch(event.target.value)} placeholder="Filter files" className="min-w-0 flex-1 bg-transparent text-xs text-slate-300 outline-none placeholder:text-slate-600" />
                </div>
                <FileTree nodes={fileTree} query={fileSearch} onOpen={path => void openFile(path)} />
                {!fileTree.length && <div className="px-3 py-10 text-center text-xs text-slate-600">No files found</div>}
              </div>
            )}
          </div>
          <div className="border-t border-white/[0.07] p-3">
            <div className="flex items-center gap-2 rounded-xl bg-black/20 px-3 py-2">
              <div className={'h-2 w-2 rounded-full ' + statusColor(status, connected)} />
              <div className="min-w-0 flex-1"><div className="truncate text-[11px] text-slate-300">{shortPath(workspaceDir, 31)}</div><div className="text-[10px] text-slate-600">{currentMode.label} · {model || 'No model'}</div></div>
              <button type="button" onClick={() => void loadFiles()} title="Refresh project" className="text-slate-600 hover:text-slate-300"><RefreshCcw className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        </aside>

        <main className="alisa-main relative flex min-w-0 flex-1 flex-col bg-[#0b0d12]/70">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/[0.06] px-4 md:px-8">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2"><h1 className="truncate text-sm font-semibold text-slate-200">{sessionTitle}</h1>{mode !== 'code' && <span className="shrink-0 rounded-full bg-violet-300/10 px-2 py-0.5 text-[10px] text-violet-200">{currentMode.label}</span>}{swarmEnabled && <button type="button" onClick={() => { setInspectorTab('agents'); setInspectorOpen(true); }} className="shrink-0 rounded-full bg-violet-300/10 px-2 py-0.5 text-[10px] text-violet-200">SWARM</button>}{goal && <button type="button" onClick={() => { setInspectorTab('goal'); setInspectorOpen(true); }} className="flex min-w-0 shrink items-center gap-1 rounded-full bg-sky-300/10 px-2 py-0.5 text-[10px] text-sky-200"><Target className="h-3 w-3 shrink-0" /><span className="max-w-[180px] truncate">{goal.title} · {goal.progress}%</span></button>}</div>
              <div className="truncate text-[10px] text-slate-600">{shortPath(workspaceDir, 72)}</div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setWebPreviewOpen(prev => !prev)}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-medium transition ${
                  webPreviewOpen
                    ? 'bg-sky-500/25 text-sky-200 border border-sky-500/30'
                    : 'bg-white/[0.04] text-slate-400 hover:text-slate-200 hover:bg-white/[0.08]'
                }`}
                title="Toggle live in-app localhost web preview (/preview)"
              >
                <Globe className="h-3 w-3 text-sky-400" />
                <span className="hidden sm:inline">Live Preview</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = !showYurachiCompanion;
                  setShowYurachiCompanion(next);
                  notify(next ? 'Yurachi companion shown' : 'Yurachi companion hidden');
                }}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-medium transition ${
                  showYurachiCompanion
                    ? 'bg-pink-500/20 text-pink-200 border border-pink-500/35 shadow-[0_0_10px_rgba(239,143,189,0.2)]'
                    : 'bg-white/[0.04] text-slate-400 hover:text-slate-200 hover:bg-white/[0.08]'
                }`}
                title="Toggle Yurachi Chibi & Swarm Panel in bottom-right (/character)"
              >
                <span className="text-pink-400">✦</span>
                <span>Yurachi</span>
              </button>
              {git?.branch && <span className="hidden items-center gap-1 rounded-lg bg-white/[0.04] px-2 py-1 text-[10px] text-slate-500 sm:flex"><GitBranch className="h-3 w-3" />{git.branch}</span>}
              {changedFiles.length > 0 && <button type="button" onClick={() => setSelectedDiffFile(changedFiles[0])} className="rounded-lg bg-amber-300/10 px-2 py-1 text-[10px] text-amber-200 hover:bg-amber-300/15" title="Review side-by-side diff">{changedFiles.length} change{changedFiles.length === 1 ? '' : 's'}</button>}
              {!sidebarOpen && <IconButton label="Open chats panel" onClick={() => setSidebarOpen(true)}><PanelLeft className="h-4 w-4" /></IconButton>}
            </div>
          </div>
          <div ref={chatScrollRef} onScroll={handleChatScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-7 md:px-10">
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-7">
              {workspaceError && <div className="flex items-start gap-2 rounded-xl border border-rose-300/15 bg-rose-300/[0.07] px-3 py-2 text-xs text-rose-200"><WifiOff className="mt-0.5 h-4 w-4 shrink-0" /><span>{workspaceError}</span></div>}
              {!chatMessages.length && !streamingContent && (
                <div className="terminal-empty flex min-h-[45vh] flex-col items-center justify-center text-center">
                  <button
                    type="button"
                    onClick={() => setTemplateModalOpen(true)}
                    className="mt-5 inline-flex items-center gap-2 rounded-full border border-pink-500/30 bg-pink-500/10 px-4 py-1.5 text-xs font-semibold text-pink-200 hover:bg-pink-500/20 transition shadow-[0_2px_15px_rgba(239,143,189,0.25)] hover:scale-105"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-pink-400" />
                    <span>Start New Project from Template ✦</span>
                  </button>
                  <div className="mt-5 mb-3 text-[11px] uppercase tracking-[0.28em] text-slate-600">ALISA CODE · V2</div>
                  <h2 className="text-lg font-medium tracking-tight text-slate-200">{projectName || 'Project workspace'}</h2>
                  <p className="mt-2 max-w-md text-xs leading-6 text-slate-600">terminal-first AI coding workspace · type a prompt or / for commands</p>
                  <div className="terminal-command-hints mt-7 grid gap-x-8 gap-y-1 text-left text-[11px] sm:grid-cols-2">
                    {[
                      ['/help', 'show commands'],
                      ['/diff', 'review visual file diffs'],
                      ['/preview', 'open live web preview'],
                      ['/templates', '1-click project starters'],
                      ['/models', 'select model route'],
                      ['/terminal', 'open local / SSH terminal'],
                      ['/character', 'show or hide Yurachi'],
                      ['@file', 'reference a project file'],
                    ].map(([title, detail]) => <button key={title} type="button" onClick={() => { setInput(title.startsWith('/') ? title : '@'); textareaRef.current?.focus(); }} className="terminal-command-hint text-left transition hover:text-slate-200"><span className="text-slate-300">{title}</span><span className="ml-3 text-slate-700">{detail}</span></button>)}
                  </div>
                </div>
              )}
              {chatMessages.map(message => <MessageBubble key={message.id} message={message} messages={messages} tools={toolRuns} onRetryTask={retryLastPrompt} onOpenModelMenu={() => modelInputRef.current?.focus()} />)}
              {streamingContent && <MessageBubble message={{ id: 'streaming', role: 'assistant', content: streamingContent, timestamp: Date.now() }} messages={messages} tools={toolRuns} isStreaming onRetryTask={retryLastPrompt} onOpenModelMenu={() => modelInputRef.current?.focus()} />}
              {streamingThought && <div className="terminal-thought ml-5 border-l border-violet-300/20 pl-3 text-xs text-violet-200/60"><span className="mr-2 text-[10px] uppercase tracking-widest text-violet-300/50">Thought</span>{streamingThought}</div>}
              {busy && !streamingContent && !streamingThought && <div className="terminal-working text-xs text-slate-500"><span className="terminal-status terminal-running">●</span><span>{statusDetail || 'Working…'}</span></div>}
              {approval && (
                <div className="terminal-approval border-l border-amber-300/50 pl-4 text-xs">
                  <div className="flex items-center gap-2 text-amber-200"><ShieldCheck className="h-4 w-4" /><span>Permission required · {approval.action}</span></div>
                  <div className="mt-2 text-slate-500">The agent wants to execute:</div>
                  <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-5 text-slate-400">{JSON.stringify(approval.details, null, 2)}</pre>
                  <div className="mt-3 flex gap-3"><button type="button" onClick={() => respondApproval(true)} className="text-amber-200 hover:text-amber-100">[1] Allow once</button><button type="button" onClick={() => respondApproval(false)} className="text-slate-500 hover:text-slate-200">[3] Deny</button></div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          </div>
          {!autoFollow && <button type="button" onClick={() => { setAutoFollow(true); window.requestAnimationFrame(() => { const scroller = chatScrollRef.current; if (scroller) scroller.scrollTop = scroller.scrollHeight; }); }} className="terminal-jump absolute bottom-28 left-1/2 z-10 -translate-x-1/2 border border-white/15 bg-black px-3 py-1.5 text-[11px] text-slate-300 hover:border-white/30">↓ Jump to latest</button>}
          <div className="shrink-0 px-4 pb-4 md:px-10 md:pb-6">
            <form onSubmit={sendPrompt} className="terminal-composer relative mx-auto max-w-4xl border border-white/[0.12] bg-[#171b25]/80 p-2 shadow-2xl shadow-black/20">
              {slashMatches.length > 0 && <div className="terminal-autocomplete absolute bottom-full left-0 right-0 z-20 mb-2 border border-white/10 bg-black p-1"><div className="px-2 py-1 text-[10px] text-slate-700">Commands · ↑ ↓ Enter</div>{slashMatches.map((command, index) => <button key={command.id} type="button" onClick={() => runSlashCommand(command.id)} className={'flex w-full items-center gap-3 px-2 py-1.5 text-left text-xs ' + (index === slashIndex ? 'bg-white/[0.08] text-slate-100' : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-200')}><span className="w-20 text-slate-300">{command.label}</span><span>{command.detail}</span></button>)}</div>}
              {fileReferenceOptions.length > 0 && <div className="terminal-autocomplete absolute bottom-full left-0 right-0 z-20 mb-2 border border-white/10 bg-black p-1"><div className="px-2 py-1 text-[10px] text-slate-700">Files · ↑ ↓ Enter</div>{fileReferenceOptions.map((file, index) => <button key={file.path} type="button" onClick={() => insertFileReference(file.path)} className={'flex w-full items-center gap-3 px-2 py-1.5 text-left text-xs ' + (index === fileReferenceIndex ? 'bg-white/[0.08] text-slate-100' : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-200')}><span className="w-4 text-slate-700">@</span><span className="truncate">{file.path}</span></button>)}</div>}
              <textarea ref={textareaRef} value={input} onChange={event => { setInput(event.target.value); setSlashIndex(0); setFileReferenceIndex(0); }} onKeyDown={handleComposerKeyDown} disabled={!connected || busy} rows={3} placeholder={connected ? '> Ask anything…' : '> Waiting for backend…'} className="w-full resize-none bg-transparent px-3 py-2 font-mono text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-600 disabled:cursor-not-allowed" />
              <div className="flex items-center justify-between gap-2 px-2 pb-1">
                <div className="flex min-w-0 items-center gap-3 text-[10px] text-slate-600"><span className="text-slate-400">{swarmEnabled ? 'Swarm' : currentMode.label}</span><span className={yoloMode ? 'text-rose-200' : 'text-slate-600'}>{yoloMode ? 'YOLO · no confirm' : 'confirm actions'}</span><span className="hidden truncate sm:inline">{activeProvider?.name || 'Provider'} / {model || 'No model'}</span><span className="hidden lg:inline">ctx {formatTokenCount(contextUsage.usedTokens)}/{formatTokenCount(contextUsage.maxTokens)} · {contextUsage.percent}%</span><span className="hidden md:inline">⌘/Ctrl + Enter</span><span className="hidden xl:inline">{connected ? 'connected' : 'offline'}</span></div>
                <div className="flex items-center gap-1.5"><button type="button" onClick={() => setInput(previous => previous ? previous + '\n\nPlease use a checklist and verify the result.' : 'Please use a checklist and verify the result.')} className="hidden rounded-lg p-2 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200 sm:block" title="Add verification instruction"><Sparkles className="h-4 w-4" /></button>{busy ? <button type="button" onClick={stopTask} className="flex items-center gap-1.5 rounded-xl bg-rose-300/15 px-3 py-2 text-xs text-rose-200 hover:bg-rose-300/25"><Square className="h-3 w-3 fill-current" /> Stop</button> : <button type="submit" disabled={!input.trim() || !connected} className="alisa-primary-action flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"><Send className="h-3.5 w-3.5" /> Send</button>}</div>
              </div>
            </form>
          </div>
          {/* If inspector is closed, keep Chibi visible at bottom-right corner as a floating companion */}
          {!inspectorOpen && showYurachiCompanion && (
            <ChibiSwarmPanel
              docked={false}
              status={status}
              statusDetail={statusDetail}
              busy={busy}
              lastRunStatus={lastRun?.status}
              companionPose={companionPose}
              companionSrc={companion.src}
              companionLabel={companion.label}
              toolName={toolRuns.at(-1)?.toolName}
              activeGoal={goal?.title}
              swarmEnabled={swarmEnabled}
              swarmAgents={swarmAgents}
              swarmPhase={swarmPhase}
              onToggleSwarm={() => setSwarmEnabled(prev => !prev)}
              onOpenSwarmInspector={() => {
                setInspectorOpen(true);
                setInspectorTab('agents');
              }}
              onOpenSettings={() => openSettings()}
              onClose={() => {
                setShowYurachiCompanion(false);
                notify('Yurachi companion hidden');
              }}
            />
          )}
        </main>

        <aside className={'alisa-inspector flex shrink-0 flex-col overflow-hidden border-l border-white/[0.08] bg-[#11151d]/90 transition-[width,opacity] duration-200 max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-30 max-md:shadow-2xl ' + (inspectorOpen ? 'w-[310px] opacity-100' : 'w-0 opacity-0')}>
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/[0.07] px-3">
            <div className="tab-scroll flex min-w-0 items-center gap-1 overflow-x-auto">
              {(['plan', 'goal', 'agents', 'context', 'changes', 'activity'] as InspectorTab[]).map(tab => <button key={tab} type="button" onClick={() => setInspectorTab(tab)} className={'shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] capitalize ' + (inspectorTab === tab ? 'bg-white/[0.08] text-slate-100' : 'text-slate-500 hover:text-slate-300')}>{tab}</button>)}
            </div>
            <IconButton label="Close inspector" onClick={() => setInspectorOpen(false)}><PanelRight className="h-4 w-4" /></IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {inspectorTab === 'plan' && <div className="space-y-4"><div><div className="flex items-center justify-between"><div className="flex items-center gap-2 text-xs font-medium text-slate-200"><Sparkles className="h-3.5 w-3.5 text-pink-300" />Task plan</div>{plan.length > 0 && <span className="text-[10px] text-slate-600">{plan.filter(item => item.status === 'completed').length}/{plan.length}</span>}</div><p className="mt-1 text-[10px] leading-4 text-slate-600">{currentMode.description}</p></div><PlanList items={plan} /><div className="rounded-xl border border-white/[0.07] bg-black/15 p-3"><div className="text-[10px] uppercase tracking-[0.15em] text-slate-600">Active model</div><div className="mt-1 truncate text-xs text-slate-300">{model || 'Not configured'}</div><div className="mt-3 text-[10px] uppercase tracking-[0.15em] text-slate-600">Provider</div><div className="mt-1 truncate text-xs text-slate-400">{activeProvider?.name || 'Not configured'}</div></div></div>}
            {inspectorTab === 'goal' && <div className="space-y-3"><div className="flex items-center gap-2 text-xs font-medium text-slate-200"><Target className="h-3.5 w-3.5 text-violet-200" />Persistent goal</div><p className="text-[10px] leading-4 text-slate-600">This goal follows the session and is included in every agent context.</p><input value={goalDraftTitle} onChange={event => setGoalDraftTitle(event.target.value)} disabled={busy || goalSaving} placeholder="Ship the new editor experience" className="w-full rounded-lg border border-white/[0.09] bg-black/20 px-2.5 py-2 text-xs text-slate-200 outline-none focus:border-violet-200/30 disabled:opacity-50" /><textarea value={goalDraftDescription} onChange={event => setGoalDraftDescription(event.target.value)} disabled={busy || goalSaving} rows={3} placeholder="What does done look like?" className="w-full resize-none rounded-lg border border-white/[0.09] bg-black/20 px-2.5 py-2 text-[11px] leading-5 text-slate-300 outline-none focus:border-violet-200/30 disabled:opacity-50" /><div className="grid grid-cols-2 gap-2"><label className="text-[10px] text-slate-600">Status<select value={goalDraftStatus} onChange={event => setGoalDraftStatus(event.target.value as GoalStatus)} disabled={busy || goalSaving} className="mt-1 w-full rounded-lg border border-white/[0.09] bg-black/20 px-2 py-2 text-[11px] text-slate-300 outline-none disabled:opacity-50"><option value="active">Active</option><option value="paused">Paused</option><option value="blocked">Blocked</option><option value="completed">Completed</option></select></label><label className="text-[10px] text-slate-600">Progress · {goalDraftProgress}%<input type="range" min="0" max="100" value={goalDraftProgress} onChange={event => setGoalDraftProgress(event.target.value)} disabled={busy || goalSaving} className="mt-3 w-full accent-violet-300 disabled:opacity-50" /></label></div><div className="flex gap-2"><button type="button" onClick={() => void saveGoal()} disabled={busy || goalSaving || !goalDraftTitle.trim()} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-300/15 px-3 py-2 text-[11px] text-violet-100 hover:bg-violet-300/25 disabled:opacity-40"><Save className="h-3.5 w-3.5" />{goalSaving ? 'Saving…' : 'Save goal'}</button><button type="button" onClick={() => void clearGoal()} disabled={busy || goalSaving || !goal} className="rounded-lg border border-white/[0.08] px-3 py-2 text-[11px] text-slate-500 hover:text-slate-200 disabled:opacity-40">Clear</button></div>{goal?.steps?.length ? <div className="border-t border-white/[0.07] pt-3"><div className="mb-2 text-[10px] uppercase tracking-[0.15em] text-slate-600">Goal steps</div><PlanList items={goal.steps} compact /></div> : <div className="border-l border-violet-300/20 pl-3 text-[10px] leading-5 text-slate-600">The Planner or Builder can add milestone steps with update_goal.</div>}</div>}
            {inspectorTab === 'agents' && <div className="space-y-3"><div className="flex items-center gap-2 text-xs font-medium text-slate-200"><Users className="h-3.5 w-3.5 text-violet-200" />Agent swarm</div><div className="flex items-center justify-between text-[10px] text-slate-600"><span>{swarmEnabled ? 'Staged execution · shared workspace' : 'Single agent execution'}</span><span>{swarmAgents.filter(agent => agent.status === 'done').length}/{swarmAgents.length || 4}</span></div>{swarmAgents.length ? <div className="space-y-1">{swarmAgents.map(agent => <div key={agent.id} className="border-l border-white/[0.08] px-2.5 py-2"><div className="flex items-center gap-2 text-[11px] text-slate-300"><span className={'terminal-status ' + (agent.status === 'done' ? 'terminal-success' : agent.status === 'error' ? 'terminal-error' : agent.status === 'working' ? 'terminal-running' : 'text-slate-700')}>{agent.status === 'done' ? '✓' : agent.status === 'error' ? '×' : agent.status === 'working' ? '●' : '○'}</span><Bot className="h-3.5 w-3.5 text-slate-600" /><span className="flex-1">{agent.label}</span><span className="text-[9px] uppercase tracking-[0.12em] text-slate-700">{agent.status}</span></div>{agent.detail && <div className="mt-1 truncate pl-7 text-[9px] text-slate-600">{agent.detail}</div>}{agent.durationMs !== undefined && <div className="mt-1 pl-7 text-[9px] text-slate-700">{formatDuration(agent.durationMs)}</div>}</div>)}</div> : <div className="border-l border-white/[0.08] pl-3 text-[10px] leading-5 text-slate-600">Enable Swarm to run Explorer → Planner → Builder → Reviewer in one task. Each role reports into this session.</div>}{swarmPhase && <div className="border-t border-white/[0.07] pt-3 text-[10px] text-slate-600">{swarmPhase}</div>}</div>}
            {inspectorTab === 'context' && <div className="space-y-4"><div className="flex items-center gap-2 text-xs font-medium text-slate-200"><Gauge className="h-3.5 w-3.5 text-sky-200" />Context window</div><div><div className="flex items-center justify-between text-[10px] text-slate-500"><span>{formatTokenCount(contextUsage.usedTokens)} used</span><span>{formatTokenCount(contextUsage.maxTokens)} max</span></div><div className="mt-2 h-1 bg-white/[0.08]"><div className={'h-full ' + (contextUsage.percent >= 85 ? 'bg-rose-300' : contextUsage.percent >= 65 ? 'bg-amber-300' : 'bg-sky-300')} style={{ width: Math.min(100, contextUsage.percent) + '%' }} /></div><div className="mt-2 text-right font-mono text-[11px] text-slate-300">{contextUsage.percent}%</div></div><div className="border-t border-white/[0.07] pt-3"><div className="text-[10px] uppercase tracking-[0.15em] text-slate-600">Model route</div><div className="mt-1 break-all font-mono text-[11px] text-slate-300">{model || 'Not configured'}</div><div className="mt-3 text-[10px] uppercase tracking-[0.15em] text-slate-600">Window source</div><div className="mt-1 text-[10px] leading-5 text-slate-500">{modelContextWindows[model] ? 'Provider model metadata' : 'Safe estimate until provider metadata is loaded'}</div></div><div className="border-l border-sky-300/20 pl-3 text-[10px] leading-5 text-slate-600">Context usage is an estimate based on the prepared transcript and tool calls. Automatic compaction protects long-running sessions.</div></div>}
            {inspectorTab === 'changes' && <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-200">
                  <Code2 className="h-3.5 w-3.5 text-amber-200" />
                  <span>Changes</span>
                </div>
                <div className="flex items-center gap-1">
                  {changedFiles.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedDiffFile(changedFiles[0])}
                      className="rounded-lg bg-sky-500/20 px-2 py-1 text-[10px] font-medium text-sky-200 hover:bg-sky-500/30 transition"
                      title="Review side-by-side diff"
                    >
                      Side-by-Side Diff
                    </button>
                  )}
                  <IconButton label="Refresh changes" onClick={() => void loadFiles()}><RefreshCcw className="h-3.5 w-3.5" /></IconButton>
                </div>
              </div>
              {changedFiles.length ? (
                <div className="space-y-1">
                  {changedFiles.map(file => (
                    <div key={file} className="flex items-center gap-1 rounded-lg bg-white/[0.02] p-1 hover:bg-white/[0.05]">
                      <button
                        type="button"
                        onClick={() => setSelectedDiffFile(file)}
                        className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-left text-xs text-slate-300 hover:text-white"
                        title="Click to view visual side-by-side diff"
                      >
                        <FileCode2 className="h-3.5 w-3.5 text-amber-300 shrink-0" />
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{file}</span>
                        <span className="shrink-0 text-[10px] text-sky-400 font-medium">Diff</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void openFile(file)}
                        className="rounded p-1 text-slate-500 hover:text-slate-200 hover:bg-white/10"
                        title="Open in Code Editor"
                      >
                        <ArrowUpRight className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-white/10 px-3 py-5 text-center text-xs text-slate-600">
                  Working tree clean
                </div>
              )}
              {git?.diff && (
                <details className="rounded-xl border border-white/[0.07] bg-black/20">
                  <summary className="cursor-pointer px-3 py-2 text-[10px] text-slate-500 hover:text-slate-300">
                    Raw Git Diff
                  </summary>
                  <pre className="max-h-80 overflow-auto border-t border-white/[0.06] p-3 font-mono text-[10px] leading-5 text-slate-500 select-text">
                    {git.diff}
                  </pre>
                </details>
              )}
              <button
                type="button"
                onClick={async () => {
                  try {
                    const result = await api<{ success: boolean; message?: string }>('/api/rollback', { method: 'POST' });
                    notify(result.message || (result.success ? 'Rolled back latest changes' : 'Nothing to roll back'));
                    await loadFiles();
                  } catch (error) {
                    notify(errorText(error));
                  }
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] px-3 py-2 text-xs text-slate-400 hover:bg-white/[0.06] hover:text-white transition"
              >
                <Undo2 className="h-3.5 w-3.5" />
                <span>Roll back latest agent edit</span>
              </button>
            </div>}
            {inspectorTab === 'activity' && <div className="space-y-3"><div className="flex items-center gap-2 text-xs font-medium text-slate-200"><Activity className="h-3.5 w-3.5 text-sky-200" />Activity</div>{lastRun && <div className="border-l border-emerald-300/40 px-2.5 py-2"><div className="flex items-start gap-2 text-[11px] text-emerald-200"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300" /><span className="min-w-0 flex-1">Task {runLabel(lastRun.status).toLowerCase()}</span><span className="shrink-0 text-[9px] text-slate-700">{formatRelativeTime(lastRun.completedAt)}</span></div><div className="mt-1 pl-3.5 font-mono text-[9px] text-slate-500">{lastRun.detail || runLabel(lastRun.status)}{formatDuration(lastRun.durationMs) ? ' · ' + formatDuration(lastRun.durationMs) : ''}</div></div>}<div className="space-y-1">{activity.map(entry => <div key={entry.id} className="rounded-lg px-2.5 py-2 hover:bg-white/[0.04]"><div className="flex items-start gap-2 text-[11px] text-slate-400"><span className={'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ' + (entry.kind === 'error' ? 'bg-rose-300' : entry.kind === 'tool' ? 'bg-amber-300' : 'bg-sky-300')} /><span className="min-w-0 flex-1">{entry.label}</span><span className="shrink-0 text-[9px] text-slate-700">{formatRelativeTime(entry.timestamp)}</span></div>{entry.detail && <div className="mt-1 truncate pl-3.5 font-mono text-[9px] text-slate-600">{entry.detail}</div>}</div>)}{!activity.length && !lastRun && <div className="py-8 text-center text-xs text-slate-600">No activity yet</div>}</div><div className="border-t border-white/[0.07] pt-3"><div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] text-slate-600"><Terminal className="h-3 w-3" />Direct terminal</div><div className="flex gap-1.5"><input value={terminalCommand} onChange={event => setTerminalCommand(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void runTerminal(); }} placeholder="git status" className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-black/20 px-2.5 py-2 font-mono text-[10px] text-slate-300 outline-none placeholder:text-slate-700" /><button type="button" onClick={() => void runTerminal()} disabled={terminalRunning || !terminalCommand.trim()} className="rounded-lg bg-sky-300/15 px-2.5 text-sky-200 disabled:opacity-40"><Play className="h-3.5 w-3.5" /></button></div>{terminalOutput && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-2.5 font-mono text-[10px] leading-5 text-slate-500">{terminalOutput}</pre>}</div></div>}
          </div>

          {showYurachiCompanion && (
            <ChibiSwarmPanel
              docked={true}
              status={status}
              statusDetail={statusDetail}
              busy={busy}
              lastRunStatus={lastRun?.status}
              companionPose={companionPose}
              companionSrc={companion.src}
              companionLabel={companion.label}
              toolName={toolRuns.at(-1)?.toolName}
              activeGoal={goal?.title}
              swarmEnabled={swarmEnabled}
              swarmAgents={swarmAgents}
              swarmPhase={swarmPhase}
              onToggleSwarm={() => setSwarmEnabled(prev => !prev)}
              onOpenSwarmInspector={() => {
                setInspectorTab('agents');
              }}
              onOpenSettings={() => openSettings()}
              onClose={() => {
                setShowYurachiCompanion(false);
                notify('Yurachi companion hidden (click Sparkles in header or type /character to restore)');
              }}
            />
          )}
        </aside>
      </div>

      {workspaceTransition && <div className={'workspace-transition ' + (workspaceTransition.closing ? 'workspace-transition-exit' : '')} aria-live="polite" aria-label="Opening project">
        <div className="workspace-transition-inner">
          <div className="workspace-transition-title"><span className="workspace-transition-dot">●</span>{workspaceTransition.stage === 'ready' ? 'workspace ready' : 'opening project'}</div>
          <div className="workspace-transition-path">{shortPath(workspaceTransition.path, 72)}</div>
          <div className="workspace-transition-progress"><span /></div>
        </div>
      </div>}

      {terminalOpen && <TerminalPanel
        connected={connected}
        workspaceDir={workspaceDir}
        preferredKind={terminalPreferredKind}
        sessions={terminalSessions}
        activeSessionId={activeTerminalSessionId}
        error={terminalError}
        onStart={startTerminal}
        onSelect={setActiveTerminalSessionId}
        onStop={stopTerminal}
        onClear={clearTerminal}
        onSend={sendTerminalInput}
        onClose={() => setTerminalOpen(false)}
      />}

      {selectedFile && (
        <VscodeEditor
          selectedFile={selectedFile}
          openFiles={openFiles}
          draft={fileDraft}
          original={fileOriginal}
          nodes={fileTree}
          saving={fileSaving}
          error={fileError}
          onOpen={path => void openFile(path)}
          onSelectTab={path => void openFile(path)}
          onCloseTab={closeEditorTab}
          onChange={setFileDraft}
          onSave={() => void saveFile()}
          onClose={closeEditor}
        />
      )}

      {commandPaletteOpen && (
        <div className="command-palette-backdrop fixed inset-0 z-[55] flex items-start justify-center bg-black/70 p-4 pt-[14vh]" onMouseDown={event => { if (event.target === event.currentTarget) setCommandPaletteOpen(false); }}>
          <div className="command-palette alisa-palette-enter w-full max-w-xl border border-white/15 bg-[#080808] shadow-2xl shadow-black/50" role="dialog" aria-modal="true" aria-label="Command palette">
            <div className="flex items-center gap-2 border-b border-white/10 px-3"><span className="text-slate-600">›</span><input autoFocus value={commandQuery} onChange={event => { setCommandQuery(event.target.value); setCommandIndex(0); }} placeholder="Search commands" className="h-11 min-w-0 flex-1 bg-transparent font-mono text-xs text-slate-100 outline-none placeholder:text-slate-700" /><kbd className="text-[10px] text-slate-700">Esc</kbd></div>
            <div className="max-h-[min(420px,55vh)] overflow-y-auto p-1">
              {filteredCommandItems.map((item, index) => <button key={item.id} type="button" onClick={() => { setCommandPaletteOpen(false); setCommandQuery(''); item.run(); }} className={'flex w-full items-center gap-3 px-3 py-2.5 text-left text-xs ' + (index === commandIndex ? 'bg-white/[0.08] text-slate-100' : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-200')}><span className="w-36 text-slate-300">{item.label}</span><span className="truncate">{item.detail}</span></button>)}
              {!filteredCommandItems.length && <div className="px-3 py-8 text-center text-xs text-slate-700">No commands found</div>}
            </div>
            <div className="border-t border-white/10 px-3 py-2 text-[10px] text-slate-700">↑ ↓ navigate · Enter run · Ctrl/Cmd + P or K open</div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="alisa-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="alisa-settings-dialog flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#171b25] shadow-2xl">
            <div className="flex items-center gap-3 border-b border-white/[0.08] px-5 py-4"><Settings2 className="h-4 w-4 text-sky-200" /><div className="flex-1"><h2 className="text-sm font-semibold text-slate-100">Workspace settings</h2><p className="mt-0.5 text-[10px] text-slate-600">Providers, model endpoint, and active project · saved in app data with recovery copies</p></div><IconButton label="Close settings" onClick={() => setShowSettings(false)}><X className="h-4 w-4" /></IconButton></div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="grid gap-5 md:grid-cols-[190px_1fr]">
                <div className="space-y-1"><div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-slate-600">Providers</div>{providers.map(provider => <button key={provider.id} type="button" onClick={() => openSettings(provider.id)} className={'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs ' + (provider.id === settingsProviderId ? 'bg-white/[0.08] text-white' : 'text-slate-500 hover:bg-white/[0.05] hover:text-slate-300')}><span className={'h-1.5 w-1.5 rounded-full ' + (provider.id === activeProviderId ? 'bg-emerald-300' : 'bg-slate-700')} /><span className="min-w-0 flex-1 truncate">{provider.name}</span></button>)}<button type="button" onClick={() => { setSettingsProviderId(''); setProviderName(''); setProviderBaseURL(''); setProviderModel(''); setProviderApiKey(''); setProviderNotice(''); setProviderTestModels([]); }} className="mt-2 flex w-full items-center gap-2 rounded-lg border border-dashed border-white/10 px-2.5 py-2 text-xs text-slate-500 hover:border-sky-200/20 hover:text-slate-200"><Plus className="h-3.5 w-3.5" /> Add provider</button></div>
                <div className="space-y-4">
                  <div><label className="mb-1.5 block text-[10px] uppercase tracking-[0.15em] text-slate-600">Name</label><input value={providerName} onChange={event => setProviderName(event.target.value)} placeholder="Local gateway" className="w-full rounded-xl border border-white/[0.09] bg-black/20 px-3 py-2.5 text-xs text-slate-200 outline-none focus:border-sky-200/30" /></div>
                  <div><label className="mb-1.5 block text-[10px] uppercase tracking-[0.15em] text-slate-600">OpenAI-compatible base URL</label><input value={providerBaseURL} onChange={event => setProviderBaseURL(event.target.value)} placeholder="http://127.0.0.1:10009/v1" className="w-full rounded-xl border border-white/[0.09] bg-black/20 px-3 py-2.5 font-mono text-xs text-slate-200 outline-none focus:border-sky-200/30" /></div>
                  <div>
                    <label className="mb-1.5 block text-[10px] uppercase tracking-[0.15em] text-slate-600">Model route</label>
                    <div className="flex items-center gap-2">
                      <input list={'settings-model-options-' + (settingsProviderId || 'new')} value={providerModel} onChange={event => setProviderModel(event.target.value)} placeholder="auto/best-coding" className="min-w-0 flex-1 rounded-xl border border-white/[0.09] bg-black/20 px-3 py-2.5 font-mono text-xs text-slate-200 outline-none focus:border-sky-200/30" />
                      <button type="button" onClick={() => settingsProviderId ? void loadProviderModels(settingsProviderId, true) : void testProvider()} disabled={providerTesting || !providerBaseURL} aria-label="Refresh provider models" title="Refresh provider models" className="rounded-xl border border-white/[0.09] p-2.5 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200 disabled:opacity-40"><RefreshCcw className={'h-3.5 w-3.5 ' + (providerTesting || modelLoading ? 'alisa-spinner' : '')} /></button>
                    </div>
                    <datalist id={'settings-model-options-' + (settingsProviderId || 'new')}>
                      {settingsModelOptions.map(option => <option key={option} value={option} />)}
                    </datalist>
                    <div className="mt-1 text-[10px] text-slate-600">{settingsModelOptions.length ? `${settingsModelOptions.length} model routes available · type to filter` : 'Test the connection to discover every model route'}</div>
                  </div>
                  <div><label className="mb-1.5 block text-[10px] uppercase tracking-[0.15em] text-slate-600">API key</label><input type="password" value={providerApiKey} onChange={event => setProviderApiKey(event.target.value)} placeholder={providers.find(item => item.id === settingsProviderId)?.apiKeyMasked || 'Leave blank to keep current'} className="w-full rounded-xl border border-white/[0.09] bg-black/20 px-3 py-2.5 font-mono text-xs text-slate-200 outline-none focus:border-sky-200/30" /></div>
                  {providerNotice && <div className={'rounded-xl border px-3 py-2 text-xs ' + (providerNotice.toLowerCase().includes('error') || providerNotice.toLowerCase().includes('failed') || providerNotice.toLowerCase().includes('returned') ? 'border-rose-300/15 bg-rose-300/[0.06] text-rose-200' : 'border-emerald-300/15 bg-emerald-300/[0.06] text-emerald-200')}>{providerNotice}</div>}
                  <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void testProvider()} disabled={providerTesting || !providerBaseURL} className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/[0.06] disabled:opacity-40">{providerTesting ? <Loader2 className="h-3.5 w-3.5 alisa-spinner" /> : <Wifi className="h-3.5 w-3.5" />} Test connection</button><button type="button" onClick={() => void saveProvider(false)} disabled={!providerName || !providerBaseURL || !providerModel} className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/[0.06] disabled:opacity-40">Save profile</button><button type="button" onClick={() => void saveProvider(true)} disabled={!providerName || !providerBaseURL || !providerModel} className="rounded-xl bg-sky-300 px-3 py-2 text-xs font-semibold text-[#13202f] hover:bg-sky-200 disabled:opacity-40">Save & use</button></div>
                  <div className="border-t border-white/[0.07] pt-4"><div className="flex items-center gap-2 text-xs font-medium text-slate-300"><FolderOpen className="h-3.5 w-3.5 text-sky-200" />Current project</div><div className="mt-2 flex items-center gap-2 rounded-xl border border-white/[0.08] bg-black/20 p-3"><span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-500">{workspaceDir}</span><button type="button" onClick={() => void chooseWorkspace()} className="shrink-0 rounded-lg bg-white/[0.07] px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-white/[0.12]">Change</button></div></div>
                  <div className="border-t border-white/[0.07] pt-4"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-xs font-medium text-slate-300"><ShieldCheck className={'h-3.5 w-3.5 ' + (yoloMode ? 'text-rose-200' : 'text-emerald-200')} />Execution safety</div><button type="button" onClick={() => void toggleYolo()} disabled={busy || yoloSaving} className={'rounded-lg border px-2.5 py-1.5 text-[10px] uppercase tracking-[0.12em] disabled:opacity-40 ' + (yoloMode ? 'border-rose-300/25 bg-rose-300/10 text-rose-200' : 'border-white/[0.1] text-slate-500 hover:bg-white/[0.06] hover:text-slate-200')}>{yoloMode ? 'YOLO enabled' : 'Confirm actions'}</button></div><p className="mt-2 text-[10px] leading-5 text-slate-600">YOLO skips confirmation pauses for approval-gated agent tools. Workspace boundaries, read-only Ask/Plan modes, argument validation, and the terminal security gate remain active. This setting is saved in app data.</p></div>
                  <div className="border-t border-white/[0.07] pt-4"><div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-300"><ShieldCheck className="h-3.5 w-3.5 text-emerald-200" />Bundled capabilities</div><div className="space-y-1.5 font-mono text-[10px]"><div className="flex items-center justify-between border-l border-emerald-300/40 px-2 py-1"><span className="text-slate-400">MCP skill</span><span className="text-emerald-200">{capabilities.mcp?.skillInstalled ? (capabilities.mcp.availability === 'ready' ? 'config detected' : 'preinstalled') : 'unavailable'}</span></div><div className="flex items-center justify-between border-l border-sky-300/40 px-2 py-1"><span className="text-slate-400">Computer Use skill</span><span className="text-sky-200">{capabilities.computerUse?.skillInstalled ? (capabilities.computerUse.availability === 'ready' ? 'bridge detected' : 'preinstalled') : 'unavailable'}</span></div><div className="px-2 pt-1 text-[9px] text-slate-600">{capabilities.mcp?.serverCount || 0} MCP server config{(capabilities.mcp?.serverCount || 0) === 1 ? '' : 's'} detected · credentials stay local</div></div></div>

                  {/* Sound Effects & Volume Control Section */}
                  <div className="border-t border-white/[0.07] pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
                        <Volume2 className="h-3.5 w-3.5 text-pink-300" />
                        <span>Sound effects & Audio (เสียงเอฟเฟกต์)</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const next = toggleSound();
                          setSoundEnabledState(next);
                          if (next && soundVolumeState === 0) {
                            setSoundVolume(85);
                            setSoundVolumeState(85);
                          }
                        }}
                        className={`rounded-lg border px-2.5 py-1.5 text-[10px] uppercase tracking-[0.12em] transition ${
                          soundEnabledState
                            ? 'border-pink-500/30 bg-pink-500/10 text-pink-200'
                            : 'border-white/[0.1] text-slate-500 hover:bg-white/[0.06] hover:text-slate-200'
                        }`}
                      >
                        {soundEnabledState ? 'Sound ON' : 'Muted'}
                      </button>
                    </div>

                    <div className="mt-3 space-y-3.5 rounded-xl border border-white/[0.08] bg-black/25 p-3.5">
                      <div>
                        <div className="flex items-center justify-between text-[11px] text-slate-300 mb-1.5">
                          <span>Volume level (ระดับเสียง)</span>
                          <span className="font-mono text-pink-300 font-bold text-xs">{soundVolumeState}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={soundEnabledState ? soundVolumeState : 0}
                          onChange={e => {
                            const val = Number(e.target.value);
                            setSoundVolume(val);
                            setSoundVolumeState(val);
                            if (!soundEnabledState) {
                              setSoundEnabled(true);
                              setSoundEnabledState(true);
                            }
                          }}
                          className="w-full accent-pink-400 cursor-pointer h-1.5 bg-white/10 rounded"
                        />
                        <div className="mt-1 flex justify-between text-[9px] text-slate-500 font-mono">
                          <span>0% (Mute)</span>
                          <span>50%</span>
                          <span>100% (Max Loud)</span>
                        </div>
                      </div>

                      <div className="border-t border-white/[0.06] pt-2.5">
                        <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400 mb-2">Test sound effects (ทดสอบฟังเสียง)</div>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              if (!soundEnabledState || soundVolumeState === 0) {
                                const newVol = soundVolumeState === 0 ? 85 : soundVolumeState;
                                setSoundEnabled(true);
                                setSoundEnabledState(true);
                                setSoundVolume(newVol);
                                setSoundVolumeState(newVol);
                              }
                              void playChime('start', { force: true });
                            }}
                            className="flex items-center gap-1 rounded-lg border border-pink-500/25 bg-pink-500/10 px-2.5 py-1.5 text-[10px] text-pink-200 hover:bg-pink-500/20 active:scale-95 transition"
                          >
                            🎵 Task Start
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!soundEnabledState || soundVolumeState === 0) {
                                const newVol = soundVolumeState === 0 ? 85 : soundVolumeState;
                                setSoundEnabled(true);
                                setSoundEnabledState(true);
                                setSoundVolume(newVol);
                                setSoundVolumeState(newVol);
                              }
                              void playChime('success', { force: true });
                            }}
                            className="flex items-center gap-1 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1.5 text-[10px] text-emerald-200 hover:bg-emerald-500/20 active:scale-95 transition"
                          >
                            🎉 Victory Fanfare
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!soundEnabledState || soundVolumeState === 0) {
                                const newVol = soundVolumeState === 0 ? 85 : soundVolumeState;
                                setSoundEnabled(true);
                                setSoundEnabledState(true);
                                setSoundVolume(newVol);
                                setSoundVolumeState(newVol);
                              }
                              void playChime('bubble', { force: true });
                            }}
                            className="flex items-center gap-1 rounded-lg border border-purple-500/25 bg-purple-500/10 px-2.5 py-1.5 text-[10px] text-purple-200 hover:bg-purple-500/20 active:scale-95 transition"
                          >
                            💭 Bubble Pop
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!soundEnabledState || soundVolumeState === 0) {
                                const newVol = soundVolumeState === 0 ? 85 : soundVolumeState;
                                setSoundEnabled(true);
                                setSoundEnabledState(true);
                                setSoundVolume(newVol);
                                setSoundVolumeState(newVol);
                              }
                              void playChime('error', { force: true });
                            }}
                            className="flex items-center gap-1 rounded-lg border border-rose-500/25 bg-rose-500/10 px-2.5 py-1.5 text-[10px] text-rose-200 hover:bg-rose-500/20 active:scale-95 transition"
                          >
                            ⚠️ Error Alert
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="alisa-toast fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-xl border border-white/10 bg-[#1b202b] px-4 py-2.5 text-xs text-slate-200 shadow-2xl">{toast}</div>}

      <DiffViewerModal
        isOpen={Boolean(selectedDiffFile)}
        onClose={() => setSelectedDiffFile(null)}
        filePath={selectedDiffFile}
        changedFiles={changedFiles}
        onSelectFile={setSelectedDiffFile}
        onDiscardFile={handleDiscardFile}
      />
      <LiveWebPreview
        isOpen={webPreviewOpen}
        onClose={() => setWebPreviewOpen(false)}
      />
      <TemplateShowcaseModal
        isOpen={templateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
        onSelectTemplate={(prompt) => {
          setInput(prompt);
          textareaRef.current?.focus();
        }}
      />
      <ConfettiCanvas />
    </div>
  );
}
