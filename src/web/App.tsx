import { ProjectPanel } from './ProjectPanel';
import React, { useState, useEffect, useRef } from 'react';
import {
  Bug,
  FolderTree,
  Terminal as TerminalIcon,
  Send,
  Settings,
  RefreshCw,
  FileCode,
  FileCode2,
  Folder,
  FolderOpen,
  FolderPlus,
  FilePlus,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Cpu,
  Play,
  Square,
  Trash2,
  Code2,
  ChevronRight,
  ChevronDown,
  Sparkles,
  Layers,
  Wrench,
  Bot,
  Zap,
  Globe,
  Sliders,
  Maximize2,
  FileDiff,
  ListTodo,
  ShieldCheck,
  Check,
  Copy,
  Terminal,
  Activity,
  GitBranch,
  Split,
  Puzzle,
  BookOpen,
  ToggleLeft,
  ToggleRight,
  Flame,
  Plus,
  X,
  FileText,
  FileTerminal,
  Minus,
  Maximize,
  Target,
  Command,
  Search,
  ArrowRight,
  ExternalLink,
  Save,
  CircleDot,
  Download,
  PanelLeftClose,
  PanelLeftOpen,
  Braces,
  Palette,
  Clock,
  History
} from 'lucide-react';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: FileNode[];
}

interface ToolTrace {
  toolName: string;
  toolCallId: string;
  args?: any;
  result?: string;
  error?: string;
  status?: 'running' | 'success' | 'error';
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thought?: string;
  toolTraces?: ToolTrace[];
  timestamp: number;
}

interface SkillItem {
  name: string;
  category: string;
  description: string;
  source: string;
  path: string;
}

interface QuickCommand {
  id: string;
  label: string;
  command: string;
  description: string;
  icon: React.ReactNode;
}

interface UpdateState {
  status: 'idle' | 'dev' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  percent?: number;
  message?: string;
}

function toChatMessages(history: any[]): ChatMessage[] {
  return history.filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({
    ...m, thought: m.metadata?.thought,
    toolTraces: (m.tool_calls || []).map((tc: any) => {
      const result = history.find(r => r.tool_call_id === tc.id);
      return { toolCallId: tc.id, toolName: tc.function.name, result: result?.content, status: result && !result.metadata?.error ? 'success' : 'error' };
    }),
  }));
}

function renderAssistantContent(content: string) {
  const parts = content.split(/(```[\s\S]*?```)/g);
  return parts.map((part, index) => {
    if (!part.startsWith('```')) {
      return (
        <span key={`text-${index}`} className="whitespace-pre-wrap leading-6">
          {part}
        </span>
      );
    }

    const firstLineEnd = part.indexOf('\n');
    const header = firstLineEnd !== -1 ? part.slice(3, firstLineEnd).trim() : '';
    const body = firstLineEnd !== -1 ? part.slice(firstLineEnd + 1, -3) : part.slice(3, -3);

    if (header.toLowerCase() === 'diff') {
      const diffLines = body.split('\n');
      return (
        <pre
          key={`diff-${index}`}
          className="my-3 overflow-x-auto rounded-xl border border-[#2b333f] bg-[#0d1015] p-3 font-mono text-xs leading-5 text-[#d4d8e0]"
        >
          {diffLines.map((line, lineIndex) => {
            const isAdd = line.startsWith('+');
            const isDel = line.startsWith('-');
            const isHunk = line.startsWith('@@');
            const className = isAdd
              ? 'diff-add block rounded px-1'
              : isDel
              ? 'diff-remove block rounded px-1'
              : isHunk
              ? 'text-[#8da4c6] block'
              : 'block';
            return (
              <code key={`diff-line-${lineIndex}`} className={className}>
                {line || ' '}
              </code>
            );
          })}
        </pre>
      );
    }

    return (
      <pre
        key={`code-${index}`}
        className="my-3 overflow-x-auto rounded-xl border border-[#2b333f] bg-[#0d1015] p-3 font-mono text-xs leading-5 text-[#d4d8e0]"
      >
        <code>{body}</code>
      </pre>
    );
  });
}

function getFileIcon(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'tsx':
    case 'jsx':
      return <Code2 className="w-3.5 h-3.5 text-[#38bdf8] shrink-0" />;
    case 'ts':
      return <FileCode2 className="w-3.5 h-3.5 text-[#60a5fa] shrink-0" />;
    case 'js':
    case 'mjs':
    case 'cjs':
      return <FileCode className="w-3.5 h-3.5 text-[#facc15] shrink-0" />;
    case 'json':
      return <Braces className="w-3.5 h-3.5 text-[#fbbf24] shrink-0" />;
    case 'css':
    case 'scss':
      return <Palette className="w-3.5 h-3.5 text-[#ec4899] shrink-0" />;
    case 'html':
      return <Globe className="w-3.5 h-3.5 text-[#f97316] shrink-0" />;
    case 'md':
      return <FileText className="w-3.5 h-3.5 text-[#34d399] shrink-0" />;
    case 'rs':
      return <FileTerminal className="w-3.5 h-3.5 text-[#fb923c] shrink-0" />;
    case 'py':
      return <FileTerminal className="w-3.5 h-3.5 text-[#38bdf8] shrink-0" />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'svg':
    case 'ico':
      return <Sparkles className="w-3.5 h-3.5 text-[#c084fc] shrink-0" />;
    default:
      if (fileName.startsWith('.env') || fileName === '.gitignore' || fileName.includes('config')) {
        return <Sliders className="w-3.5 h-3.5 text-[#94a3b8] shrink-0" />;
      }
      return <FileText className="w-3.5 h-3.5 text-[#64748b] shrink-0" />;
  }
}

const isTauriClient = typeof window !== 'undefined' && (
  Boolean((window as any).__TAURI_INTERNALS__) ||
  window.location.hostname.includes('tauri') ||
  window.location.protocol === 'tauri:'
);

const API_BASE = (typeof window !== 'undefined' && (window.location.protocol === 'file:' || !window.location.host || isTauriClient))
  ? 'http://127.0.0.1:3001'
  : '';

const MODEL_OPTIONS = [
  { id: 'auto/best-coding', label: 'Auto — Balanced', description: 'Best fit for coding tasks' },
  { id: 'auto/best-fast', label: 'Best Fast', description: 'Quick answers for small changes' },
  { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat', description: 'General purpose assistant' },
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini', description: 'Fast OpenAI-compatible model' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'chat' | 'editor' | 'terminal' | 'skills' | 'project'>('chat');
  const sessionIdRef = useRef<string | undefined>();
  const [savedSessions, setSavedSessions] = useState<Array<{ id: string; title: string }>>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [agentMode, setAgentMode] = useState<'ask' | 'code'>('code');
  const [approval, setApproval] = useState<{ resolveId: string; action: string; details: Record<string, unknown> } | null>(null);
  const [inputPrompt, setInputPrompt] = useState('');
  const [status, setStatus] = useState<'idle' | 'thinking' | 'acting' | 'waiting_approval' | 'self_correcting' | 'error' | 'done'>('idle');
  const [statusDetail, setStatusDetail] = useState('Connecting to backend…');
  const [isBackendConnected, setIsBackendConnected] = useState(false);

  // Workspace & Files
  const [workspaceDir, setWorkspaceDir] = useState('');
  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>([]);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [collapsedDirectories, setCollapsedDirectories] = useState<Set<string>>(new Set());
  const fileRequestRef = useRef(0);
  const sessionRequestRef = useRef(0);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [editorDraft, setEditorDraft] = useState<string>('');
  const [isSavingFile, setIsSavingFile] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(min-width: 768px)').matches;
  });
  const [sidebarView, setSidebarView] = useState<'files' | 'projects' | 'sessions'>('files');
  const [showProjectMenu, setShowProjectMenu] = useState(false);

  // New File / Folder Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createItemName, setCreateItemName] = useState('');
  const [isCreatingDirectory, setIsCreatingDirectory] = useState(false);

  // OpenClaude Skills System State
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [activeSkillNames, setActiveSkillNames] = useState<string[]>([
    'openclaude-code-standards',
    'systematic-debugging'
  ]);

  useEffect(() => {
    if (!workspaceDir) return;
    try {
      const saved = JSON.parse(localStorage.getItem(`alisa-skills:${workspaceDir}`) || 'null');
      setActiveSkillNames(Array.isArray(saved) ? saved.filter(s => typeof s === 'string') : ['openclaude-code-standards', 'systematic-debugging']);
    } catch { setActiveSkillNames(['openclaude-code-standards', 'systematic-debugging']); }
  }, [workspaceDir]);

  // Quick Commands & Command Palette Modal
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandSearch, setCommandSearch] = useState('');
  const quickCommands: QuickCommand[] = [
    {
      id: 'open-folder',
      label: 'Open Folder / Workspace',
      command: '/open',
      icon: <FolderOpen className="h-4 w-4 text-[#38bdf8]" />,
      description: 'Choose a project directory on your computer',
    },
    {
      id: 'new-chat',
      label: 'New Chat Session',
      command: '/clear',
      icon: <Bot className="h-4 w-4 text-[#34d399]" />,
      description: 'Start fresh session and reset conversation',
    },
    {
      id: 'inspect-project',
      label: 'Inspect Project Structure',
      command: 'ช่วยวิเคราะห์โครงสร้างโฟลเดอร์และไฟล์ของโปรเจกต์นี้ให้หน่อย',
      icon: <FolderTree className="h-4 w-4 text-[#38bdf8]" />,
      description: 'Summarize architecture, frameworks, and entry points',
    },
    {
      id: 'find-bugs',
      label: 'Find Bugs & Vulnerabilities',
      command: 'ตรวจสอบบั๊ก ช่องโหว่ความปลอดภัย และจุดที่ควรปรับปรุงในโค้ดนี้',
      icon: <Bug className="h-4 w-4 text-[#f87171]" />,
      description: 'Systematic static audit and safety inspection',
    },
    {
      id: 'senior-standards',
      label: 'Enforce Clean Code',
      command: 'Refactor โค้ดนี้ให้เป็นไปตาม Senior Engineering Standards (TypeScript strict, Clean architecture)',
      icon: <Code2 className="h-4 w-4 text-[#a78bfa]" />,
      description: 'Zero sloppy code, strong types, modular design',
    },
    {
      id: 'rollback-change',
      label: 'Rollback Latest Changes',
      command: '/rollback',
      icon: <History className="h-4 w-4 text-[#fbbf24]" />,
      description: 'Restore files to previous snapshot state',
    },
  ];

  // Settings Modal
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyMasked, setApiKeyMasked] = useState('');
  const [baseURL, setBaseURL] = useState('https://openrouter.ai/api/v1');
  const [model, setModel] = useState('deepseek/deepseek-chat');
  const [providerTest, setProviderTest] = useState('');
  const [providerModels, setProviderModels] = useState<string[]>([]);
  const [isTestingProvider, setIsTestingProvider] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  // Model Picker Dropdown
  const [showModelPicker, setShowModelPicker] = useState(false);

  // Workspace Switch Modal
  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);
  const [workspaceInput, setWorkspaceInput] = useState('');
  const [workspaceSwitchError, setWorkspaceSwitchError] = useState<string | null>(null);

  // Terminal State
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [terminalCommand, setTerminalCommand] = useState('');
  const [isTerminalRunning, setIsTerminalRunning] = useState(false);
  const [terminalError, setTerminalError] = useState<string | null>(null);

  // Auto-Update Engine State
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' });
  const [isUpdateActionRunning, setIsUpdateActionRunning] = useState(false);
  const [updateNoticeDismissed, setUpdateNoticeDismissed] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingThought, setStreamingThought] = useState('');
  const [activeToolTraces, setActiveToolTraces] = useState<ToolTrace[]>([]);
  const activeToolTracesRef = useRef<ToolTrace[]>([]);
  const streamingContentRef = useRef('');
  const streamingThoughtRef = useRef('');

  useEffect(() => {
    if (messages.length === 0 && !streamingContent && activeToolTraces.length === 0) return;
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, activeToolTraces]);

  useEffect(() => {
    const desktop = window.desktopAPI || window.electronAPI;
    const unsubscribe = desktop?.onUpdaterState?.((nextState) => {
      setUpdateState(nextState as UpdateState);
      if (nextState.status === 'available' || nextState.status === 'downloaded') {
        setUpdateNoticeDismissed(false);
      }
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const syncSidebar = () => setIsSidebarOpen(media.matches);
    syncSidebar();
    media.addEventListener?.('change', syncSidebar);
    return () => media.removeEventListener?.('change', syncSidebar);
  }, []);

  // Keyboard shortcut listener for Ctrl+K, Ctrl+O
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        handlePickFolder();
      } else if (e.key === 'Escape') {
        setShowCommandPalette(false);
        setShowWorkspacePicker(false);
        setShowSettings(false);
        setShowModelPicker(false);
        setShowProjectMenu(false);
        setShowCreateModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [workspaceDir]);

  const addTerminalLog = (log: string) => {
    setTerminalLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${log}`]);
  };

  const fetchProjectSessions = async (wsDir?: string, id?: string) => {
    const requestId = ++sessionRequestRef.current;
    try {
      const res = await fetch(`${API_BASE}/api/sessions?${new URLSearchParams({ ...(wsDir ? { workspace: wsDir } : {}), ...(id ? { id } : {}) })}`);
      if (res.ok) {
        const data = await res.json();
        if (requestId !== sessionRequestRef.current) return;
        if (Array.isArray(data.messages)) {
          sessionIdRef.current = data.sessionId;
          setSavedSessions(data.sessions || []);
          setMessages(toChatMessages(data.messages));
        }
      }
    } catch (err) {
      console.error('Failed to load project session:', err);
    }
  };

  // Connect WebSocket
  useEffect(() => {
    fetchConfig();
    fetchWorkspaceFiles();
    fetchSkills();
    fetchProjectSessions();

    const wsUrl = (API_BASE || window.location.origin).replace(/^http/, 'ws') + '/ws';
    let stopped = false;
    let retryTimer: number | undefined;
    let retryAttempt = 0;

    const connect = () => {
      if (stopped) return;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        retryAttempt = 0;
        setIsBackendConnected(true);
        setStatusDetail('Ready');
        fetchConfig(); fetchWorkspaceFiles(); fetchSkills(); fetchProjectSessions();
        addTerminalLog('🍓 Connected to Alisa Studio agent.');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleServerEvent(data);
        } catch (err) {
          console.error('Failed parsing WS message:', err);
        }
      };

      ws.onerror = () => {
        // Handled in onclose
      };

      ws.onclose = () => {
        setIsBackendConnected(false);
        setStatus('idle');
        setStatusDetail('Backend offline');

        if (!stopped) {
          const delay = Math.min(1000 * Math.pow(1.5, retryAttempt), 8000);
          retryAttempt++;
          retryTimer = window.setTimeout(connect, delay);
        }
      };
    };

    connect();

    return () => {
      stopped = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const fetchConfig = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/config`);
      if (!res.ok) throw new Error(`Config request failed (${res.status})`);
      const data = await res.json();
      setApiKey('');
      setApiKeyMasked(data.apiKeyMasked || '');
      setBaseURL(data.baseURL || 'https://openrouter.ai/api/v1');
      setModel(data.model || 'deepseek/deepseek-chat');
      setWorkspaceDir(data.workspaceDir || '');
      if (Array.isArray(data.recentWorkspaces)) {
        setRecentWorkspaces(data.recentWorkspaces);
      }
    } catch (err) {
      console.error('Failed to fetch config:', err);
    }
  };

  const fetchWorkspaceFiles = async () => {
    setIsWorkspaceLoading(true);
    setWorkspaceError(null);
    try {
      const res = await fetch(`${API_BASE}/api/files/tree`);
      if (!res.ok) throw new Error(`Workspace request failed (${res.status})`);
      const data = await res.json();
      if (data.files) {
        setFileTree(data.files);
      }
      if (data.workspaceDir) {
        setWorkspaceDir(data.workspaceDir);
      }
    } catch (err) {
      console.error('Failed to fetch files:', err);
      setWorkspaceError(err instanceof Error ? err.message : 'Unable to load workspace files');
    } finally {
      setIsWorkspaceLoading(false);
    }
  };

  const fetchSkills = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/skills`);
      if (!res.ok) throw new Error(`Skills request failed (${res.status})`);
      const data = await res.json();
      if (data.skills) {
        setSkills(data.skills);
        addTerminalLog(`🧩 Loaded ${data.skills.length} OpenClaude Skills`);
      }
    } catch (err) {
      console.error('Failed to fetch skills:', err);
    }
  };

  const toggleSkillActive = (skillName: string) => {
    setActiveSkillNames((prev) => {
      const exists = prev.includes(skillName);
      const next = exists ? prev.filter((s) => s !== skillName) : [...prev, skillName];
      localStorage.setItem(`alisa-skills:${workspaceDir}`, JSON.stringify(next));
      addTerminalLog(exists ? `🔴 Disabled Skill: ${skillName}` : `🟢 Activated Skill: ${skillName}`);
      return next;
    });
  };

  const handleSaveConfig = async () => {
    setSettingsError(null);
    try {
      const res = await fetch(`${API_BASE}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKey || undefined,
          baseURL,
          model,
          workspaceDir,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Failed to save configuration (${res.status})`);
      }
      setApiKey('');
      setApiKeyMasked(data.config?.apiKeyMasked || apiKeyMasked);
      setShowSettings(false);
      fetchWorkspaceFiles();
      addTerminalLog(`⚙️ Config Saved: ${model}`);
    } catch (err) {
      console.error('Failed to save config:', err);
      setSettingsError(err instanceof Error ? err.message : 'Unable to save settings');
    }
  };

  // Native & Direct Folder Picker
  const handlePickFolder = async () => {
    try {
      const desktop = window.desktopAPI || window.electronAPI;
      const selected = await desktop?.openFolderPicker?.();
      if (selected) {
        await handleSwitchToWorkspace(selected);
      } else if (!desktop?.isDesktop) { handleOpenWorkspacePicker(); }
    } catch (err: any) {
      console.error('Pick folder error:', err);
      handleOpenWorkspacePicker();
    }
  };

  const handleOpenWorkspacePicker = () => {
    setWorkspaceInput(workspaceDir);
    setWorkspaceSwitchError(null);
    setShowWorkspacePicker(true);
    setShowProjectMenu(false);
  };

  const handleSwitchToWorkspace = async (targetPath: string) => {
    if (editorDraft !== fileContent && !window.confirm('Discard unsaved file changes?')) return;
    const requested = targetPath.trim();
    if (!requested) {
      setWorkspaceSwitchError('Please enter a valid directory path.');
      return;
    }

    setWorkspaceSwitchError(null);
    try {
      const res = await fetch(`${API_BASE}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceDir: requested }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Failed to switch workspace (${res.status})`);
      }

      const nextWorkspace = data.config.workspaceDir;
      setWorkspaceDir(nextWorkspace);
      if (Array.isArray(data.config.recentWorkspaces)) {
        setRecentWorkspaces(data.config.recentWorkspaces);
      }
      setCollapsedDirectories(new Set());
      fileRequestRef.current++;
      setSelectedFile(null);
      setFileContent('');
      setEditorDraft('');
      setShowWorkspacePicker(false);
      setShowProjectMenu(false);
      fetchWorkspaceFiles();
      fetchProjectSessions(nextWorkspace);
      fetchSkills();
      addTerminalLog(`📂 Switched project workspace to: ${nextWorkspace}`);
    } catch (err: any) {
      setWorkspaceSwitchError(err.message || 'Unable to switch workspace');
    }
  };

  const handleRemoveRecent = async (pathToRemove: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      const res = await fetch(`${API_BASE}/api/workspace/remove-recent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pathToRemove }),
      });
      const data = await res.json();
      if (data.recentWorkspaces) {
        setRecentWorkspaces(data.recentWorkspaces);
      } else {
        setRecentWorkspaces((prev) => prev.filter((p) => p !== pathToRemove));
      }
    } catch {
      setRecentWorkspaces((prev) => prev.filter((p) => p !== pathToRemove));
    }
  };

  const handleRevealInExplorer = async (filePath?: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await fetch(`${API_BASE}/api/files/reveal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath || '' }),
      });
      addTerminalLog(`📂 Opened in File Explorer: ${filePath || workspaceDir}`);
    } catch (err: any) {
      console.error('Reveal error:', err);
    }
  };

  const handleCreateFileOrFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = createItemName.trim();
    if (!name) return;
    try {
      const res = await fetch(`${API_BASE}/api/files/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: name, isDirectory: isCreatingDirectory }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to create item');
      }
      setShowCreateModal(false);
      setCreateItemName('');
      fetchWorkspaceFiles();
      addTerminalLog(`✨ Created ${isCreatingDirectory ? 'Folder' : 'File'}: ${name}`);
      if (!isCreatingDirectory) {
        handleFileClick(name);
      }
    } catch (err: any) {
      alert(err.message || 'Failed creating item');
    }
  };

  const handleAddFileToPrompt = (filePath: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setInputPrompt((prev) => {
      const tag = `@${filePath}`;
      return prev ? `${prev} ${tag} ` : `${tag} `;
    });
    setActiveTab('chat');
  };

  const handleFileClick = async (filePath: string) => {
    if (editorDraft !== fileContent && !window.confirm('Discard unsaved file changes?')) return;
    if (isSavingFile) return;
    const requestId = ++fileRequestRef.current;
    setFileContent(''); setEditorDraft('');
    setSelectedFile(filePath);
    setEditorError(null);
    setActiveTab('editor');
    setIsSidebarOpen(false);
    try {
      const res = await fetch(`${API_BASE}/api/files/read?path=${encodeURIComponent(filePath)}`);
      if (!res.ok) throw new Error(`File request failed (${res.status})`);
      const data = await res.json();
      if (requestId !== fileRequestRef.current) return;
      if (data.content !== undefined) {
        setFileContent(data.content);
        setEditorDraft(data.content);
        addTerminalLog(`📄 Opened File: ${filePath}`);
      }
    } catch (err) {
      console.error('Failed reading file:', err);
      setEditorError(err instanceof Error ? err.message : 'Unable to read file');
    }
  };

  const handleSaveFile = async () => {
    if (!selectedFile || editorDraft === fileContent || isSavingFile) return;

    const savedDraft = editorDraft;
    setIsSavingFile(true);
    setEditorError(null);
    try {
      const res = await fetch(`${API_BASE}/api/files/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedFile, content: editorDraft, originalContent: fileContent }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `File save failed (${res.status})`);
      }
      setFileContent(savedDraft);
      addTerminalLog(`💾 Saved File: ${selectedFile}`);
      fetchWorkspaceFiles();
    } catch (err) {
      console.error('Failed saving file:', err);
      setEditorError(err instanceof Error ? err.message : 'Unable to save file');
    } finally {
      setIsSavingFile(false);
    }
  };

  const handleAbortTask = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'abort_task' }));
    }
    setStatusDetail('Cancelling…');
    addTerminalLog('⏹️ Task cancelled by user.');
  };

  const handleRetryMessage = (messageIndex: number) => {
    const previousUserMessage = messages
      .slice(0, messageIndex)
      .reverse()
      .find((message) => message.role === 'user');
    if (previousUserMessage) {
      handleSendPrompt(previousUserMessage.content);
    }
  };

  const handleRunTerminal = async () => {
    const command = terminalCommand.trim();
    if (!command || isTerminalRunning) return;

    setIsTerminalRunning(true);
    setTerminalError(null);
    addTerminalLog(`$ ${command}`);
    try {
      const res = await fetch(`${API_BASE}/api/terminal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Terminal request failed (${res.status})`);
      if (data.output) addTerminalLog(data.output);
      addTerminalLog(`[exit ${data.exitCode ?? 0} · ${data.durationMs ?? 0}ms]`);
      setTerminalCommand('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to run command';
      setTerminalError(message);
      addTerminalLog(`❌ ${message}`);
    } finally {
      setIsTerminalRunning(false);
    }
  };

  const handleNewChat = async () => {
    if (['thinking', 'acting', 'waiting_approval'].includes(status)) return;
    try {
      const res = await fetch(`${API_BASE}/api/sessions`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to create chat');
      await fetchProjectSessions(undefined, data.sessionId);
      setStreamingContent(''); setStreamingThought(''); setActiveToolTraces([]);
      streamingContentRef.current = ''; streamingThoughtRef.current = '';
      setActiveTab('chat'); setInputPrompt('');
      setStatus('idle'); setStatusDetail('Ready');
    } catch (err) { setStatusDetail(err instanceof Error ? err.message : 'Unable to create chat'); }
  };

  const handleSelectModel = async (nextModel: string) => {
    setShowModelPicker(false);
    try {
      const res = await fetch(`${API_BASE}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: nextModel }),
      });
      if (!res.ok) throw new Error('Failed to update model');
      setModel(nextModel);
      addTerminalLog(`✨ Model changed to: ${nextModel}`);
    } catch (err) {
      setStatusDetail(err instanceof Error ? err.message : 'Unable to change model');
    }
  };

  const handleCheckForUpdates = async () => {
    if (isUpdateActionRunning) return;
    setIsUpdateActionRunning(true);
    const desktop = window.desktopAPI || window.electronAPI;
    try {
      if (desktop?.checkForUpdates) {
        const nextState = await desktop.checkForUpdates();
        setUpdateState(nextState as UpdateState);
        addTerminalLog(`⬆️ ${nextState.message || 'Update check finished.'}`);
      } else {
        const nextState: UpdateState = { status: 'dev', message: 'Update checks are available after installing the app.' };
        setUpdateState(nextState);
        addTerminalLog(`⬆️ ${nextState.message}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to check for updates.';
      setUpdateState({ status: 'error', message });
      addTerminalLog(`❌ ${message}`);
    } finally {
      setIsUpdateActionRunning(false);
    }
  };

  const handleDownloadUpdate = async () => {
    const desktop = window.desktopAPI || window.electronAPI;
    if (!desktop?.downloadUpdate || isUpdateActionRunning) return;
    setIsUpdateActionRunning(true);
    try {
      const nextState = await desktop.downloadUpdate();
      setUpdateState(nextState as UpdateState);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to download update.';
      setUpdateState({ status: 'error', message });
    } finally {
      setIsUpdateActionRunning(false);
    }
  };

  const handleInstallUpdate = async () => {
    const desktop = window.desktopAPI || window.electronAPI;
    if (!desktop?.installUpdate) return;
    await desktop.installUpdate();
  };

  const handleServerEvent = (data: any) => {
    const appendServerMessage = (message: any) => {
      if (!message || (message.role !== 'user' && message.role !== 'assistant')) return;

      const chatMessage: ChatMessage = {
        id: message.id || `message_${Date.now()}`,
        role: message.role,
        content: message.content || '',
        thought: message.thought || message.metadata?.thought,
        toolTraces: message.toolTraces || (message.tool_calls || []).map((tc: any) => ({ toolCallId: tc.id, toolName: tc.function.name, status: 'running' })),
        timestamp: message.timestamp || Date.now(),
      };

      setMessages((prev) => {
        const withoutDuplicate = prev.filter((item) => item.id !== chatMessage.id);
        return [...withoutDuplicate, chatMessage];
      });
    };

    switch (data.type) {
      case 'session_saved':
        setStreamingContent(''); setStreamingThought('');
        streamingContentRef.current = ''; streamingThoughtRef.current = '';
        fetchProjectSessions(undefined, data.sessionId);
        setActiveToolTraces([]);
        break;
      case 'approval_requested':
        setApproval(data);
        break;
      case 'status_change':
        if (data.status !== 'waiting_approval') setApproval(null);
        setStatus(data.status || 'idle');
        if (data.detail) {
          setStatusDetail(data.detail);
        } else if (data.status === 'idle') {
          setStatusDetail('Ready');
        } else if (data.status === 'done') {
          setStatusDetail('Completed');
        }
        break;

      case 'token':
      case 'token_stream': {
        const delta = data.delta ?? data.token ?? '';
        streamingContentRef.current += delta;
        setStreamingContent(streamingContentRef.current);
        break;
      }

      case 'thought':
      case 'thought_stream': {
        const delta = data.delta ?? data.thought ?? '';
        streamingThoughtRef.current += delta;
        setStreamingThought(streamingThoughtRef.current);
        break;
      }

      case 'tool_start':
      case 'tool_call_start':
        setActiveToolTraces((prev) => [
          ...prev,
          {
            toolName: data.toolName,
            toolCallId: data.toolCallId,
            args: data.args,
            status: 'running',
          },
        ]);
        addTerminalLog(`🛠️ Executing Tool [${data.toolName}]: ${JSON.stringify(data.args)}`);
        break;

      case 'tool_end':
      case 'tool_call_end':
        setActiveToolTraces((prev) =>
          prev.map((t) =>
            t.toolCallId === data.toolCallId
              ? { ...t, status: data.error ? 'error' : 'success', result: data.result, error: data.error }
              : t
          )
        );
        setMessages(prev => prev.map(message => ({ ...message, toolTraces: message.toolTraces?.map(trace => trace.toolCallId === data.toolCallId ? { ...trace, status: data.error ? 'error' : 'success', result: data.result, error: data.error } : trace) })));
        addTerminalLog(`${data.error ? '❌' : '✅'} Tool [${data.toolName}] Finished`);
        fetchWorkspaceFiles();
        break;

      case 'message_added':
        if (data.message?.role === 'assistant') {
          setStreamingContent('');
          setStreamingThought('');
          streamingContentRef.current = '';
          streamingThoughtRef.current = '';
        }
        appendServerMessage(data.message);
        break;

      case 'turn_complete':
        appendServerMessage({
          id: `turn_${Date.now()}`,
          role: 'assistant',
          content: data.result?.content || streamingContentRef.current,
          metadata: { thought: streamingThoughtRef.current },
          timestamp: Date.now(),
        });
        setStreamingContent('');
        setStreamingThought('');
        streamingContentRef.current = '';
        streamingThoughtRef.current = '';
        setActiveToolTraces([]);
        activeToolTracesRef.current = [];
        setStatus('idle');
        break;

      case 'error':
        setStatus('error');
        setStatusDetail(data.message || 'Request failed');
        addTerminalLog(`❌ Server Error: ${data.message}`);
        break;
    }
  };

  const handleSendPrompt = (promptOverride?: string) => {
    const prompt = (promptOverride ?? inputPrompt).trim();
    if (!sessionIdRef.current) { setStatusDetail('Loading chat. Please wait or reconnect.'); return; }
    if (!prompt || status === 'thinking' || status === 'acting' || status === 'waiting_approval' || status === 'self_correcting') return;

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setStatus('error');
      setStatusDetail('Backend offline');
      addTerminalLog('⚠️ Cannot send command while the backend is offline.');
      return;
    }

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    };


    setStatus('thinking');
    setStatusDetail('Processing query...');
    addTerminalLog(`💬 User: ${prompt}`);

    wsRef.current.send(
      JSON.stringify({
        type: 'start_task',
        sessionId: sessionIdRef.current,
        prompt,
        skills: activeSkillNames,
        mode: agentMode,
      })
    );

    setInputPrompt('');
  };

  const handleRollbackFile = async () => {
    try {
      addTerminalLog('🔄 Rolling back latest file edits...');
      const res = await fetch(`${API_BASE}/api/rollback`, { method: 'POST' });
      if (!res.ok) throw new Error(`Rollback request failed (${res.status})`);
      const data = await res.json();
      if (data.success) {
        addTerminalLog(`✅ ${data.message}`);
        fetchWorkspaceFiles();
      } else {
        addTerminalLog(`⚠️ ${data.message}`);
      }
    } catch (err: any) {
      addTerminalLog(`❌ Rollback error: ${err.message}`);
    }
  };

  const handleExecuteCommand = (command: QuickCommand) => {
    setShowCommandPalette(false);
    addTerminalLog(`⚡ Executed Command: ${command.command} (${command.label})`);

    if (command.command === '/open') {
      handlePickFolder();
    } else if (command.command === '/clear') {
      handleNewChat();
    } else if (command.command === '/skills') {
      setActiveTab('skills');
    } else if (command.command === '/rollback') {
      handleRollbackFile();
    } else {
      setInputPrompt(command.command);
      setActiveTab('chat');
    }
  };

  const filterTree = (nodes: FileNode[], query: string): FileNode[] => {
    if (!query.trim()) return nodes;
    const q = query.toLowerCase();
    return nodes
      .map((node) => {
        if (node.type === 'directory') {
          const matchingChildren = node.children ? filterTree(node.children, q) : [];
          if (node.name.toLowerCase().includes(q) || matchingChildren.length > 0) {
            return { ...node, children: matchingChildren };
          }
          return null;
        }
        return node.name.toLowerCase().includes(q) ? node : null;
      })
      .filter((n): n is FileNode => n !== null);
  };

  const filteredTree = filterTree(fileTree, fileSearchQuery);

  const renderFileTree = (nodes: FileNode[], depth = 0) => {
    return nodes.map((node) => (
      <div key={node.path} style={{ paddingLeft: depth > 0 ? '12px' : '0' }}>
        {node.type === 'directory' ? (
          <div>
            <button
              type="button"
              aria-expanded={!collapsedDirectories.has(node.path)}
              onClick={() => setCollapsedDirectories((prev) => {
                const next = new Set(prev);
                if (next.has(node.path)) next.delete(node.path);
                else next.add(node.path);
                return next;
              })}
              className="group flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-[#aeb7c5] transition hover:bg-[#1a2029] hover:text-white"
            >
              <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-[#687487] transition-transform ${collapsedDirectories.has(node.path) ? '' : 'rotate-90'}`} />
              <Folder className={`h-3.5 w-3.5 shrink-0 ${collapsedDirectories.has(node.path) ? 'text-[#8da4c6]' : 'text-[#a4bcdb]'}`} />
              <span className="truncate font-medium">{node.name}</span>
            </button>
            {node.children && !collapsedDirectories.has(node.path) && renderFileTree(node.children, depth + 1)}
          </div>
        ) : (
          <div
            onClick={() => handleFileClick(node.path)}
            className={`group relative flex items-center justify-between gap-1.5 py-1 px-2 rounded-md text-xs font-mono cursor-pointer transition-colors ${
              selectedFile === node.path
                ? 'bg-[#222b38] text-white font-medium shadow-sm ring-1 ring-[#3b4b62]'
                : 'text-[#9aa7b9] hover:bg-[#171c24] hover:text-[#e2e8f0]'
            }`}
          >
            <div className="flex min-w-0 items-center gap-2">
              {getFileIcon(node.name)}
              <span className="truncate">{node.name}</span>
            </div>
            <div className="hidden shrink-0 items-center gap-1 group-hover:flex">
              <button
                type="button"
                title="Add to prompt (@file)"
                onClick={(e) => handleAddFileToPrompt(node.path, e)}
                className="rounded p-0.5 text-[#8b9bb2] hover:bg-[#283344] hover:text-white"
              >
                <Plus className="h-3 w-3" />
              </button>
              <button
                type="button"
                title="Reveal in Explorer"
                onClick={(e) => handleRevealInExplorer(node.path, e)}
                className="rounded p-0.5 text-[#8b9bb2] hover:bg-[#283344] hover:text-white"
              >
                <ExternalLink className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}
      </div>
    ));
  };

  const statusLabel = status === 'thinking'
    ? '⚡ Thinking…'
    : status === 'acting'
    ? '⚙️ Executing…'
    : status === 'waiting_approval'
    ? '⏸ Waiting for approval…'
    : status === 'self_correcting'
    ? '🔧 Self-correcting…'
    : status === 'error'
    ? '⚠️ Error'
    : status === 'done'
    ? '✓ Completed'
    : isBackendConnected
    ? '🍓 Alisa: Ready'
    : statusDetail === 'Backend offline'
    ? '⚠️ Backend offline'
    : '⏳ Connecting…';

  const statusDot = status === 'error'
    ? 'bg-[#ff5f56]'
    : status === 'thinking'
    ? 'bg-[#ffaa00] animate-ping'
    : status === 'acting'
    ? 'bg-[#38bdf8] animate-pulse'
    : status === 'waiting_approval'
    ? 'bg-[#ffbd2e] animate-pulse'
    : status === 'self_correcting'
    ? 'bg-[#c084fc] animate-pulse'
    : !isBackendConnected
    ? 'bg-[#ffbd2e]'
    : 'bg-[#27c93f]';

  const visibleStatusDetail = statusDetail
    && !['Ready', 'Backend connected', 'Backend offline', 'Connecting to backend…'].includes(statusDetail)
    && !statusDetail.startsWith('Ready. Workspace:')
    ? statusDetail
    : '';

  const workspaceLabel = workspaceDir.split(/[\\/]/).filter(Boolean).pop() || 'No workspace selected';
  const isBusy = status === 'thinking' || status === 'acting' || status === 'waiting_approval' || status === 'self_correcting';
  const editorDirty = Boolean(selectedFile) && editorDraft !== fileContent;
  const selectedModel = MODEL_OPTIONS.find((option) => option.id === model);
  const recentSessionPrompts = messages
    .filter((message) => message.role === 'user' && message.content.trim())
    .slice(-8)
    .reverse();
  const updateBannerVisible = !updateNoticeDismissed && ['available', 'downloading', 'downloaded', 'error'].includes(updateState.status);

  return (
    <div className="alisa-shell flex h-screen min-h-0 flex-col bg-[#0b0d10] text-[#e7e9ee] font-sans">
      {/* Top Application Bar */}
      <header className="alisa-topbar flex h-14 shrink-0 items-center justify-between border-b border-[#252a33] bg-[#11141a]/90 px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => setIsSidebarOpen((open) => !open)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-[#aab2c0] transition hover:border-[#333b48] hover:bg-[#1a1f27] hover:text-white md:hidden"
            aria-label="Toggle workspace explorer"
          >
            {isSidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
          </button>

          <div className="alisa-brand-mark flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f4f5f7] text-sm font-bold text-[#12151a] shadow-sm">
            🍓
          </div>

          <div className="min-w-0 leading-tight hidden sm:block">
            <div className="alisa-brand-name truncate text-sm font-semibold tracking-tight text-white">Project Alisa Studio</div>
            <div className="text-[10px] text-[#7f8998]">AI Code Harness</div>
          </div>

          <div className="hidden h-5 w-px bg-[#2a303b] lg:block" />

          {/* Active Project Dropdown Pill */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowProjectMenu((prev) => !prev)}
              className="alisa-workspace-badge flex max-w-[260px] sm:max-w-xs items-center gap-2 rounded-lg border border-[#2b3543] bg-[#161c24] px-2.5 py-1.5 text-xs font-medium text-[#c4cbd6] transition hover:border-[#4d5e75] hover:bg-[#1d2531]"
              title={workspaceDir}
            >
              <Folder className="h-3.5 w-3.5 shrink-0 text-[#38bdf8]" />
              <span className="truncate">{workspaceLabel}</span>
              <ChevronDown className={`h-3 w-3 shrink-0 text-[#718097] transition-transform ${showProjectMenu ? 'rotate-180' : ''}`} />
            </button>

            {/* Project Switcher Popover */}
            {showProjectMenu && (
              <div
                className="absolute left-0 top-11 z-50 w-80 rounded-xl border border-[#353f4f] bg-[#161b22] p-2 shadow-[0_20px_50px_rgba(0,0,0,0.6)] backdrop-blur-xl"
                onMouseLeave={() => setShowProjectMenu(false)}
              >
                <div className="mb-2 px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-[#738297]">
                  Active Workspace
                </div>
                <div className="mb-2 rounded-lg bg-[#0e1217] p-2 text-xs text-[#cbd5e1]">
                  <div className="flex items-center gap-1.5 font-semibold text-white truncate">
                    <Folder className="h-3.5 w-3.5 text-[#38bdf8] shrink-0" />
                    <span className="truncate">{workspaceLabel}</span>
                  </div>
                  <div className="mt-1 truncate text-[11px] font-mono text-[#64748b]">{workspaceDir}</div>
                  <div className="mt-2 flex gap-1.5 border-t border-[#1e2530] pt-2">
                    <button
                      type="button"
                      onClick={(e) => handleRevealInExplorer(undefined, e)}
                      className="inline-flex items-center gap-1 rounded bg-[#1e2530] px-2 py-1 text-[10px] text-[#94a3b8] hover:bg-[#2b3543] hover:text-white"
                    >
                      <ExternalLink className="h-2.5 w-2.5" /> Reveal Explorer
                    </button>
                    <button
                      type="button"
                      onClick={() => { navigator.clipboard.writeText(workspaceDir); addTerminalLog('📋 Copied workspace path'); }}
                      className="inline-flex items-center gap-1 rounded bg-[#1e2530] px-2 py-1 text-[10px] text-[#94a3b8] hover:bg-[#2b3543] hover:text-white"
                    >
                      <Copy className="h-2.5 w-2.5" /> Copy Path
                    </button>
                  </div>
                </div>

                {/* Open Folder Action */}
                <button
                  type="button"
                  onClick={() => { setShowProjectMenu(false); handlePickFolder(); }}
                  className="flex w-full items-center justify-between gap-2 rounded-lg bg-gradient-to-r from-[#202734] to-[#293243] px-3 py-2 text-xs font-semibold text-white transition hover:from-[#2a3446] hover:to-[#37445c]"
                >
                  <span className="flex items-center gap-2">
                    <FolderOpen className="h-4 w-4 text-[#38bdf8]" />
                    <span>Open Local Folder…</span>
                  </span>
                  <kbd className="rounded bg-[#13171e] px-1.5 py-0.5 text-[10px] text-[#8e9eb3]">Ctrl+O</kbd>
                </button>

                {recentWorkspaces.length > 1 && (
                  <div className="mt-3">
                    <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-[#738297]">
                      Recent Workspaces
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-0.5 custom-scrollbar">
                      {recentWorkspaces
                        .filter((p) => p !== workspaceDir)
                        .map((p) => {
                          const name = p.split(/[\\/]/).filter(Boolean).pop() || p;
                          return (
                            <div
                              key={p}
                              onClick={() => handleSwitchToWorkspace(p)}
                              className="group flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-xs text-[#9aa8bd] cursor-pointer hover:bg-[#1e2531] hover:text-white"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-medium">{name}</div>
                                <div className="truncate text-[10px] text-[#556477]">{p}</div>
                              </div>
                              <button
                                type="button"
                                title="Remove from recent"
                                onClick={(e) => handleRemoveRecent(p, e)}
                                className="hidden group-hover:block p-1 text-[#64748b] hover:text-[#f87171]"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Center Agent Status */}
        <div className="hidden items-center gap-2 lg:flex">
          <div className={`alisa-status-pill flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${isBackendConnected ? 'border-[#24583a] bg-[#132319] text-[#9be7b0]' : 'border-[#5b4720] bg-[#251f12] text-[#f2c56d]'}`}>
            <span className={`h-2 w-2 rounded-full ${statusDot}`} />
            <span>{statusLabel}</span>
            {visibleStatusDetail && <span className="max-w-[180px] truncate text-[#7f8998]">{visibleStatusDetail}</span>}
          </div>
        </div>

        {/* Action Buttons & Desktop Controls */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {/* Quick Open Folder Button */}
          <button
            type="button"
            onClick={handlePickFolder}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#303846] bg-[#171c24] px-2.5 text-xs font-semibold text-[#e2e8f0] shadow-sm transition hover:border-[#4e5f76] hover:bg-[#202733] hover:text-white"
            title="Open folder / project (Ctrl+O)"
          >
            <FolderOpen className="h-3.5 w-3.5 text-[#38bdf8]" />
            <span className="hidden sm:inline">Open Folder</span>
          </button>

          <button
            type="button"
            onClick={handleNewChat}
            className="alisa-topbar-new hidden h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold sm:inline-flex"
          >
            <Plus className="h-3.5 w-3.5" /> New chat
          </button>

          <button
            type="button"
            onClick={() => setShowCommandPalette(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#303846] bg-[#171c24] px-2.5 text-xs font-medium text-[#c4cbd6] transition hover:border-[#4a5567] hover:bg-[#202733] hover:text-white"
            title="Command palette (Ctrl+K)"
          >
            <Command className="h-3.5 w-3.5" />
            <kbd className="hidden rounded bg-[#252c37] px-1.5 py-0.5 text-[10px] text-[#8f9aaa] sm:inline">Ctrl K</kbd>
          </button>

          <button
            type="button"
            onClick={() => { setSettingsError(null); setShowSettings(true); }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#303846] bg-[#171c24] text-[#aab2c0] transition hover:border-[#4a5567] hover:bg-[#202733] hover:text-white"
            aria-label="Open settings"
          >
            <Settings className="h-4 w-4" />
          </button>

          {/* Desktop Window Controls */}
          <div className="ml-1 hidden items-center gap-1 border-l border-[#28303d] pl-2 sm:flex">
            <button
              type="button"
              onClick={() => (window.desktopAPI || window.electronAPI)?.minimize?.()}
              className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-[#222934] text-[#8e9caf] hover:text-white"
              title="Minimize"
            >
              <Minus className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => (window.desktopAPI || window.electronAPI)?.maximize?.()}
              className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-[#222934] text-[#8e9caf] hover:text-white"
              title="Maximize"
            >
              <Maximize2 className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => (window.desktopAPI || window.electronAPI)?.close?.()}
              className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-[#ef4444] text-[#8e9caf] hover:text-white"
              title="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace Body */}
      <div className="relative flex min-h-0 flex-1">
        {isSidebarOpen && (
          <button
            type="button"
            aria-label="Dismiss explorer overlay"
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 z-30 bg-black/60 md:hidden"
          />
        )}

        {/* Left Sidebar */}
        <aside className={`alisa-sidebar absolute inset-y-0 left-0 z-40 flex w-[min(86vw,20rem)] flex-col border-r border-[#252a33] bg-[#11141a] shadow-2xl transition-transform duration-200 md:relative md:z-0 md:w-80 md:translate-x-0 md:shadow-none ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          {/* Sidebar Header & Project Title */}
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-[#252a33] px-3">
            <div className="flex min-w-0 items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-[#38bdf8] shrink-0" />
              <span className="truncate text-xs font-semibold text-white uppercase tracking-wider">{workspaceLabel}</span>
            </div>

            {/* Quick Action Toolbar */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handlePickFolder}
                className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-[#1f2631] text-[#93a2b8] hover:text-white"
                title="Open Folder..."
              >
                <FolderOpen className="h-3.5 w-3.5 text-[#38bdf8]" />
              </button>
              <button
                type="button"
                onClick={() => { setIsCreatingDirectory(false); setCreateItemName(''); setShowCreateModal(true); }}
                className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-[#1f2631] text-[#93a2b8] hover:text-white"
                title="New File"
              >
                <FilePlus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => { setIsCreatingDirectory(true); setCreateItemName(''); setShowCreateModal(true); }}
                className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-[#1f2631] text-[#93a2b8] hover:text-white"
                title="New Folder"
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={fetchWorkspaceFiles}
                className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-[#1f2631] text-[#93a2b8] hover:text-white"
                title="Refresh Explorer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isWorkspaceLoading ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={() => handleRevealInExplorer()}
                className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-[#1f2631] text-[#93a2b8] hover:text-white"
                title="Reveal in Explorer"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setIsSidebarOpen(false)}
                className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-[#1f2631] text-[#93a2b8] hover:text-white md:hidden"
                aria-label="Close sidebar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Navigation View Switcher (Files, Projects, Sessions) */}
          <div className="p-2 border-b border-[#1c222b]">
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-[#0b0e13] p-1 text-xs">
              <button
                type="button"
                onClick={() => setSidebarView('files')}
                className={`flex items-center justify-center gap-1 rounded-md py-1.5 font-medium transition ${
                  sidebarView === 'files' ? 'bg-[#222a36] text-white shadow-sm' : 'text-[#7d8b9e] hover:text-white'
                }`}
              >
                <FolderTree className="h-3.5 w-3.5" /> Files
              </button>
              <button
                type="button"
                onClick={() => setSidebarView('projects')}
                className={`flex items-center justify-center gap-1 rounded-md py-1.5 font-medium transition ${
                  sidebarView === 'projects' ? 'bg-[#222a36] text-white shadow-sm' : 'text-[#7d8b9e] hover:text-white'
                }`}
              >
                <Folder className="h-3.5 w-3.5" /> Projects
              </button>
              <button
                type="button"
                onClick={() => setSidebarView('sessions')}
                className={`flex items-center justify-center gap-1 rounded-md py-1.5 font-medium transition ${
                  sidebarView === 'sessions' ? 'bg-[#222a36] text-white shadow-sm' : 'text-[#7d8b9e] hover:text-white'
                }`}
              >
                <CircleDot className="h-3.5 w-3.5" /> Chat
              </button>
            </div>
          </div>

          {/* Sidebar View Content */}
          <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
            {sidebarView === 'files' ? (
              <div className="p-2">
                {/* File Search Filter */}
                <div className="mb-2 relative">
                  <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-[#627083]" />
                  <input
                    type="text"
                    value={fileSearchQuery}
                    onChange={(e) => setFileSearchQuery(e.target.value)}
                    placeholder="Search files in workspace…"
                    className="w-full rounded-md border border-[#262f3c] bg-[#0c0f14] py-1.5 pl-8 pr-2.5 text-xs text-white placeholder-[#586475] outline-none focus:border-[#4e6079]"
                  />
                  {fileSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setFileSearchQuery('')}
                      className="absolute right-2 top-2 text-[#64748b] hover:text-white"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* File Tree Items */}
                {fileTree.length > 0 ? (
                  <div className="space-y-0.5">
                    {renderFileTree(filteredTree)}
                  </div>
                ) : isWorkspaceLoading ? (
                  <div className="space-y-2 p-3 text-xs text-[#778396]">
                    <div className="h-3.5 w-3/4 animate-pulse rounded bg-[#1e2530]" />
                    <div className="h-3.5 w-1/2 animate-pulse rounded bg-[#1e2530]" />
                    <div className="h-3.5 w-2/3 animate-pulse rounded bg-[#1e2530]" />
                  </div>
                ) : (
                  <div className="m-2 rounded-xl border border-dashed border-[#2b3543] p-5 text-center">
                    <FolderOpen className="mx-auto h-8 w-8 text-[#38bdf8] mb-2" />
                    <h3 className="text-xs font-semibold text-white">No folder opened</h3>
                    <p className="mt-1 text-[11px] text-[#718096]">
                      Choose a project folder on your computer so Alisa can inspect and code inside it.
                    </p>
                    <button
                      type="button"
                      onClick={handlePickFolder}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#38bdf8] px-3 py-1.5 text-xs font-semibold text-[#0c131d] shadow hover:bg-[#60a5fa]"
                    >
                      <FolderOpen className="h-3.5 w-3.5" /> Open Local Folder
                    </button>
                  </div>
                )}
              </div>
            ) : sidebarView === 'projects' ? (
              <div className="p-3 space-y-3">
                <button
                  type="button"
                  onClick={handlePickFolder}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#202735] to-[#2b3547] p-3 text-xs font-semibold text-white shadow-sm hover:from-[#293245] hover:to-[#38455e]"
                >
                  <FolderOpen className="h-4 w-4 text-[#38bdf8]" />
                  <span>Open Another Project Folder</span>
                </button>

                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6c7b90] px-1 pt-1">
                  Recent Workspaces ({recentWorkspaces.length})
                </div>

                <div className="space-y-1">
                  {recentWorkspaces.map((p) => {
                    const name = p.split(/[\\/]/).filter(Boolean).pop() || p;
                    const isCurrent = p === workspaceDir;
                    return (
                      <div
                        key={p}
                        onClick={() => handleSwitchToWorkspace(p)}
                        className={`group relative flex items-center justify-between rounded-lg p-2.5 text-left text-xs transition cursor-pointer ${
                          isCurrent
                            ? 'border border-[#38bdf8]/40 bg-[#16212e] text-white shadow-sm'
                            : 'border border-transparent bg-[#13171f] text-[#a0afc4] hover:border-[#2b3543] hover:bg-[#1a202a] hover:text-white'
                        }`}
                      >
                        <div className="min-w-0 flex-1 pr-2">
                          <div className="flex items-center gap-1.5 font-semibold">
                            <Folder className={`h-3.5 w-3.5 shrink-0 ${isCurrent ? 'text-[#38bdf8]' : 'text-[#6c7d96]'}`} />
                            <span className="truncate">{name}</span>
                            {isCurrent && (
                              <span className="rounded bg-[#0d2818] px-1.5 py-0.5 text-[9px] font-bold text-[#4ade80]">
                                CURRENT
                              </span>
                            )}
                          </div>
                          <div className="mt-1 truncate font-mono text-[10px] text-[#556578]">{p}</div>
                        </div>
                        <div className="shrink-0 flex items-center gap-1">
                          <button
                            type="button"
                            title="Reveal in Explorer"
                            onClick={(e) => handleRevealInExplorer(p, e)}
                            className="p-1 rounded hover:bg-[#252f3d] text-[#64748b] hover:text-white"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </button>
                          {!isCurrent && (
                            <button
                              type="button"
                              title="Remove from history"
                              onClick={(e) => handleRemoveRecent(p, e)}
                              className="p-1 rounded hover:bg-[#252f3d] text-[#64748b] hover:text-[#f87171]"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* Sessions View */
              <div className="space-y-4 p-3">
                <button
                  type="button"
                  onClick={handleNewChat}
                  className="alisa-primary-action flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-[#13161b] shadow-sm transition hover:bg-white"
                >
                  <Plus className="h-4 w-4" /> New chat session
                </button>

                <div>
                  <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#687487]">
                    Current session
                  </div>
                  <button
                    type="button"
                    onClick={() => { setActiveTab('chat'); if (window.innerWidth < 768) setIsSidebarOpen(false); }}
                    className="alisa-session-current group flex w-full items-start gap-3 rounded-xl border border-[#3e4c60] bg-[#1a222d] p-3 text-left transition hover:border-[#657895] hover:bg-[#202a37]"
                  >
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#2c3a4d] text-[#a9c0df]">
                      <Bot className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-white">{workspaceLabel}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-[#8d9aae]">
                        {recentSessionPrompts[0]?.content || 'Ready for coding task'}
                      </span>
                    </span>
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#4fd27b]" />
                  </button>
                </div>

                <div className="space-y-1" aria-label="Saved chats">
                  {savedSessions.map(session => <button key={session.id} type="button"
                    disabled={['thinking', 'acting', 'waiting_approval'].includes(status)}
                    onClick={() => { fetchProjectSessions(workspaceDir, session.id); setActiveTab('chat'); }}
                    className={`block w-full truncate rounded-lg px-3 py-2 text-left text-xs disabled:opacity-50 ${session.id === sessionIdRef.current ? 'bg-[#253247] text-white' : 'text-[#9aa7b9] hover:bg-[#1a2028]'}`}>
                    {session.title}
                  </button>)}
                </div>
                {recentSessionPrompts.length > 0 && (
                  <div>
                    <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#687487]">
                      Recent prompts
                    </div>
                    <div className="space-y-1">
                      {recentSessionPrompts.map((prompt, index) => (
                        <button
                          key={`${prompt.id}-${index}`}
                          type="button"
                          onClick={() => { setInputPrompt(prompt.content); setActiveTab('chat'); if (window.innerWidth < 768) setIsSidebarOpen(false); }}
                          className="flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-[#9aa7b9] transition hover:bg-[#1a2028] hover:text-white"
                        >
                          <span className="mt-0.5 shrink-0 text-[#53647b]">
                            {index === 0 ? <CircleDot className="h-3 w-3 text-[#8da4c6]" /> : <ArrowRight className="h-3 w-3" />}
                          </span>
                          <span className="line-clamp-2 min-w-0 leading-5 text-[11px]">{prompt.content}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sidebar Footer */}
          <div className="shrink-0 border-t border-[#252a33] bg-[#0c0f14] p-3">
            <button
              type="button"
              onClick={handlePickFolder}
              className="flex w-full items-center gap-2 rounded-lg border border-[#2b3543] bg-[#161c24] px-2.5 py-2 text-left text-xs font-medium text-[#c4cbd6] transition hover:border-[#4d5e75] hover:bg-[#202734] hover:text-white"
            >
              <FolderOpen className="h-4 w-4 text-[#38bdf8] shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-white">{workspaceLabel}</div>
                <div className="truncate text-[10px] text-[#68778a]">Click to switch folder</div>
              </div>
              <ArrowRight className="h-3 w-3 text-[#64748b] shrink-0" />
            </button>
          </div>
        </aside>

        {/* Main Central View Area */}
        <main className="alisa-main min-w-0 flex flex-1 flex-col bg-[#0b0d10]">
          {/* View Tab Bar */}
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-[#252a33] bg-[#11141a] px-3 sm:px-4">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <button
                type="button"
                onClick={() => setIsSidebarOpen(true)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#8f9aaa] hover:bg-[#1d232c] hover:text-white md:hidden"
                aria-label="Open workspace sidebar"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>

              <nav className="tab-scroll flex min-w-0 items-center gap-1 overflow-x-auto" aria-label="Workspace views">
                {[
                  { id: 'chat' as const, label: 'Chat', icon: Bot },
                  { id: 'editor' as const, label: 'Editor', icon: Code2, badge: selectedFile ? selectedFile.split(/[\\/]/).pop() : undefined },
                  { id: 'terminal' as const, label: 'Activity & Terminal', icon: Activity, count: terminalLogs.length },
                  { id: 'project' as const, label: 'Review & Schedules', icon: GitBranch },
                  { id: 'skills' as const, label: 'Skills & plugins', icon: Puzzle, count: skills.length },
                ].map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition sm:px-3 ${
                        isActive
                          ? 'bg-[#222a36] text-white shadow-sm ring-1 ring-white/10'
                          : 'text-[#8290a3] hover:bg-[#181d26] hover:text-[#d8dde6]'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{tab.label}</span>
                      {tab.badge && (
                        <span className="rounded bg-[#353e4c] px-1.5 py-0.2 text-[10px] text-[#93c5fd] font-mono truncate max-w-[120px]">
                          {tab.badge}
                        </span>
                      )}
                      {tab.count !== undefined && (
                        <span className={`rounded px-1.5 py-0.2 text-[10px] ${isActive ? 'bg-[#353e4c] text-[#dce3ee]' : 'bg-[#181e28] text-[#728096]'}`}>
                          {tab.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <div className="hidden xl:flex shrink-0 items-center gap-1.5 text-[11px] text-[#78889e]">
                <Folder className="h-3 w-3 text-[#38bdf8]" />
                <span className="truncate max-w-[180px]">{workspaceLabel}</span>
              </div>
            </div>
          </div>

          {/* Update Notice Banner if available */}
          {updateBannerVisible && (
            <div role="status" className={`flex flex-wrap items-center gap-3 border-b px-4 py-2 text-xs sm:px-6 ${updateState.status === 'error' ? 'border-[#59343b] bg-[#27181d] text-[#f0a9b1]' : 'border-[#3d4a5d] bg-[#17202b] text-[#cbd9eb]'}`}>
              <span className="inline-flex items-center gap-2 font-semibold text-white">
                {updateState.status === 'available' && <Download className="h-3.5 w-3.5 text-[#8da4c6]" />}
                {updateState.status === 'downloading' && <RefreshCw className="h-3.5 w-3.5 animate-spin text-[#8da4c6]" />}
                {updateState.status === 'downloaded' && <CheckCircle2 className="h-3.5 w-3.5 text-[#7ee787]" />}
                {updateState.status === 'error' && <AlertCircle className="h-3.5 w-3.5 text-[#ff8a80]" />}
                <span>
                  {updateState.status === 'available' ? `Update ${updateState.version || ''} ready` : updateState.status === 'downloaded' ? 'Update downloaded' : 'Update status'}
                </span>
              </span>
              <span className="min-w-0 flex-1 text-[#8f9db0]">{updateState.message}</span>
              {updateState.status === 'available' && (
                <button type="button" onClick={handleDownloadUpdate} disabled={isUpdateActionRunning} className="rounded-lg bg-[#f0f2f5] px-3 py-1 font-semibold text-[#13161b] hover:bg-white disabled:opacity-50">Download</button>
              )}
              {updateState.status === 'downloaded' && (
                <button type="button" onClick={handleInstallUpdate} className="rounded-lg bg-[#7ee787] px-3 py-1 font-semibold text-[#102016] hover:bg-[#a3f0ae]">Restart</button>
              )}
              <button type="button" onClick={() => setUpdateNoticeDismissed(true)} className="p-1 text-[#7e8da1] hover:text-white"><X className="h-3.5 w-3.5" /></button>
            </div>
          )}

          {/* Tab 1: Chat View */}
          <div className="min-h-0 flex-1">
            {activeTab === 'project' && <ProjectPanel apiBase={API_BASE} workspace={workspaceDir} openSession={id => { fetchProjectSessions(workspaceDir, id); setActiveTab('chat'); }} />}
            {activeTab === 'chat' && (
              <div className="flex h-full min-h-0 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
                  <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
                    {messages.length === 0 && !streamingContent && activeToolTraces.length === 0 && (
                      <div className="alisa-hero flex flex-1 flex-col items-center justify-start py-10 text-center sm:justify-center sm:py-16">
                        <div className="alisa-hero-mark mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f4f5f7] text-2xl font-bold text-[#12151a] shadow-lg">
                          🍓
                        </div>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-[#8290a3]">Project Alisa Studio</p>
                        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">What are we building today?</h1>
                        <p className="mt-2 max-w-lg text-sm leading-6 text-[#8995a7]">
                          Alisa is grounded inside <span className="text-[#38bdf8] font-mono">{workspaceLabel}</span>. Ask to inspect files, edit code, or run commands.
                        </p>

                        <div className="mt-6 grid w-full max-w-2xl grid-cols-1 gap-2.5 sm:grid-cols-3">
                          {[
                            ['Inspect project', 'สรุปโครงสร้างโปรเจกต์และไฟล์สำคัญในโฟลเดอร์นี้', FolderTree],
                            ['Audit & Find bugs', 'วิเคราะห์หาบั๊กและปรับปรุงความปลอดภัยในโค้ดนี้', Bug],
                            ['Refactor code', 'ช่วย Refactor โค้ดให้มี Type-safety และ Clean Architecture', Sparkles]
                          ].map(([label, prompt, Icon]) => {
                            const PromptIcon = Icon as typeof FolderTree;
                            return (
                              <button
                                key={label as string}
                                type="button"
                                onClick={() => { setInputPrompt(prompt as string); setActiveTab('chat'); }}
                                className="alisa-suggestion-card group rounded-xl border border-[#2b333f] bg-[#151a21] p-3.5 text-left transition hover:-translate-y-0.5 hover:border-[#53647b] hover:bg-[#1b222c]"
                              >
                                <span className="mb-2 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#202936] text-[#a9b9d0] group-hover:text-white">
                                  <PromptIcon className="h-4 w-4" />
                                </span>
                                <span className="block text-xs font-semibold text-[#e5e9ef]">{label as string}</span>
                                <span className="mt-1 block text-[11px] text-[#7d899b] truncate">{prompt as string}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Chat Messages */}
                    {messages.map((m, messageIndex) => (
                      <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex gap-3'}>
                        {m.role === 'assistant' && (
                          <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#f4f5f7] text-xs font-bold text-[#12151a]">
                            🍓
                          </div>
                        )}
                        <div className={m.role === 'user' ? 'max-w-[85%] sm:max-w-[75%]' : 'min-w-0 max-w-[88%] sm:max-w-[78%]'}>
                          {m.role === 'user' ? (
                            <div className="rounded-2xl rounded-br-md bg-[#253040] px-4 py-3 text-sm leading-6 text-[#f1f4f8] shadow-sm">
                              {m.content}
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {/* Tool Traces */}
                              {m.toolTraces?.map((trace, idx) => (
                                <div key={`${trace.toolCallId}-${idx}`} className="rounded-xl border border-[#2b333f] bg-[#151a21] p-3 text-xs">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded bg-[#222b38] px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-[#b6c6dc]">
                                      {trace.toolName}
                                    </span>
                                    <span className={`rounded px-2 py-1 text-[10px] font-medium ${trace.status === 'success' ? 'bg-[#183322] text-[#8ce0a7]' : trace.status === 'error' ? 'bg-[#3a2025] text-[#f2a2aa]' : 'bg-[#3b3019] text-[#f1c671]'}`}>
                                      {trace.status}
                                    </span>
                                  </div>
                                  {(trace.result || trace.error) && (
                                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-[#0d1015] p-2.5 font-mono text-[11px] leading-5 text-[#9da8b8]">
                                      {trace.error || trace.result}
                                    </pre>
                                  )}
                                </div>
                              ))}

                              {/* Thought / Reasoning trace */}
                              {m.thought && (
                                <details className="rounded-xl border border-[#2b333f] bg-[#12171e] text-xs text-[#8c99aa]">
                                  <summary className="cursor-pointer px-3 py-2 font-medium text-[#aab6c7]">
                                    🧠 Alisa Reasoning Trace
                                  </summary>
                                  <div className="border-t border-[#252d38] px-3 py-2.5 whitespace-pre-wrap leading-5">
                                    {m.thought}
                                  </div>
                                </details>
                              )}

                              {/* Message Content */}
                              <div className="rounded-2xl rounded-tl-md border border-[#252d38] bg-[#151a21] px-4 py-3.5 text-sm leading-6 text-[#e1e6ed] shadow-sm">
                                <div className="whitespace-pre-wrap">{m.content ? renderAssistantContent(m.content) : m.toolTraces?.length ? 'Tool activity' : 'Preparing tool activity…'}</div>
                              </div>

                              <div className="mt-2 flex items-center gap-3">
                                <button
                                  type="button"
                                  onClick={() => handleRetryMessage(messageIndex)}
                                  disabled={isBusy}
                                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#8290a3] transition hover:text-white disabled:opacity-40"
                                >
                                  <RefreshCw className="h-3.5 w-3.5" /> Retry
                                </button>
                              </div>
                            </div>
                          )}
                          <div className={`mt-1.5 text-[10px] text-[#637083] ${m.role === 'user' ? 'text-right' : ''}`}>
                            {m.role === 'user' ? 'You' : 'Alisa'} · {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Active Streaming Content */}
                    {(streamingContent || streamingThought || activeToolTraces.length > 0) && (
                      <div className="flex gap-3">
                        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#f4f5f7] text-xs font-bold text-[#12151a]">
                          🍓
                        </div>
                        <div className="min-w-0 max-w-[88%] space-y-3 sm:max-w-[78%]">
                          {activeToolTraces.map((trace, idx) => (
                            <div key={`${trace.toolCallId}-${idx}`} className="rounded-xl border border-[#3d3523] bg-[#1b1811] p-3 text-xs">
                              <div className="flex items-center gap-2">
                                <span className="rounded bg-[#332a18] px-2 py-1 font-mono text-[10px] uppercase text-[#f1c671]">{trace.toolName}</span>
                                <span className="text-[#c89d45]">Running tool…</span>
                              </div>
                            </div>
                          ))}

                          {streamingThought && (
                            <details open className="rounded-xl border border-[#2b333f] bg-[#12171e] text-xs text-[#8c99aa]">
                              <summary className="cursor-pointer px-3 py-2 font-medium text-[#aab6c7]">
                                🧠 Thinking…
                              </summary>
                              <div className="border-t border-[#252d38] px-3 py-2.5 whitespace-pre-wrap leading-5">
                                {streamingThought}
                              </div>
                            </details>
                          )}

                          {streamingContent && (
                            <div className="rounded-2xl rounded-tl-md border border-[#252d38] bg-[#151a21] px-4 py-3.5 text-sm leading-6 text-[#e1e6ed] whitespace-pre-wrap">
                              {renderAssistantContent(streamingContent)}
                              <span className="ml-1 inline-block h-4 w-1 animate-pulse bg-[#8da4c6] align-[-2px]" />
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                </div>

                {/* Chat Composer */}
                <div className="shrink-0 border-t border-[#252a33] bg-[#11141a] px-3 py-3 sm:px-6 sm:py-4">
                  <div className="mx-auto max-w-4xl">
                    <div className="alisa-composer relative rounded-2xl border border-[#303846] bg-[#151a21] shadow-[0_12px_30px_rgba(0,0,0,.2)] focus-within:border-[#53647b]">
                      {/* Active Workspace Pill in Composer */}
                      <div className="flex items-center justify-between border-b border-[#222832] px-3.5 py-1.5 text-xs text-[#7e8e9f]">
                        <div className="flex items-center gap-1.5 truncate">
                          <Folder className="h-3 w-3 text-[#38bdf8] shrink-0" />
                          <span className="text-[11px]">Workspace:</span>
                          <span className="font-semibold text-white truncate max-w-[280px]">{workspaceLabel}</span>
                        </div>
                        <button
                          type="button"
                          onClick={handlePickFolder}
                          className="text-[11px] text-[#38bdf8] hover:underline"
                        >
                          Change folder
                        </button>
                      </div>

                      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-[#9aa7b9]">
                        <label className="flex items-center gap-2">Mode
                          <select aria-label="Agent mode" value={agentMode} disabled={['thinking', 'acting', 'waiting_approval'].includes(status)} onChange={e => setAgentMode(e.target.value as 'ask' | 'code')} className="rounded border border-[#39475b] bg-[#151c27] px-2 py-1 text-white">
                            <option value="ask">Ask · read only</option><option value="code">Code · edit workspace</option>
                          </select>
                        </label>
                        <span>{agentMode === 'ask' ? 'Reads files; no edits or terminal.' : 'File edits stay in this workspace. Shell commands need approval.'}</span>
                      </div>
                      {approval && <div role="alert" className="mb-3 rounded-xl border border-amber-600 bg-[#282015] p-3 text-sm text-amber-100">
                        <strong>Allow {approval.action}?</strong>
                        <p className="my-2 text-xs">This command runs with your OS permissions, outside file-tool restrictions.</p>
                        <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-xs">{String(approval.details.command || JSON.stringify(approval.details))}</pre>
                        <div className="mt-3 flex gap-2">{[true, false].map(approved => <button type="button" key={String(approved)} className="rounded border border-amber-600 px-3 py-1" onClick={() => {
                          wsRef.current?.send(JSON.stringify({ type: 'approval_response', resolveId: approval.resolveId, approved })); setApproval(null);
                        }}>{approved ? 'Allow once' : 'Deny'}</button>)}</div>
                      </div>}
                      <textarea
                        rows={3}
                        value={inputPrompt}
                        onChange={(e) => setInputPrompt(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            handleSendPrompt();
                          }
                        }}
                        placeholder={`Ask Alisa to code, inspect, or modify files in ${workspaceLabel}…`}
                        aria-label="Message Alisa"
                        className="min-h-[85px] w-full resize-none bg-transparent px-4 py-3 text-sm leading-6 text-white placeholder-[#687487] focus:outline-none"
                      />

                      {/* Composer Controls */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#222832] px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setShowModelPicker((open) => !open)}
                            className="alisa-model-trigger inline-flex min-w-0 items-center gap-1.5 rounded-lg bg-[#202733] px-2.5 py-1.5 text-xs font-medium text-[#c3d0e2] transition hover:bg-[#293341] hover:text-white"
                          >
                            <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#c6a15a]" />
                            <span className="max-w-[8.5rem] truncate">{selectedModel?.label || model}</span>
                            <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[#718097] transition-transform ${showModelPicker ? 'rotate-180' : ''}`} />
                          </button>

                          <button
                            type="button"
                            onClick={() => setShowCommandPalette(true)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#202733] px-2.5 py-1.5 text-xs font-medium text-[#a9b6c8] transition hover:bg-[#293341] hover:text-white"
                          >
                            <Command className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Actions</span>
                          </button>

                          <span className="hidden items-center gap-1.5 rounded-lg bg-[#202733] px-2.5 py-1.5 text-xs text-[#8d9aae] sm:inline-flex">
                            <Puzzle className="h-3.5 w-3.5 text-[#c6a15a]" /> {activeSkillNames.length} skills
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="hidden text-[11px] text-[#637083] sm:inline">
                            Enter to send · Shift+Enter for newline
                          </span>
                          {isBusy ? (
                            <button
                              type="button"
                              onClick={handleAbortTask}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-[#3a2025] px-3.5 py-1.5 text-xs font-semibold text-[#f2a2aa] transition hover:bg-[#4a252c]"
                            >
                              <Square className="h-3.5 w-3.5 fill-current" /> Stop
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleSendPrompt()}
                              disabled={!inputPrompt.trim() || !isBackendConnected}
                              className="alisa-primary-action inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold text-[#13161b] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Send className="h-3.5 w-3.5" /> Send
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Model Picker Menu */}
                      {showModelPicker && (
                        <div className="alisa-model-menu absolute bottom-14 left-3 z-20 w-[min(19rem,calc(100%-1.5rem))] overflow-hidden rounded-xl border border-[#3a4351] bg-[#1b2028] p-1.5 shadow-[0_18px_46px_rgba(0,0,0,.48)]">
                          <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#687487]">
                            Select AI Model
                          </div>
                          {MODEL_OPTIONS.map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => handleSelectModel(option.id)}
                              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${model === option.id ? 'bg-[#2b3543] text-white' : 'text-[#c0c9d6] hover:bg-[#252d38] hover:text-white'}`}
                            >
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#273241] text-[#c6a15a]">
                                <Sparkles className="h-3.5 w-3.5" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-medium">{option.label}</span>
                                <span className="block truncate text-[10px] text-[#7f8da1]">{option.description}</span>
                              </span>
                              {model === option.id && <Check className="h-3.5 w-3.5 shrink-0 text-[#7ee787]" />}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => { setShowModelPicker(false); setShowSettings(true); }}
                            className="mt-1 flex w-full items-center gap-2 border-t border-[#303846] px-2.5 py-2 text-left text-xs font-medium text-[#9aa8ba] hover:text-white"
                          >
                            <Sliders className="h-3.5 w-3.5" /> Manage custom keys & endpoint
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: Code Editor */}
            {activeTab === 'editor' && (
              <div className="flex h-full min-h-0 flex-col bg-[#0b0e13]">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#252a33] bg-[#11141a] px-4 py-2.5">
                  <div className="min-w-0 flex items-center gap-2">
                    {selectedFile ? getFileIcon(selectedFile) : <Code2 className="h-4 w-4 text-[#8da4c6]" />}
                    <span className="truncate text-xs font-mono font-medium text-white" title={selectedFile || undefined}>
                      {selectedFile || 'No file selected — choose from Explorer'}
                    </span>
                    {selectedFile && (
                      <button
                        type="button"
                        onClick={(e) => handleRevealInExplorer(selectedFile, e)}
                        className="p-1 text-[#6b7b91] hover:text-white"
                        title="Reveal in Explorer"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`text-xs ${editorDirty ? 'text-[#d5b36a]' : 'text-[#718097]'}`}>
                      {editorDirty ? '● Unsaved changes' : selectedFile ? 'Saved' : ''}
                    </span>

                    {selectedFile && (
                      <button
                        type="button"
                        onClick={() => handleAddFileToPrompt(selectedFile)}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#303846] bg-[#1a1f27] px-2.5 py-1.5 text-xs text-[#a9b6c8] hover:border-[#4f5f76] hover:text-white"
                      >
                        <Bot className="h-3 w-3 text-[#38bdf8]" /> Ask Alisa
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={!selectedFile || editorDirty || isSavingFile}
                      onClick={() => selectedFile && handleFileClick(selectedFile)}
                      className="rounded-lg border border-[#303846] bg-[#1a1f27] px-2.5 py-1.5 text-xs font-medium text-[#a9b6c8] hover:border-[#53647b] hover:text-white disabled:opacity-40"
                    >
                      Reload
                    </button>

                    <button
                      type="button"
                      disabled={!selectedFile || !editorDirty || isSavingFile}
                      onClick={handleSaveFile}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#38bdf8] px-3 py-1.5 text-xs font-semibold text-[#0c141f] hover:bg-[#60a5fa] disabled:opacity-40"
                    >
                      <Save className="h-3.5 w-3.5" />
                      {isSavingFile ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>

                {editorError && (
                  <div className="border-b border-[#59343b] bg-[#27181d] px-4 py-2 text-xs text-[#f0a9b1]">
                    {editorError}
                  </div>
                )}

                {selectedFile ? (
                  <textarea
                    value={editorDraft}
                    onChange={(e) => setEditorDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                        e.preventDefault();
                        handleSaveFile();
                      }
                    }}
                    spellCheck={false}
                    aria-label={`Editing ${selectedFile}`}
                    className="min-h-0 flex-1 resize-none overflow-auto bg-[#0d1015] px-4 py-4 font-mono text-[13px] leading-6 text-[#d8dee8] outline-none sm:px-6"
                  />
                ) : (
                  <div className="flex flex-1 items-center justify-center p-6">
                    <div className="max-w-sm text-center">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1c222c] text-[#38bdf8]">
                        <FileCode className="h-6 w-6" />
                      </div>
                      <h2 className="mt-4 text-base font-semibold text-white">Select a file in Explorer</h2>
                      <p className="mt-1 text-sm leading-6 text-[#778396]">
                        Click any file in the left sidebar to inspect and edit code.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tab 3: Activity & Terminal */}
            {activeTab === 'terminal' && (
              <div className="flex h-full min-h-0 flex-col bg-[#0b0e13]">
                <div className="flex items-center justify-between border-b border-[#252a33] bg-[#11141a] px-4 py-2.5">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <Activity className="h-4 w-4 text-[#38bdf8]" /> Activity & Workspace Terminal
                    </div>
                    <p className="text-[11px] text-[#718097]">
                      Commands execute directly inside <span className="font-mono text-white">{workspaceDir}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTerminalLogs([])}
                    className="rounded-lg border border-[#303846] bg-[#1a1f27] px-2.5 py-1 text-xs font-medium text-[#a9b6c8] hover:border-[#53647b] hover:text-white"
                  >
                    Clear Logs
                  </button>
                </div>

                <form onSubmit={(event) => { event.preventDefault(); handleRunTerminal(); }} className="flex flex-wrap gap-2 border-b border-[#252a33] bg-[#0f1319] p-3">
                  <div className="flex min-w-0 flex-1 items-center rounded-xl border border-[#303846] bg-[#151a21] focus-within:border-[#657895]">
                    <span className="select-none pl-3 font-mono text-sm text-[#657895]">$</span>
                    <input
                      value={terminalCommand}
                      onChange={(event) => setTerminalCommand(event.target.value)}
                      aria-label="Terminal command"
                      placeholder="Run command in this workspace (e.g. bun run build, git status, npm test)…"
                      className="min-w-0 flex-1 bg-transparent px-2.5 py-2.5 font-mono text-sm text-white outline-none placeholder-[#687487]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!terminalCommand.trim() || isTerminalRunning || !isBackendConnected}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#f0f2f5] px-4 py-2.5 text-sm font-semibold text-[#13161b] transition hover:bg-white disabled:opacity-40"
                  >
                    {isTerminalRunning ? <Activity className="h-4 w-4 animate-pulse" /> : <Play className="h-4 w-4" />}
                    {isTerminalRunning ? 'Running…' : 'Run'}
                  </button>
                </form>

                {terminalError && <div className="border-b border-[#59343b] bg-[#27181d] px-4 py-2 text-xs text-[#f0a9b1]">{terminalError}</div>}

                <div className="min-h-0 flex-1 overflow-y-auto bg-[#0d1015] px-4 py-4 custom-scrollbar sm:px-6">
                  <div className="mx-auto max-w-5xl space-y-1 font-mono text-xs leading-5">
                    {terminalLogs.length === 0 ? (
                      <div className="py-8 text-center text-[#637083]">No activity yet. Run a command or ask Alisa to inspect code.</div>
                    ) : (
                      terminalLogs.slice(-300).map((log, i) => (
                        <div key={`${log}-${i}`} className="whitespace-pre-wrap break-words text-[#9aa7b9]">
                          <span className="mr-2 select-none text-[#53647b]">›</span>{log}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Tab 4: Skills System */}
            {activeTab === 'skills' && (
              <div className="h-full overflow-y-auto custom-scrollbar bg-[#0b0e13]">
                <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b8a2da]">Autonomous Guidance</p>
                      <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">Agent Skills & Local Plugins</h1>
                      <p className="mt-1 text-sm leading-6 text-[#8995a7]">
                        Enable instructions for this chat. Local plugins provide skill bundles; external tool servers and marketplace installation are not supported yet.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={fetchSkills}
                      className="inline-flex items-center gap-2 rounded-lg border border-[#303846] bg-[#1a1f27] px-3.5 py-2 text-sm font-medium text-[#c4cbd6] hover:border-[#53647b] hover:text-white"
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Refresh Skills
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {skills.map((skill) => {
                      const isActive = activeSkillNames.includes(skill.name);
                      return (
                        <div
                          key={skill.name}
                          className={`rounded-2xl border p-4 transition ${isActive ? 'border-[#4a4161] bg-[#1b1824]' : 'border-[#2b333f] bg-[#151a21]'}`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h2 className="break-all text-sm font-semibold text-white">{skill.name}</h2>
                                <span className="rounded bg-[#252d38] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#8f9aaa]">
                                  {skill.category}
                                </span>
                              </div>
                              <p className="mt-2 text-xs leading-5 text-[#8995a7]">{skill.description}</p>
                              <p className="mt-2.5 text-[10px] font-mono text-[#637083]">{skill.source}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => toggleSkillActive(skill.name)}
                              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${isActive ? 'bg-[#c7b0e7] text-[#211b2b] hover:bg-[#d7c5ef]' : 'border border-[#394454] bg-[#202733] text-[#a9b6c8] hover:border-[#657895] hover:text-white'}`}
                            >
                              {isActive ? 'Enabled' : 'Enable'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Modal: Open / Switch Workspace (Native Dialog + History) */}
      {showWorkspacePicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4"
          role="presentation"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowWorkspacePicker(false); }}
        >
          <div className="w-full max-w-lg rounded-2xl border border-[#374354] bg-[#151a22] p-5 shadow-[0_24px_70px_rgba(0,0,0,.6)] sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#38bdf8]">Workspace Manager</p>
                <h2 className="mt-1 text-lg font-bold text-white">Open Project Folder</h2>
                <p className="mt-1 text-sm leading-5 text-[#8995a7]">
                  Choose a directory on your computer so Alisa can code inside it.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowWorkspacePicker(false)}
                className="p-1 rounded-md text-[#8290a3] hover:bg-[#202733] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Big Primary Action: Native Folder Picker */}
            <div className="mt-5">
              <button
                type="button"
                onClick={handlePickFolder}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-[#38bdf8]/40 bg-gradient-to-r from-[#1c2738] to-[#25354e] p-4 text-left transition hover:border-[#38bdf8] hover:from-[#223147] hover:to-[#2e4263]"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#38bdf8]/15 text-[#38bdf8]">
                    <FolderOpen className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">Browse Folder on Computer…</div>
                    <div className="text-xs text-[#8da2bd]">Opens Windows File Explorer dialog</div>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-[#38bdf8]" />
              </button>
            </div>

            {/* Recent Workspaces List */}
            {recentWorkspaces.length > 0 && (
              <div className="mt-5">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#738297]">
                  Recent Workspaces
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1.5 custom-scrollbar">
                  {recentWorkspaces.map((pathItem) => {
                    const name = pathItem.split(/[\\/]/).filter(Boolean).pop() || pathItem;
                    const isCurrent = pathItem === workspaceDir;
                    return (
                      <div
                        key={pathItem}
                        onClick={() => handleSwitchToWorkspace(pathItem)}
                        className={`group flex items-center justify-between rounded-lg border p-2 text-xs transition cursor-pointer ${
                          isCurrent
                            ? 'border-[#38bdf8]/50 bg-[#172230] text-white'
                            : 'border-[#242d3a] bg-[#11141b] text-[#9bb0c9] hover:border-[#3b4b5e] hover:bg-[#1a212d] hover:text-white'
                        }`}
                      >
                        <div className="min-w-0 flex-1 pr-2">
                          <div className="flex items-center gap-1.5 font-medium">
                            <Folder className={`h-3.5 w-3.5 ${isCurrent ? 'text-[#38bdf8]' : 'text-[#64748b]'}`} />
                            <span className="truncate">{name}</span>
                            {isCurrent && <span className="rounded bg-[#0d2818] px-1.5 py-0.5 text-[9px] font-bold text-[#4ade80]">CURRENT</span>}
                          </div>
                          <div className="mt-0.5 font-mono text-[10px] text-[#556477] truncate">{pathItem}</div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => handleRemoveRecent(pathItem, e)}
                          className="p-1 rounded text-[#556477] hover:text-[#f87171]"
                          title="Remove from recent"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Manual Path Input */}
            <form onSubmit={(e) => { e.preventDefault(); handleSwitchToWorkspace(workspaceInput); }} className="mt-5 border-t border-[#262f3c] pt-4">
              <label htmlFor="workspace-path" className="block text-xs font-medium text-[#a9b6c8]">
                Or enter absolute path
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  id="workspace-path"
                  type="text"
                  value={workspaceInput}
                  onChange={(e) => setWorkspaceInput(e.target.value)}
                  placeholder="C:/Users/you/Projects/my-project"
                  className="min-w-0 flex-1 rounded-xl border border-[#303846] bg-[#0d1015] px-3.5 py-2.5 font-mono text-xs text-white outline-none focus:border-[#657895]"
                />
                <button
                  type="submit"
                  className="rounded-xl bg-[#f0f2f5] px-4 py-2.5 text-xs font-semibold text-[#13161b] hover:bg-white"
                >
                  Open
                </button>
              </div>
              {workspaceSwitchError && (
                <div className="mt-3 rounded-xl border border-[#59343b] bg-[#27181d] px-3 py-2 text-xs text-[#f0a9b1]">
                  {workspaceSwitchError}
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* Modal: Create File / Folder */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4"
          role="presentation"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowCreateModal(false); }}
        >
          <form
            onSubmit={handleCreateFileOrFolder}
            className="w-full max-w-md rounded-2xl border border-[#374354] bg-[#151a22] p-5 shadow-[0_24px_70px_rgba(0,0,0,.6)]"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold text-white">
                {isCreatingDirectory ? <FolderPlus className="h-4 w-4 text-[#38bdf8]" /> : <FilePlus className="h-4 w-4 text-[#38bdf8]" />}
                <span>Create New {isCreatingDirectory ? 'Folder' : 'File'}</span>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1 text-[#8290a3] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-1 text-xs text-[#7e8e9f]">
              Relative to active workspace: <span className="font-mono text-white">{workspaceLabel}</span>
            </p>

            <input
              autoFocus
              type="text"
              value={createItemName}
              onChange={(e) => setCreateItemName(e.target.value)}
              placeholder={isCreatingDirectory ? 'e.g. src/components' : 'e.g. src/utils.ts'}
              className="mt-4 w-full rounded-xl border border-[#303846] bg-[#0d1015] px-3.5 py-2.5 font-mono text-xs text-white outline-none focus:border-[#657895]"
            />

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-lg border border-[#303846] bg-[#1a1f27] px-3 py-1.5 text-xs text-[#a9b6c8] hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-[#38bdf8] px-3.5 py-1.5 text-xs font-semibold text-[#0b131e] hover:bg-[#60a5fa]"
              >
                Create
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Command Palette */}
      {showCommandPalette && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/75 px-4 pt-[12vh]"
          role="presentation"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowCommandPalette(false); }}
        >
          <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-[#3a4351] bg-[#151a21] shadow-[0_24px_70px_rgba(0,0,0,.6)]" role="dialog">
            <div className="flex items-center gap-3 border-b border-[#2b333f] px-4 py-3">
              <Search className="h-4 w-4 shrink-0 text-[#7e8ba0]" />
              <input
                autoFocus
                value={commandSearch}
                onChange={(e) => setCommandSearch(e.target.value)}
                placeholder="Type a command or search action…"
                className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder-[#687487]"
              />
              <kbd className="rounded bg-[#252d38] px-2 py-1 text-[10px] text-[#8f9aaa]">Esc</kbd>
            </div>

            <div className="max-h-[min(60vh,28rem)] overflow-y-auto p-2 custom-scrollbar">
              {quickCommands
                .filter((cmd) => `${cmd.command} ${cmd.label} ${cmd.description}`.toLowerCase().includes(commandSearch.toLowerCase()))
                .map((cmd) => (
                  <button
                    key={cmd.id}
                    type="button"
                    onClick={() => handleExecuteCommand(cmd)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-[#202733]"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#202733]">{cmd.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-xs font-semibold text-white">
                        <span>{cmd.label}</span>
                        <span className="font-mono text-[10px] text-[#718097]">{cmd.command}</span>
                      </span>
                      <span className="block text-[11px] text-[#8995a7] truncate">{cmd.description}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-[#657895]" />
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Settings */}
      {showSettings && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4"
          role="presentation"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}
        >
          <form
            onSubmit={(event) => { event.preventDefault(); handleSaveConfig(); }}
            className="w-full max-w-lg rounded-2xl border border-[#3a4351] bg-[#151a21] p-5 shadow-[0_24px_70px_rgba(0,0,0,.6)] sm:p-6"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b8a2da]">Configuration</p>
                <h2 className="mt-1 text-lg font-bold text-white">Studio Settings</h2>
                <p className="mt-1 text-sm text-[#8995a7]">Configure LLM provider endpoint, keys, and workspace.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="p-1 rounded-md text-[#8290a3] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 space-y-3.5">
              <div>
                <label htmlFor="settings-api-key" className="text-xs font-medium text-[#a9b6c8]">API Key</label>
                <input
                  id="settings-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={apiKeyMasked ? `Stored key (${apiKeyMasked}) · type new key to replace` : 'Enter API key (OpenRouter / OpenAI)'}
                  className="mt-1.5 w-full rounded-xl border border-[#303846] bg-[#0d1015] px-3.5 py-2.5 text-xs text-white outline-none focus:border-[#657895]"
                />
              </div>

              <div>
                <label htmlFor="settings-base-url" className="text-xs font-medium text-[#a9b6c8]">Base URL</label>
                <input
                  id="settings-base-url"
                  type="url"
                  value={baseURL}
                  onChange={(e) => setBaseURL(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-[#303846] bg-[#0d1015] px-3.5 py-2.5 text-xs text-white outline-none focus:border-[#657895]"
                />
              </div>

              <div>
                <button type="button" disabled={isTestingProvider} className="rounded-lg border border-[#3b485b] px-3 py-2 text-xs text-white disabled:opacity-50" onClick={async () => {
                  setIsTestingProvider(true); setProviderTest('Testing saved provider…');
                  try {
                    const res = await fetch(`${API_BASE}/api/provider/test`, { method: 'POST' });
                    const data = await res.json(); if (!res.ok) throw new Error(data.error);
                    setProviderModels(data.models); setProviderTest(data.message);
                  } catch (err) { setProviderTest(err instanceof Error ? err.message : 'Connection failed'); }
                  finally { setIsTestingProvider(false); }
                }}>Test saved connection</button>
                <p className="mt-2 text-xs text-[#9aa7b9]" role="status">{providerTest || 'Save changed settings first, then test the connection.'}</p>
              </div>
              <div>
                <label htmlFor="settings-model" className="text-xs font-medium text-[#a9b6c8]">Model Identifier</label>
                <input
                  id="settings-model" list="provider-models"
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-[#303846] bg-[#0d1015] px-3.5 py-2.5 text-xs text-white outline-none focus:border-[#657895]"
                />
              </div>

              <div>
                <datalist id="provider-models">{providerModels.map(id => <option key={id} value={id} />)}</datalist>
                <label htmlFor="settings-workspace" className="text-xs font-medium text-[#a9b6c8]">Active Workspace Directory</label>
                <div className="mt-1.5 flex gap-2">
                  <input
                    id="settings-workspace"
                    type="text"
                    value={workspaceDir}
                    readOnly
                    className="min-w-0 flex-1 rounded-xl border border-[#303846] bg-[#0d1015] px-3.5 py-2.5 font-mono text-xs text-white outline-none focus:border-[#657895]"
                  />
                  <button
                    type="button"
                    onClick={handlePickFolder}
                    className="rounded-xl border border-[#38bdf8]/40 bg-[#16212e] px-3 py-2.5 text-xs font-medium text-[#38bdf8] hover:bg-[#202e40]"
                  >
                    Browse…
                  </button>
                </div>
              </div>
            </div>

            {settingsError && (
              <div className="mt-4 rounded-xl border border-[#59343b] bg-[#27181d] px-3 py-2 text-xs text-[#f0a9b1]">
                {settingsError}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2 border-t border-[#2b333f] pt-4">
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="rounded-lg border border-[#303846] bg-[#1a1f27] px-3.5 py-2 text-xs text-[#a9b6c8] hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-[#f0f2f5] px-4 py-2 text-xs font-semibold text-[#13161b] hover:bg-white"
              >
                Save Settings
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
