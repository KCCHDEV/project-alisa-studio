import React, { useState, useEffect, useRef } from 'react';
import { 
  FolderTree, 
  Terminal as TerminalIcon, 
  Send, 
  Settings, 
  RefreshCw, 
  FileCode, 
  Folder, 
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
  Minus,
  Maximize,
  Minimize2,
  Target,
  Command,
  FastForward,
  PlayCircle,
  PauseCircle,
  CheckSquare,
  Search,
  ArrowRight,
  Bug,
  ShieldAlert,
  PanelLeftClose,
  PanelLeftOpen,
  Save,
  CircleDot,
  Download
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
  args: any;
  result?: string;
  error?: string;
  status: 'running' | 'success' | 'error';
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  thought?: string;
  timestamp: number;
  toolTraces?: ToolTrace[];
}

interface SkillItem {
  name: string;
  category: string;
  description: string;
  source: string;
  path: string;
  active?: boolean;
}

interface QuickCommand {
  id: string;
  command: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  category: string;
}

interface UpdateState {
  status: 'idle' | 'dev' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  percent?: number;
  message?: string;
}

function renderAssistantContent(content: string): React.ReactNode {
  const chunks = content.split(/(```[\s\S]*?```)/g);
  return chunks.map((chunk, index) => {
    if (!chunk.startsWith('```')) {
      return chunk ? <span key={`text-${index}`} className="whitespace-pre-wrap">{chunk}</span> : null;
    }

    const lines = chunk.slice(3, -3).replace(/^\r?\n/, '').split(/\r?\n/);
    const language = lines[0]?.trim() || '';
    const code = language && !language.includes(' ') ? lines.slice(1).join('\n') : lines.join('\n');
    return (
      <pre key={`code-${index}`} className="my-3 overflow-x-auto rounded-xl border border-[#303846] bg-[#0b0e13] p-3 font-mono text-[12px] leading-5 text-[#d5dce6]">
        {language && !language.includes(' ') && <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-[#718097]">{language}</div>}
        <code>{code}</code>
      </pre>
    );
  });
}

const API_BASE = (typeof window !== 'undefined' && (window.location.protocol === 'file:' || !window.location.host))
  ? 'http://localhost:3001'
  : '';

const MODEL_OPTIONS = [
  { id: 'auto/best-coding', label: 'Auto — Balanced', description: 'Best fit for coding tasks' },
  { id: 'auto/best-fast', label: 'Best Fast', description: 'Quick answers for small changes' },
  { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat', description: 'General purpose assistant' },
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini', description: 'Fast OpenAI-compatible model' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'chat' | 'editor' | 'terminal' | 'skills'>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [status, setStatus] = useState<'idle' | 'thinking' | 'acting' | 'waiting_approval' | 'self_correcting' | 'error' | 'done'>('idle');
  const [statusDetail, setStatusDetail] = useState('Connecting to backend…');
  const [isBackendConnected, setIsBackendConnected] = useState(false);
  
  // Workspace & Files
  const [workspaceDir, setWorkspaceDir] = useState('');
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [collapsedDirectories, setCollapsedDirectories] = useState<Set<string>>(new Set());
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
  const [sidebarView, setSidebarView] = useState<'sessions' | 'files'>('sessions');
  
  // OpenClaude Skills System State
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [activeSkillNames, setActiveSkillNames] = useState<string[]>([
    'openclaude-code-standards',
    'subagent-orchestration',
    'systematic-debugging'
  ]);

  // Quick Commands & Command Palette Modal
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandSearch, setCommandSearch] = useState('');

  const quickCommands: QuickCommand[] = [
    {
      id: 'c1',
      command: '/goal',
      label: 'Plan a goal',
      description: 'ให้ Alisa แตกเป้าหมายเป็นขั้นตอนแล้วทำงานต่อในแชต',
      icon: <Target className="w-4 h-4 text-[#27c93f]" />,
      category: 'Automation'
    },
    {
      id: 'c2',
      command: '/test',
      label: 'Run Automated Tests',
      description: 'ทดสอบการทำงานของฟังก์ชั่นและตรวจเช็คบั๊ก',
      icon: <CheckSquare className="w-4 h-4 text-[#ffbd2e]" />,
      category: 'Quality'
    },
    {
      id: 'c3',
      command: '/audit',
      label: 'OWASP Security Audit',
      description: 'สแกนตรวจสอบช่องโหว่ความปลอดภัยและคีย์ลับ',
      icon: <ShieldAlert className="w-4 h-4 text-[#ff5f56]" />,
      category: 'Security'
    },
    {
      id: 'c4',
      command: '/refactor',
      label: 'Refactor Codebase',
      description: 'ปรับปรุงโครงสร้างโค้ดให้สะอาดและมี Type-Safety สูงสุด',
      icon: <Code2 className="w-4 h-4 text-[#ffffff]" />,
      category: 'Development'
    },
    {
      id: 'c_rollback',
      command: '/rollback',
      label: '1-Click File Rollback',
      description: 'กู้คืนและถอยหลังการแก้ไขไฟล์ล่าสุดกลับด้วยระบบ Snapshot',
      icon: <RefreshCw className="w-4 h-4 text-[#ff5f56]" />,
      category: 'Security'
    },
    {
      id: 'c5',
      command: '/skills',
      label: 'Skill Manager',
      description: 'จัดการเปิด-ปิดสกิลที่ Alisa ใช้ระหว่างทำงาน',
      icon: <Puzzle className="w-4 h-4 text-[#ffffff]" />,
      category: 'Engine'
    },
    {
      id: 'c6',
      command: '/build',
      label: 'Build Electron App',
      description: 'สั่งสร้างไฟล์ประมวลผล .exe สำหรับ Windows',
      icon: <Cpu className="w-4 h-4 text-[#ffffff]" />,
      category: 'Deployment'
    },
    {
      id: 'c7',
      command: '/clear',
      label: 'Clear Terminal Logs',
      description: 'ล้างประวัติบันทึกการทำงานในคอนโซล',
      icon: <Trash2 className="w-4 h-4 text-[#888888]" />,
      category: 'System'
    }
  ];

  // Terminal Logs
  const [terminalLogs, setTerminalLogs] = useState<string[]>([
    `[${new Date().toLocaleTimeString()}] 🚀 Project Alisa Studio Initialized.`,
    `[${new Date().toLocaleTimeString()}] 🔗 Starting backend connection at ${API_BASE || 'origin'}…`,
    `[${new Date().toLocaleTimeString()}] 🤖 Alisa AI Engine ready.`
  ]);
  const [terminalCommand, setTerminalCommand] = useState('');
  const [isTerminalRunning, setIsTerminalRunning] = useState(false);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' });
  const [isUpdateActionRunning, setIsUpdateActionRunning] = useState(false);
  const [updateNoticeDismissed, setUpdateNoticeDismissed] = useState(false);

  // Settings state
  const [showSettings, setShowSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);
  const [workspaceInput, setWorkspaceInput] = useState('');
  const [workspaceSwitchError, setWorkspaceSwitchError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyMasked, setApiKeyMasked] = useState('');
  const [baseURL, setBaseURL] = useState('https://openrouter.ai/api/v1');
  const [model, setModel] = useState('deepseek/deepseek-chat');

  // WebSocket & Streaming
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingThought, setStreamingThought] = useState('');
  const [activeToolTraces, setActiveToolTraces] = useState<ToolTrace[]>([]);
  
  const wsRef = useRef<WebSocket | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const activeToolTracesRef = useRef<ToolTrace[]>([]);
  const streamingContentRef = useRef('');
  const streamingThoughtRef = useRef('');

  useEffect(() => {
    if (messages.length === 0 && !streamingContent && activeToolTraces.length === 0) return;
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, activeToolTraces]);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onUpdaterState?.((nextState) => {
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

  // Keyboard shortcut listener for Ctrl+K (Command Palette)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
      } else if (e.key === 'Escape') {
        setShowCommandPalette(false);
        setShowWorkspacePicker(false);
        setShowSettings(false);
        setShowModelPicker(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    if (window.electronAPI?.onTouchBarEvent) {
      window.electronAPI.onTouchBarEvent((eventName: string) => {
        if (eventName === 'touchbar-new-chat') {
          handleNewChat();
          addTerminalLog('⌘ [Touch Bar] New chat session ready.');
        } else if (eventName === 'touchbar-command-palette') {
          setShowCommandPalette((prev) => !prev);
        } else if (eventName === 'touchbar-new-project') {
          handleOpenWorkspacePicker();
        } else if (eventName === 'touchbar-rollback') {
          handleRollbackFile();
        }
      });
    }

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const fetchProjectSessions = async (wsDir?: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions${wsDir ? `?workspace=${encodeURIComponent(wsDir)}` : ''}`);
      if (!res.ok) throw new Error(`Session request failed (${res.status})`);
      const data = await res.json();
      if (data.messages && Array.isArray(data.messages)) {
        setMessages(data.messages.filter((message: ChatMessage) => message.role === 'user' || message.role === 'assistant'));
      }
    } catch (err) {
      console.error('Failed fetching project sessions:', err);
    }
  };

  useEffect(() => {
    // Initial fetches
    fetchConfig();
    fetchWorkspaceFiles();
    fetchSkills();
    fetchProjectSessions();

    // Connect to the backend and retry while the server is still starting.
    const wsUrl = (API_BASE || `http://${window.location.host}`).replace(/^http/, 'ws') + '/ws';
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
        setStatus('idle');
        setStatusDetail('Backend connected');
        addTerminalLog('⚡ Realtime channel connected.');
        // A startup race can make the initial HTTP requests fail. Refresh once
        // the websocket confirms that the backend is ready.
        fetchConfig();
        fetchWorkspaceFiles();
        fetchSkills();
        fetchProjectSessions();
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
        setIsBackendConnected(false);
      };

      ws.onclose = () => {
        setIsBackendConnected(false);
        setStatusDetail('Backend offline');
        if (!stopped) {
          const delay = Math.min(1000 * 2 ** retryAttempt, 5000);
          retryAttempt += 1;
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

  const addTerminalLog = (log: string) => {
    setTerminalLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${log}`]);
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/config`);
      if (!res.ok) throw new Error(`Config request failed (${res.status})`);
      const data = await res.json();
      // The server intentionally never returns the raw key. Keep this field
      // empty so a saved key is preserved unless the user enters a replacement.
      setApiKey('');
      setApiKeyMasked(data.apiKeyMasked || '');
      setBaseURL(data.baseURL || 'https://openrouter.ai/api/v1');
      setModel(data.model || 'deepseek/deepseek-chat');
      setWorkspaceDir(data.workspaceDir || '');
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
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          baseURL,
          model,
          workspaceDir,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Settings request failed (${res.status})`);
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

  const handleOpenWorkspacePicker = () => {
    setWorkspaceInput(workspaceDir);
    setWorkspaceSwitchError(null);
    setShowWorkspacePicker(true);
  };

  const handleSwitchWorkspace = async () => {
    const requestedWorkspace = workspaceInput.trim();
    if (!requestedWorkspace) {
      setWorkspaceSwitchError('Enter an absolute workspace path.');
      return;
    }

    setWorkspaceSwitchError(null);
    try {
      const res = await fetch(`${API_BASE}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceDir: requestedWorkspace }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Workspace request failed (${res.status})`);
      }

      const nextWorkspace = data.config.workspaceDir;
      setWorkspaceDir(nextWorkspace);
      setCollapsedDirectories(new Set());
      setSelectedFile(null);
      setFileContent('');
      setEditorDraft('');
      setShowWorkspacePicker(false);
      fetchWorkspaceFiles();
      fetchProjectSessions(nextWorkspace);
      addTerminalLog(`📂 Switched project workspace to: ${nextWorkspace}`);
    } catch (err) {
      setWorkspaceSwitchError(err instanceof Error ? err.message : 'Unable to switch workspace');
    }
  };

  const handleFileClick = async (filePath: string) => {
    setSelectedFile(filePath);
    setEditorError(null);
    setActiveTab('editor');
    setIsSidebarOpen(false);
    try {
      const res = await fetch(`${API_BASE}/api/files/read?path=${encodeURIComponent(filePath)}`);
      if (!res.ok) throw new Error(`File request failed (${res.status})`);
      const data = await res.json();
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

    setIsSavingFile(true);
    setEditorError(null);
    try {
      const res = await fetch(`${API_BASE}/api/files/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedFile, content: editorDraft }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `File save failed (${res.status})`);
      }
      setFileContent(editorDraft);
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
    setStatus('idle');
    setStatusDetail('Cancelled');
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

  const handleNewChat = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'clear_history' }));
    }
    setMessages([]);
    setStreamingContent('');
    setStreamingThought('');
    streamingContentRef.current = '';
    streamingThoughtRef.current = '';
    setActiveToolTraces([]);
    activeToolTracesRef.current = [];
    setStatus('idle');
    setStatusDetail(isBackendConnected ? 'Ready' : 'Backend offline');
    setActiveTab('chat');
    setInputPrompt('');
    addTerminalLog('🧹 Started new chat session.');
  };

  const handleSelectModel = async (nextModel: string) => {
    const previousModel = model;
    setModel(nextModel);
    setShowModelPicker(false);
    try {
      const res = await fetch(`${API_BASE}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: nextModel }),
      });
      if (!res.ok) throw new Error(`Model switch failed (${res.status})`);
      addTerminalLog(`🤖 Model selected: ${nextModel}`);
    } catch (err) {
      setModel(previousModel);
      addTerminalLog(`⚠️ ${err instanceof Error ? err.message : 'Unable to switch model'}`);
    }
  };

  const handleCheckForUpdates = async () => {
    if (isUpdateActionRunning) return;
    setIsUpdateActionRunning(true);
    try {
      if (window.electronAPI?.checkForUpdates) {
        const nextState = await window.electronAPI.checkForUpdates();
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
    if (!window.electronAPI?.downloadUpdate || isUpdateActionRunning) return;
    setIsUpdateActionRunning(true);
    try {
      const nextState = await window.electronAPI.downloadUpdate();
      setUpdateState(nextState as UpdateState);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to download update.';
      setUpdateState({ status: 'error', message });
    } finally {
      setIsUpdateActionRunning(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (!window.electronAPI?.installUpdate) return;
    await window.electronAPI.installUpdate();
  };

  const handleServerEvent = (data: any) => {
    const appendServerMessage = (message: any) => {
      if (!message || (message.role !== 'user' && message.role !== 'assistant')) return;

      const chatMessage: ChatMessage = {
        id: message.id || `message_${Date.now()}`,
        role: message.role,
        content: message.content || '',
        thought: message.metadata?.thought,
        timestamp: message.timestamp || Date.now(),
        toolTraces: message.role === 'assistant' && activeToolTracesRef.current.length > 0
          ? [...activeToolTracesRef.current]
          : undefined,
      };

      if (chatMessage.role === 'assistant' && !chatMessage.content && !chatMessage.thought) return;

      setMessages((prev) => {
        if (prev.some((item) => item.id === chatMessage.id)) return prev;
        if (chatMessage.role === 'user' && prev.some((item) =>
          item.role === 'user' && item.content === chatMessage.content && Date.now() - item.timestamp < 10000
        )) return prev;
        return [...prev, chatMessage];
      });

      if (chatMessage.role === 'assistant') {
        setStreamingContent('');
        setStreamingThought('');
        streamingContentRef.current = '';
        streamingThoughtRef.current = '';
        setActiveToolTraces([]);
        activeToolTracesRef.current = [];
      }
    };

    const setToolTraces = (updater: (traces: ToolTrace[]) => ToolTrace[]) => {
      setActiveToolTraces((prev) => {
        const next = updater(prev);
        activeToolTracesRef.current = next;
        return next;
      });
    };

    switch (data.type) {
      case 'status':
      case 'status_change':
        setStatus(data.status);
        if (data.detail) {
          setStatusDetail(data.detail);
          addTerminalLog(`📌 Status: ${data.detail}`);
        } else if (data.status === 'idle') {
          setStatusDetail('Ready');
        } else if (data.status === 'done') {
          setStatusDetail('Completed');
        }
        window.electronAPI?.updateTouchBarStatus?.({
          status: data.status,
          text: data.detail ? `🍓 ${data.detail.slice(0, 20)}` : undefined
        });
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
        setToolTraces((prev) => [
          ...prev,
          {
            toolName: data.toolName,
            toolCallId: data.toolCallId,
            args: data.args,
            status: 'running',
          },
        ]);
        addTerminalLog(`🛠️ Executing Tool [${data.toolName}]: ${JSON.stringify(data.args)}`);
        window.electronAPI?.updateTouchBarStatus?.({
          status: 'executing',
          text: `⚙️ ${data.toolName}...`
        });
        break;

      case 'tool_end':
      case 'tool_call_end':
        setToolTraces((prev) =>
          prev.map((t) =>
            t.toolCallId === data.toolCallId
              ? { ...t, status: data.error ? 'error' : 'success', result: data.result, error: data.error }
              : t
          )
        );
        addTerminalLog(`✅ Tool [${data.toolName}] Finished`);
        fetchWorkspaceFiles();
        window.electronAPI?.updateTouchBarStatus?.({
          status: 'acting',
          text: `✨ Done ${data.toolName}`
        });
        break;

      case 'message_added':
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
        window.electronAPI?.updateTouchBarStatus?.({
          status: 'idle',
          text: '🍓 Alisa: Ready'
        });
        break;

      case 'error':
        setStatus('error');
        setStatusDetail(data.message || 'Request failed');
        addTerminalLog(`❌ Server Error: ${data.message}`);
        window.electronAPI?.updateTouchBarStatus?.({
          status: 'error',
          text: '❌ Error',
          color: '#ff4444'
        });
        break;
    }
  };

  const handleSendPrompt = (promptOverride?: string) => {
    const prompt = (promptOverride ?? inputPrompt).trim();
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

    setMessages((prev) => [...prev, userMsg]);
    setStatus('thinking');
    window.electronAPI?.updateTouchBarStatus?.({
      status: 'thinking',
      text: '⚡ Alisa: Thinking...'
    });
    setStatusDetail('Processing query...');

    addTerminalLog(`💬 User: ${prompt}`);

    wsRef.current.send(
      JSON.stringify({
        type: 'start_task',
        prompt,
        skills: activeSkillNames,
      })
    );

    setInputPrompt('');
  };

  const handleRollbackFile = async () => {
    try {
      addTerminalLog('🔄 กำลังทำการ Rollback การแก้ไขไฟล์ล่าสุด...');
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
      addTerminalLog(`❌ เกิดข้อผิดพลาดในการ Rollback: ${err.message}`);
    }
  };

  // Run Quick Command
  const handleExecuteCommand = (command: QuickCommand) => {
    setShowCommandPalette(false);
    addTerminalLog(`⚡ Executed Command: ${command.command} (${command.label})`);

    if (command.command === '/goal') {
      setActiveTab('chat');
      setInputPrompt('วางแผนและลงมือทำเป้าหมายนี้ทีละขั้น พร้อมรายงานผลการตรวจสอบ: ');
    } else if (command.command === '/skills') {
      setActiveTab('skills');
    } else if (command.command === '/rollback') {
      handleRollbackFile();
    } else if (command.command === '/clear') {
      setTerminalLogs([`[${new Date().toLocaleTimeString()}] Console logs cleared.`]);
    } else {
      setInputPrompt(command.command);
    }
  };

  const renderFileTree = (nodes: FileNode[]) => {
    return nodes.map((node) => (
      <div key={node.path} className="pl-3">
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
              className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs text-[#aeb7c5] transition hover:bg-[#1c222b]"
            >
              <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-[#718097] transition-transform ${collapsedDirectories.has(node.path) ? '' : 'rotate-90'}`} />
              <Folder className="h-3.5 w-3.5 shrink-0 text-[#8192ac]" />
              <span className="truncate">{node.name}</span>
            </button>
            {node.children && !collapsedDirectories.has(node.path) && renderFileTree(node.children)}
          </div>
        ) : (
          <div
            onClick={() => handleFileClick(node.path)}
            className={`flex items-center gap-1.5 py-1 px-1.5 rounded text-xs font-mono cursor-pointer transition-colors ${
              selectedFile === node.path
                ? 'bg-[#262626] text-[#ffffff] font-semibold border-l-2 border-[#ffffff]'
                : 'text-[#888888] hover:bg-[#1a1a1a] hover:text-[#dddddd]'
            }`}
          >
            <FileCode className="w-3.5 h-3.5 text-[#555555] shrink-0" />
            <span className="truncate">{node.name}</span>
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
  const statusColor = status === 'error'
    ? 'text-[#ff8a80]'
    : status === 'thinking'
    ? 'text-[#ffaa00]'
    : status === 'acting'
    ? 'text-[#38bdf8]'
    : status === 'waiting_approval'
    ? 'text-[#ffbd2e]'
    : status === 'self_correcting'
    ? 'text-[#c084fc]'
    : !isBackendConnected
    ? 'text-[#ffbd2e]'
    : 'text-[#7ee787]';
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
      <header className="alisa-topbar flex h-14 shrink-0 items-center justify-between border-b border-[#252a33] bg-[#11141a] px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <button type="button" onClick={() => setIsSidebarOpen((open) => !open)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-[#aab2c0] transition hover:border-[#333b48] hover:bg-[#1a1f27] hover:text-white md:hidden" aria-label="Toggle workspace explorer">
            {isSidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
          </button>
          <div className="alisa-brand-mark flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f4f5f7] text-sm font-bold text-[#12151a] shadow-sm">A</div>
          <div className="min-w-0 leading-tight"><div className="alisa-brand-name truncate text-sm font-semibold tracking-tight text-white">Project Alisa Studio</div><div className="hidden text-[11px] text-[#7f8998] sm:block">AI coding workspace</div></div>
          <div className="hidden h-6 w-px bg-[#2a303b] lg:block" />
          <div className="alisa-workspace-badge hidden min-w-0 items-center gap-2 rounded-lg border border-[#29313d] bg-[#171b22] px-3 py-1.5 lg:flex" title={workspaceDir}><Folder className="h-3.5 w-3.5 shrink-0 text-[#93a4bd]" /><span className="max-w-[240px] truncate text-xs font-medium text-[#c4cbd6]">{workspaceLabel}</span></div>
        </div>

        <div className="hidden items-center gap-2 lg:flex"><div className={`alisa-status-pill flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${isBackendConnected ? 'border-[#24583a] bg-[#132319] text-[#9be7b0]' : 'border-[#5b4720] bg-[#251f12] text-[#f2c56d]'}`}><span className={`h-2 w-2 rounded-full ${statusDot}`} /><span>{statusLabel}</span>{visibleStatusDetail && <span className="max-w-[180px] truncate text-[#7f8998]">{visibleStatusDetail}</span>}</div></div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <button type="button" onClick={handleNewChat} className="alisa-topbar-new hidden h-9 items-center gap-1.5 rounded-lg border border-[#303744] bg-[#1a1f27] px-3 text-xs font-medium text-[#c4cbd6] transition hover:border-[#4a5567] hover:bg-[#222832] hover:text-white sm:inline-flex"><Plus className="h-3.5 w-3.5" /> New chat</button>
          <button type="button" disabled={isBusy} onClick={handleOpenWorkspacePicker} className="hidden h-9 items-center gap-1.5 rounded-lg border border-[#303744] bg-[#1a1f27] px-3 text-xs font-medium text-[#c4cbd6] transition hover:border-[#4a5567] hover:bg-[#222832] hover:text-white disabled:cursor-not-allowed disabled:opacity-45 sm:inline-flex"><Folder className="h-3.5 w-3.5" /> Workspace</button>
          <button type="button" onClick={() => setShowCommandPalette(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#303744] bg-[#1a1f27] px-2.5 text-xs font-medium text-[#c4cbd6] transition hover:border-[#4a5567] hover:bg-[#222832] hover:text-white sm:px-3" title="Command palette (Ctrl+K)"><Command className="h-3.5 w-3.5" /><span className="hidden sm:inline">Commands</span><kbd className="hidden rounded bg-[#252c37] px-1.5 py-0.5 text-[10px] text-[#8f9aaa] sm:inline">Ctrl K</kbd></button>
          <button type="button" onClick={() => { setSettingsError(null); setShowSettings(true); }} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-[#aab2c0] transition hover:border-[#333b48] hover:bg-[#1a1f27] hover:text-white" aria-label="Open settings"><Settings className="h-4 w-4" /></button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {isSidebarOpen && <button type="button" aria-label="Dismiss explorer overlay" onClick={() => setIsSidebarOpen(false)} className="fixed inset-0 z-30 bg-black/60 md:hidden" />}
        <aside className={`alisa-sidebar absolute inset-y-0 left-0 z-40 flex w-[min(86vw,19rem)] flex-col border-r border-[#252a33] bg-[#11141a] shadow-2xl transition-transform duration-200 md:relative md:z-0 md:w-72 md:translate-x-0 md:shadow-none ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="flex h-[4.5rem] shrink-0 items-center justify-between border-b border-[#252a33] px-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#aeb7c5]"><Layers className="h-4 w-4 text-[#8da4c6]" /> Workspace</div>
              <div className="mt-1 truncate text-xs text-[#687487]" title={workspaceDir}>{workspaceLabel}</div>
            </div>
            <div className="flex items-center gap-1">
              {sidebarView === 'files' && <button type="button" onClick={fetchWorkspaceFiles} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#778396] transition hover:bg-[#1d232c] hover:text-white" aria-label="Refresh files"><RefreshCw className={`h-3.5 w-3.5 ${isWorkspaceLoading ? 'animate-spin' : ''}`} /></button>}
              <button type="button" onClick={() => setIsSidebarOpen(false)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#778396] transition hover:bg-[#1d232c] hover:text-white md:hidden" aria-label="Close workspace sidebar"><X className="h-4 w-4" /></button>
            </div>
          </div>

          <div className="px-3 pt-3">
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-[#252d38] bg-[#0d1015] p-1" role="tablist" aria-label="Workspace navigation">
              <button type="button" role="tab" aria-selected={sidebarView === 'sessions'} onClick={() => setSidebarView('sessions')} className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition ${sidebarView === 'sessions' ? 'bg-[#252d38] text-white shadow-sm' : 'text-[#7f8da1] hover:bg-[#1a2028] hover:text-[#d8dde6]'}`}><CircleDot className="h-3.5 w-3.5" /> Sessions<span className="text-[10px] text-[#687487]">{recentSessionPrompts.length}</span></button>
              <button type="button" role="tab" aria-selected={sidebarView === 'files'} onClick={() => setSidebarView('files')} className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition ${sidebarView === 'files' ? 'bg-[#252d38] text-white shadow-sm' : 'text-[#7f8da1] hover:bg-[#1a2028] hover:text-[#d8dde6]'}`}><FolderTree className="h-3.5 w-3.5" /> Files</button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
            {sidebarView === 'sessions' ? (
              <div className="space-y-5 px-3 pb-4 pt-3">
                <button type="button" onClick={handleNewChat} className="alisa-primary-action flex w-full items-center justify-center gap-2 rounded-xl bg-[#f0f2f5] px-3 py-2.5 text-sm font-semibold text-[#13161b] shadow-sm transition hover:bg-white"><Plus className="h-4 w-4" /> New session</button>
                <section aria-labelledby="current-session-heading">
                  <div id="current-session-heading" className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#687487]">Current session</div>
                  <button type="button" onClick={() => { setActiveTab('chat'); if (window.innerWidth < 768) setIsSidebarOpen(false); }} className="alisa-session-current group flex w-full items-start gap-3 rounded-xl border border-[#3e4c60] bg-[#1a222d] p-3 text-left transition hover:border-[#657895] hover:bg-[#202a37]"><span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#2c3a4d] text-[#a9c0df]"><Bot className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-white">Project Alisa Studio</span><span className="mt-1 block truncate text-xs text-[#8d9aae]">{recentSessionPrompts[0]?.content || 'Ready for your next task'}</span></span><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#4fd27b]" title="Active session" /></button>
                </section>
                <section aria-labelledby="recent-sessions-heading">
                  <div className="mb-2 flex items-center justify-between px-1"><div id="recent-sessions-heading" className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#687487]">Recent prompts</div>{recentSessionPrompts.length > 0 && <span className="text-[10px] text-[#536176]">{recentSessionPrompts.length}</span>}</div>
                  {recentSessionPrompts.length > 0 ? <div className="space-y-1">{recentSessionPrompts.map((prompt, index) => <button key={`${prompt.id}-${index}`} type="button" onClick={() => { setInputPrompt(prompt.content); setActiveTab('chat'); if (window.innerWidth < 768) setIsSidebarOpen(false); }} className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-[#9aa7b9] transition hover:bg-[#1a2028] hover:text-white"><span className="mt-0.5 shrink-0 text-[#53647b]">{index === 0 ? <CircleDot className="h-3 w-3 text-[#8da4c6]" /> : <ArrowRight className="h-3 w-3" />}</span><span className="line-clamp-2 min-w-0 leading-5">{prompt.content}</span></button>)}</div> : <div className="rounded-xl border border-dashed border-[#2b333f] px-3 py-4 text-center text-xs leading-5 text-[#687487]">Your recent prompts will appear here.</div>}
                </section>
              </div>
            ) : (
              <div className="px-2.5 py-3">{fileTree.length > 0 ? <div className="space-y-0.5">{renderFileTree(fileTree)}</div> : isWorkspaceLoading ? <div className="space-y-2 px-2 py-3 text-xs text-[#778396]"><div className="h-3 w-3/4 animate-pulse rounded bg-[#202630]" /><div className="h-3 w-1/2 animate-pulse rounded bg-[#202630]" /><div className="h-3 w-2/3 animate-pulse rounded bg-[#202630]" /></div> : workspaceError ? <div className="m-1 rounded-lg border border-[#59343b] bg-[#27181d] p-3 text-xs leading-relaxed text-[#f0a9b1]"><p>{workspaceError}</p><button type="button" onClick={fetchWorkspaceFiles} className="mt-2 font-medium text-[#ffd4d8] underline underline-offset-2">Try again</button></div> : <div className="m-1 rounded-lg border border-dashed border-[#303744] p-4 text-center text-xs leading-relaxed text-[#778396]">No files in this workspace yet.</div>}</div>
            )}
          </div>

          <div className="shrink-0 border-t border-[#252a33] px-3 py-3">
            <button type="button" onClick={handleOpenWorkspacePicker} className="mb-3 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-[#8d9aae] transition hover:bg-[#1a2028] hover:text-white"><Folder className="h-3.5 w-3.5 text-[#8da4c6]" /><span className="min-w-0 flex-1 truncate">Switch workspace</span><ArrowRight className="h-3.5 w-3.5 text-[#53647b]" /></button>
            <div className="flex items-center gap-2 text-xs text-[#7e8999]"><span className={`h-2 w-2 rounded-full ${isBackendConnected ? 'bg-[#4fd27b]' : 'bg-[#d9a84e]'}`} /> {isBackendConnected ? 'Connected to local agent' : 'Waiting for local agent'}</div>
            <div className="mt-1 truncate text-[11px] text-[#5f6b7d]" title={model}>{model}</div>
          </div>
        </aside>

        <main className="alisa-main min-w-0 flex flex-1 flex-col bg-[#0b0d10]">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[#252a33] bg-[#11141a] px-3 sm:px-4"><button type="button" onClick={() => setIsSidebarOpen(true)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#8f9aaa] hover:bg-[#1d232c] hover:text-white md:hidden" aria-label="Open workspace sidebar"><PanelLeftOpen className="h-4 w-4" /></button><nav className="tab-scroll flex min-w-0 items-center gap-1 overflow-x-auto" aria-label="Workspace views">{[{ id: 'chat' as const, label: 'Chat', icon: Bot }, { id: 'skills' as const, label: 'Skills', icon: Puzzle, count: skills.length }, { id: 'editor' as const, label: 'Editor', icon: Code2 }, { id: 'terminal' as const, label: 'Activity', icon: Activity, count: terminalLogs.length }].map((tab) => { const Icon = tab.icon; return <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} aria-current={activeTab === tab.id ? 'page' : undefined} className={`alisa-tab ${activeTab === tab.id ? 'alisa-tab-active' : ''} inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition sm:px-3 ${activeTab === tab.id ? 'bg-[#252c37] text-white shadow-sm' : 'text-[#8290a3] hover:bg-[#1a2028] hover:text-[#d8dde6]'}`}><Icon className="h-3.5 w-3.5" /><span>{tab.label}</span>{tab.count !== undefined && <span className={`rounded px-1.5 py-0.5 text-[10px] ${activeTab === tab.id ? 'bg-[#353e4c] text-[#dce3ee]' : 'bg-[#1a2028] text-[#728096]'}`}>{tab.count}</span>}</button>; })}</nav><div className={`ml-auto hidden shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] lg:flex ${isBackendConnected ? 'border-[#24583a] bg-[#132319] text-[#9be7b0]' : 'border-[#5b4720] bg-[#251f12] text-[#f2c56d]'}`}><span className={`h-1.5 w-1.5 rounded-full ${isBackendConnected ? 'bg-[#4fd27b]' : 'bg-[#d9a84e]'}`} />{isBackendConnected ? 'Agent online' : 'Agent offline'}</div></div>

          {updateBannerVisible && <div role="status" className={`flex flex-wrap items-center gap-3 border-b px-4 py-2.5 text-xs sm:px-6 ${updateState.status === 'error' ? 'border-[#59343b] bg-[#27181d] text-[#f0a9b1]' : 'border-[#3d4a5d] bg-[#17202b] text-[#cbd9eb]'}`}><span className="inline-flex items-center gap-2 font-semibold text-white">{updateState.status === 'available' && <Download className="h-3.5 w-3.5 text-[#8da4c6]" />}{updateState.status === 'downloading' && <RefreshCw className="h-3.5 w-3.5 animate-spin text-[#8da4c6]" />}{updateState.status === 'downloaded' && <CheckCircle2 className="h-3.5 w-3.5 text-[#7ee787]" />}{updateState.status === 'error' && <AlertCircle className="h-3.5 w-3.5 text-[#ff8a80]" />}<span>{updateState.status === 'available' ? `Update ${updateState.version || ''} available` : updateState.status === 'downloaded' ? 'Update ready to install' : updateState.status === 'downloading' ? `Downloading update${updateState.percent !== undefined ? ` · ${updateState.percent}%` : '…'}` : 'Update check failed'}</span></span><span className="min-w-0 flex-1 text-[#8f9db0]">{updateState.message}</span>{updateState.status === 'available' && <button type="button" onClick={handleDownloadUpdate} disabled={isUpdateActionRunning} className="rounded-lg bg-[#f0f2f5] px-3 py-1.5 font-semibold text-[#13161b] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50">{isUpdateActionRunning ? 'Starting…' : 'Download'}</button>}{updateState.status === 'downloaded' && <button type="button" onClick={handleInstallUpdate} className="rounded-lg bg-[#7ee787] px-3 py-1.5 font-semibold text-[#102016] transition hover:bg-[#a3f0ae]">Restart to update</button>}{updateState.status === 'error' && <button type="button" onClick={handleCheckForUpdates} disabled={isUpdateActionRunning} className="rounded-lg border border-[#6d4850] px-3 py-1.5 font-semibold text-[#ffd4d8] transition hover:bg-[#3a2025] disabled:cursor-not-allowed disabled:opacity-50">Try again</button>}<button type="button" aria-label="Dismiss update notice" onClick={() => setUpdateNoticeDismissed(true)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#7e8da1] transition hover:bg-[#202b39] hover:text-white"><X className="h-3.5 w-3.5" /></button></div>}

          <div className="min-h-0 flex-1">
            {activeTab === 'chat' && <div className="flex h-full min-h-0 flex-col"><div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar"><div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">{messages.length === 0 && !streamingContent && activeToolTraces.length === 0 && <div className="alisa-hero flex flex-1 flex-col items-center justify-start py-10 text-center sm:justify-center sm:py-20"><div className="alisa-hero-mark mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f4f5f7] text-xl font-bold text-[#12151a] shadow-[0_12px_28px_rgba(0,0,0,.28)]">A</div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#8290a3]">Project Alisa Studio</p><h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">What are we building today?</h1><p className="mt-3 max-w-lg text-sm leading-6 text-[#8995a7]">Ask Alisa to inspect your workspace, explain a file, or make a focused change.</p><div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">{[['Inspect project', 'สรุปโครงสร้างโปรเจกต์', FolderTree], ['Find a bug', 'วิเคราะห์บั๊กให้หน่อย', Bug], ['Improve a file', 'ปรับปรุงไฟล์นี้ให้ดีขึ้น', Sparkles]].map(([label, prompt, Icon]) => { const PromptIcon = Icon as typeof FolderTree; return <button key={label as string} type="button" onClick={() => { setInputPrompt(prompt as string); setActiveTab('chat'); }} className="alisa-suggestion-card group rounded-xl border border-[#2b333f] bg-[#151a21] p-4 text-left transition hover:-translate-y-0.5 hover:border-[#53647b] hover:bg-[#1b222c]"><span className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#202936] text-[#a9b9d0] group-hover:text-white"><PromptIcon className="h-4 w-4" /></span><span className="block text-sm font-medium text-[#e5e9ef]">{label as string}</span><span className="mt-1 block text-xs text-[#7d899b]">{prompt as string}</span></button>; })}</div></div>}
            {messages.map((m, messageIndex) => <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex gap-3'}>{m.role === 'assistant' && <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#f4f5f7] text-xs font-bold text-[#12151a]">A</div>}<div className={m.role === 'user' ? 'max-w-[85%] sm:max-w-[75%]' : 'min-w-0 max-w-[88%] sm:max-w-[78%]'}>{m.role === 'user' ? <div className="rounded-2xl rounded-br-md bg-[#2a3442] px-4 py-3 text-sm leading-6 text-[#f1f4f8] shadow-sm">{m.content}</div> : <div className="space-y-3">{m.toolTraces?.map((trace, idx) => <div key={`${trace.toolCallId}-${idx}`} className="rounded-xl border border-[#2b333f] bg-[#151a21] p-3 text-xs"><div className="flex flex-wrap items-center gap-2"><span className="rounded bg-[#222b38] px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-[#b6c6dc]">{trace.toolName}</span><span className={`rounded px-2 py-1 text-[10px] font-medium ${trace.status === 'success' ? 'bg-[#183322] text-[#8ce0a7]' : trace.status === 'error' ? 'bg-[#3a2025] text-[#f2a2aa]' : 'bg-[#3b3019] text-[#f1c671]'}`}>{trace.status}</span></div>{(trace.result || trace.error) && <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-[#0d1015] p-2.5 font-mono text-[11px] leading-5 text-[#9da8b8]">{trace.error || trace.result}</pre>}</div>)}{m.thought && <details className="rounded-xl border border-[#2b333f] bg-[#12171e] text-xs text-[#8c99aa]"><summary className="cursor-pointer px-3 py-2 font-medium text-[#aab6c7]">Reasoning trace</summary><div className="border-t border-[#252d38] px-3 py-2.5 whitespace-pre-wrap leading-5">{m.thought}</div></details>}<div className="rounded-2xl rounded-tl-md border border-[#252d38] bg-[#151a21] px-4 py-3.5 text-sm leading-6 text-[#e1e6ed] shadow-sm"><div className="whitespace-pre-wrap">{m.content ? renderAssistantContent(m.content) : 'No response content.'}</div></div><div className="mt-2 flex items-center gap-3"><button type="button" onClick={() => handleRetryMessage(messageIndex)} disabled={isBusy} className="inline-flex items-center gap-1.5 text-xs font-medium text-[#8290a3] transition hover:text-white disabled:cursor-not-allowed disabled:opacity-40"><RefreshCw className="h-3.5 w-3.5" /> Retry</button></div></div>}<div className={`mt-1.5 text-[10px] text-[#637083] ${m.role === 'user' ? 'text-right' : ''}`}>{m.role === 'user' ? 'You' : 'Alisa'} · {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div></div></div>)}
            {(streamingContent || streamingThought || activeToolTraces.length > 0) && <div className="flex gap-3"><div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#f4f5f7] text-xs font-bold text-[#12151a]">A</div><div className="min-w-0 max-w-[88%] space-y-3 sm:max-w-[78%]">{activeToolTraces.map((trace, idx) => <div key={`${trace.toolCallId}-${idx}`} className="rounded-xl border border-[#3d3523] bg-[#1b1811] p-3 text-xs"><div className="flex items-center gap-2"><span className="rounded bg-[#332a18] px-2 py-1 font-mono text-[10px] uppercase text-[#f1c671]">{trace.toolName}</span><span className="text-[#c89d45]">Running…</span></div></div>)}{streamingThought && <details open className="rounded-xl border border-[#2b333f] bg-[#12171e] text-xs text-[#8c99aa]"><summary className="cursor-pointer px-3 py-2 font-medium text-[#aab6c7]">Reasoning trace</summary><div className="border-t border-[#252d38] px-3 py-2.5 whitespace-pre-wrap leading-5">{streamingThought}</div></details>}{streamingContent && <div className="rounded-2xl rounded-tl-md border border-[#252d38] bg-[#151a21] px-4 py-3.5 text-sm leading-6 text-[#e1e6ed] whitespace-pre-wrap">{renderAssistantContent(streamingContent)}<span className="ml-1 inline-block h-4 w-1 animate-pulse bg-[#8da4c6] align-[-2px]" /></div>}</div></div>}
            <div ref={chatEndRef} /></div></div><div className="shrink-0 border-t border-[#252a33] bg-[#11141a] px-3 py-3 sm:px-6 sm:py-4"><div className="mx-auto max-w-4xl"><div className="alisa-composer relative rounded-2xl border border-[#303846] bg-[#151a21] shadow-[0_12px_30px_rgba(0,0,0,.16)] focus-within:border-[#53647b]"><textarea rows={3} value={inputPrompt} onChange={(e) => setInputPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendPrompt(); } }} placeholder="Ask Alisa to inspect, explain, or change your code…" aria-label="Message Alisa" className="min-h-[92px] w-full resize-none bg-transparent px-4 py-3.5 text-sm leading-6 text-white placeholder-[#687487] focus:outline-none" /><div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#252d38] px-3 py-2.5"><div className="flex min-w-0 items-center gap-2"><button type="button" onClick={() => setShowModelPicker((open) => !open)} aria-haspopup="listbox" aria-expanded={showModelPicker} className="alisa-model-trigger inline-flex min-w-0 items-center gap-1.5 rounded-lg bg-[#202733] px-2.5 py-1.5 text-xs font-medium text-[#c3d0e2] transition hover:bg-[#293341] hover:text-white"><Sparkles className="h-3.5 w-3.5 shrink-0 text-[#c6a15a]" /><span className="max-w-[9rem] truncate">{selectedModel?.label || model}</span><ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[#718097] transition-transform ${showModelPicker ? 'rotate-180' : ''}`} /></button><button type="button" onClick={() => setShowCommandPalette(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#202733] px-2.5 py-1.5 text-xs font-medium text-[#a9b6c8] transition hover:bg-[#293341] hover:text-white"><Command className="h-3.5 w-3.5" /><span className="hidden sm:inline">Actions</span></button><span className="hidden items-center gap-1.5 rounded-lg bg-[#202733] px-2.5 py-1.5 text-xs text-[#8d9aae] sm:inline-flex"><Puzzle className="h-3.5 w-3.5 text-[#c6a15a]" /> {activeSkillNames.length} skills</span></div><div className="flex items-center gap-2"><span className="hidden text-[11px] text-[#637083] sm:inline">Enter to send · Shift+Enter for a new line</span>{isBusy ? <button type="button" onClick={handleAbortTask} className="inline-flex items-center gap-1.5 rounded-lg bg-[#3a2025] px-3.5 py-2 text-xs font-semibold text-[#f2a2aa] transition hover:bg-[#4a252c]"><Square className="h-3.5 w-3.5 fill-current" /> Stop</button> : <button type="button" onClick={() => handleSendPrompt()} disabled={!inputPrompt.trim() || !isBackendConnected} className="alisa-primary-action inline-flex items-center gap-1.5 rounded-lg bg-[#f0f2f5] px-3.5 py-2 text-xs font-semibold text-[#13161b] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"><Send className="h-3.5 w-3.5" /> Send</button>}</div></div>{showModelPicker && <div className="alisa-model-menu absolute bottom-14 left-3 z-20 w-[min(19rem,calc(100%-1.5rem))] overflow-hidden rounded-xl border border-[#3a4351] bg-[#1b2028] p-1.5 shadow-[0_18px_46px_rgba(0,0,0,.48)]" role="listbox" aria-label="Choose model"><div className="px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#687487]">Models</div>{MODEL_OPTIONS.map((option) => <button key={option.id} type="button" role="option" aria-selected={model === option.id} onClick={() => handleSelectModel(option.id)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2.5 text-left transition ${model === option.id ? 'bg-[#2b3543] text-white' : 'text-[#c0c9d6] hover:bg-[#252d38] hover:text-white'}`}><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#273241] text-[#c6a15a]"><Sparkles className="h-3.5 w-3.5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{option.label}</span><span className="mt-0.5 block truncate text-[10px] text-[#7f8da1]">{option.description}</span></span>{model === option.id && <Check className="h-3.5 w-3.5 shrink-0 text-[#7ee787]" />}</button>)}<button type="button" onClick={() => { setShowModelPicker(false); setShowSettings(true); }} className="mt-1 flex w-full items-center gap-2 border-t border-[#303846] px-2.5 py-2.5 text-left text-xs font-medium text-[#9aa8ba] transition hover:text-white"><Sliders className="h-3.5 w-3.5" /> Manage model settings</button></div>}<p className="mt-2 text-center text-[11px] text-[#637083]">Alisa can change files in the active workspace. Review edits before shipping.</p></div></div></div></div>}


            {activeTab === 'skills' && <div className="h-full overflow-y-auto custom-scrollbar"><div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-8"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b8a2da]">Agent configuration</p><h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">Skills</h1><p className="mt-2 text-sm leading-6 text-[#8995a7]">Choose the guidance Alisa should use for this session.</p></div><button type="button" onClick={fetchSkills} className="inline-flex items-center gap-2 rounded-lg border border-[#303846] bg-[#1a1f27] px-3.5 py-2.5 text-sm font-medium text-[#c4cbd6] transition hover:border-[#53647b] hover:bg-[#222832] hover:text-white"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button></div><div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{skills.map((skill) => { const isActive = activeSkillNames.includes(skill.name); return <div key={skill.name} className={`rounded-2xl border p-4 transition ${isActive ? 'border-[#4a4161] bg-[#1b1824]' : 'border-[#2b333f] bg-[#151a21]'}`}><div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="break-all text-sm font-medium text-white">{skill.name}</h2><span className="rounded bg-[#252d38] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#8f9aaa]">{skill.category}</span></div><p className="mt-2 text-sm leading-5 text-[#8995a7]">{skill.description}</p><p className="mt-3 text-[11px] text-[#637083]">{skill.source}</p></div><button type="button" onClick={() => toggleSkillActive(skill.name)} className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition ${isActive ? 'bg-[#c7b0e7] text-[#211b2b] hover:bg-[#d7c5ef]' : 'border border-[#394454] bg-[#202733] text-[#a9b6c8] hover:border-[#657895] hover:text-white'}`}>{isActive ? 'Enabled' : 'Enable'}</button></div></div>; })}</div>{skills.length === 0 && <div className="rounded-2xl border border-dashed border-[#303846] p-8 text-center text-sm text-[#778396]">No skills were found. Refresh to try again.</div>}</div></div>}

            {activeTab === 'editor' && <div className="flex h-full min-h-0 flex-col"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#252a33] bg-[#11141a] px-4 py-3"><div className="min-w-0"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#8290a3]"><Code2 className="h-4 w-4" /> Editor</div><div className="mt-1 truncate text-sm text-white" title={selectedFile || undefined}>{selectedFile || 'Choose a file from Explorer'}</div></div><div className="flex items-center gap-2"><span className={`text-xs ${editorDirty ? 'text-[#d5b36a]' : 'text-[#718097]'}`}>{editorDirty ? 'Unsaved changes' : selectedFile ? 'Saved' : ''}</span><button type="button" disabled={!selectedFile || editorDirty || isSavingFile} onClick={() => selectedFile && handleFileClick(selectedFile)} className="rounded-lg border border-[#303846] bg-[#1a1f27] px-3 py-2 text-xs font-medium text-[#a9b6c8] transition hover:border-[#53647b] hover:text-white disabled:cursor-not-allowed disabled:opacity-40">Reload</button><button type="button" disabled={!selectedFile || !editorDirty || isSavingFile} onClick={handleSaveFile} className="inline-flex items-center gap-1.5 rounded-lg bg-[#f0f2f5] px-3 py-2 text-xs font-semibold text-[#13161b] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"><Save className="h-3.5 w-3.5" />{isSavingFile ? 'Saving…' : 'Save'}</button></div></div>{editorError && <div className="border-b border-[#59343b] bg-[#27181d] px-4 py-2.5 text-xs text-[#f0a9b1]">{editorError}</div>}{selectedFile ? <textarea value={editorDraft} onChange={(e) => setEditorDraft(e.target.value)} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); handleSaveFile(); } }} spellCheck={false} aria-label={`Editing ${selectedFile}`} className="min-h-0 flex-1 resize-none overflow-auto bg-[#0d1015] px-4 py-4 font-mono text-[13px] leading-6 text-[#d8dee8] outline-none sm:px-6" /> : <div className="flex flex-1 items-center justify-center p-6"><div className="max-w-sm text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#202733] text-[#a9b6c8]"><FileCode className="h-5 w-5" /></div><h2 className="mt-4 text-base font-semibold text-white">Choose a file to edit</h2><p className="mt-2 text-sm leading-6 text-[#778396]">Select a file in Explorer. Changes are saved with a snapshot so Rollback can restore the previous version.</p></div></div>}</div>}

            {activeTab === 'terminal' && (
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex items-center justify-between border-b border-[#252a33] bg-[#11141a] px-4 py-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-white"><Activity className="h-4 w-4 text-[#8da4c6]" /> Activity & terminal</div>
                    <p className="mt-1 text-xs text-[#718097]">Run a command in the active workspace and inspect realtime agent events.</p>
                  </div>
                  <button type="button" onClick={() => setTerminalLogs([])} className="rounded-lg border border-[#303846] bg-[#1a1f27] px-3 py-2 text-xs font-medium text-[#a9b6c8] transition hover:border-[#53647b] hover:text-white">Clear</button>
                </div>
                <form onSubmit={(event) => { event.preventDefault(); handleRunTerminal(); }} className="flex flex-wrap gap-2 border-b border-[#252a33] bg-[#0f1319] p-3 sm:p-4">
                  <div className="flex min-w-0 flex-1 items-center rounded-xl border border-[#303846] bg-[#151a21] focus-within:border-[#657895]"><span className="select-none pl-3 font-mono text-sm text-[#657895]">$</span><input value={terminalCommand} onChange={(event) => setTerminalCommand(event.target.value)} aria-label="Terminal command" placeholder="Run a command in this workspace…" className="min-w-0 flex-1 bg-transparent px-2.5 py-3 font-mono text-sm text-white outline-none placeholder-[#687487]" /></div>
                  <button type="submit" disabled={!terminalCommand.trim() || isTerminalRunning || !isBackendConnected} className="inline-flex items-center gap-1.5 rounded-xl bg-[#f0f2f5] px-4 py-3 text-sm font-semibold text-[#13161b] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40">{isTerminalRunning ? <Activity className="h-4 w-4 animate-pulse" /> : <Play className="h-4 w-4" />}{isTerminalRunning ? 'Running…' : 'Run'}</button>
                </form>
                {terminalError && <div className="border-b border-[#59343b] bg-[#27181d] px-4 py-2.5 text-xs text-[#f0a9b1]">{terminalError}</div>}
                <div className="min-h-0 flex-1 overflow-y-auto bg-[#0d1015] px-4 py-4 custom-scrollbar sm:px-6"><div className="mx-auto max-w-5xl space-y-1 font-mono text-xs leading-5">{terminalLogs.length === 0 ? <div className="py-8 text-center text-[#637083]">No activity yet.</div> : terminalLogs.slice(-300).map((log, i) => <div key={`${log}-${i}`} className="whitespace-pre-wrap break-words text-[#9aa7b9]"><span className="mr-2 select-none text-[#53647b]">›</span>{log}</div>)}</div></div>
              </div>
            )}

          </div>
        </main>
      </div>

      {showCommandPalette && <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 px-4 pt-[12vh]" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowCommandPalette(false); }}><div className="w-full max-w-xl overflow-hidden rounded-2xl border border-[#3a4351] bg-[#151a21] shadow-[0_24px_70px_rgba(0,0,0,.5)]" role="dialog" aria-modal="true" aria-label="Command palette"><div className="flex items-center gap-3 border-b border-[#2b333f] px-4 py-3"><Search className="h-4 w-4 shrink-0 text-[#7e8ba0]" /><input autoFocus value={commandSearch} onChange={(e) => setCommandSearch(e.target.value)} placeholder="Search commands…" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder-[#687487]" /><kbd className="rounded bg-[#252d38] px-2 py-1 text-[10px] text-[#8f9aaa]">Esc</kbd></div><div className="max-h-[min(60vh,28rem)] overflow-y-auto p-2 custom-scrollbar">{quickCommands.filter((cmd) => `${cmd.command} ${cmd.label} ${cmd.description}`.toLowerCase().includes(commandSearch.toLowerCase())).map((cmd) => <button key={cmd.id} type="button" onClick={() => handleExecuteCommand(cmd)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-[#202733]"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#202733]">{cmd.icon}</span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 text-sm font-medium text-white"><span>{cmd.label}</span><span className="font-mono text-xs text-[#718097]">{cmd.command}</span></span><span className="mt-1 block text-xs leading-5 text-[#8995a7]">{cmd.description}</span></span><ArrowRight className="h-4 w-4 shrink-0 text-[#657895]" /></button>)}{quickCommands.filter((cmd) => `${cmd.command} ${cmd.label} ${cmd.description}`.toLowerCase().includes(commandSearch.toLowerCase())).length === 0 && <div className="p-8 text-center text-sm text-[#778396]">No matching commands.</div>}</div></div></div>}

      {showWorkspacePicker && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowWorkspacePicker(false); }}><form onSubmit={(event) => { event.preventDefault(); handleSwitchWorkspace(); }} className="w-full max-w-lg rounded-2xl border border-[#3a4351] bg-[#151a21] p-5 shadow-[0_24px_70px_rgba(0,0,0,.5)] sm:p-6" role="dialog" aria-modal="true" aria-label="Switch workspace"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8da4c6]">Workspace</p><h2 className="mt-1 text-lg font-semibold text-white">Switch project folder</h2><p className="mt-1 text-sm leading-5 text-[#8995a7]">Alisa will read and edit files inside this folder.</p></div><button type="button" onClick={() => setShowWorkspacePicker(false)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#8290a3] hover:bg-[#202733] hover:text-white" aria-label="Close"><X className="h-4 w-4" /></button></div><label htmlFor="workspace-path" className="mt-6 block text-xs font-medium text-[#a9b6c8]">Absolute path</label><input id="workspace-path" type="text" value={workspaceInput} onChange={(event) => setWorkspaceInput(event.target.value)} placeholder="C:/Users/you/Projects/my-app" autoFocus className="mt-2 w-full rounded-xl border border-[#303846] bg-[#0d1015] px-3.5 py-3 text-sm text-white outline-none transition focus:border-[#657895]" />{workspaceSwitchError && <div className="mt-3 rounded-xl border border-[#59343b] bg-[#27181d] px-3 py-2.5 text-xs leading-5 text-[#f0a9b1]">{workspaceSwitchError}</div>}<div className="mt-6 flex justify-end gap-2 border-t border-[#2b333f] pt-4"><button type="button" onClick={() => setShowWorkspacePicker(false)} className="rounded-lg border border-[#303846] bg-[#1a1f27] px-3.5 py-2.5 text-sm font-medium text-[#a9b6c8] hover:border-[#53647b] hover:text-white">Cancel</button><button type="submit" className="rounded-lg bg-[#f0f2f5] px-3.5 py-2.5 text-sm font-semibold text-[#13161b] hover:bg-white">Switch workspace</button></div></form></div>}

      {showSettings && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}><form onSubmit={(event) => { event.preventDefault(); handleSaveConfig(); }} className="w-full max-w-lg rounded-2xl border border-[#3a4351] bg-[#151a21] p-5 shadow-[0_24px_70px_rgba(0,0,0,.5)] sm:p-6" role="dialog" aria-modal="true" aria-label="Project settings"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b8a2da]">Configuration</p><h2 className="mt-1 text-lg font-semibold text-white">Project settings</h2><p className="mt-1 text-sm leading-5 text-[#8995a7]">Connect Alisa to your model gateway and workspace.</p></div><button type="button" onClick={() => setShowSettings(false)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#8290a3] hover:bg-[#202733] hover:text-white" aria-label="Close"><X className="h-4 w-4" /></button></div><div className="mt-6 space-y-4"><div><label htmlFor="settings-api-key" className="text-xs font-medium text-[#a9b6c8]">API key</label><input id="settings-api-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={apiKeyMasked ? 'Stored key (' + apiKeyMasked + ') · enter a new key to replace it' : 'Enter API key'} className="mt-2 w-full rounded-xl border border-[#303846] bg-[#0d1015] px-3.5 py-3 text-sm text-white outline-none focus:border-[#657895]" /></div><div><label htmlFor="settings-base-url" className="text-xs font-medium text-[#a9b6c8]">Base URL</label><input id="settings-base-url" type="url" value={baseURL} onChange={(e) => setBaseURL(e.target.value)} className="mt-2 w-full rounded-xl border border-[#303846] bg-[#0d1015] px-3.5 py-3 text-sm text-white outline-none focus:border-[#657895]" /></div><div><label htmlFor="settings-model" className="text-xs font-medium text-[#a9b6c8]">Model</label><input id="settings-model" type="text" value={model} onChange={(e) => setModel(e.target.value)} className="mt-2 w-full rounded-xl border border-[#303846] bg-[#0d1015] px-3.5 py-3 text-sm text-white outline-none focus:border-[#657895]" /></div><div><label htmlFor="settings-workspace" className="text-xs font-medium text-[#a9b6c8]">Workspace directory</label><input id="settings-workspace" type="text" value={workspaceDir} onChange={(e) => setWorkspaceDir(e.target.value)} className="mt-2 w-full rounded-xl border border-[#303846] bg-[#0d1015] px-3.5 py-3 text-sm text-white outline-none focus:border-[#657895]" /></div></div>{settingsError && <div className="mt-4 rounded-xl border border-[#59343b] bg-[#27181d] px-3 py-2.5 text-xs leading-5 text-[#f0a9b1]">{settingsError}</div>}<div className="mt-6 space-y-3 border-t border-[#2b333f] pt-4"><div className="flex flex-wrap items-center gap-2 text-xs text-[#8d9aae]"><span className={`inline-flex h-2 w-2 rounded-full ${updateState.status === 'error' ? 'bg-[#ff5f56]' : updateState.status === 'not-available' ? 'bg-[#4fd27b]' : updateState.status === 'available' || updateState.status === 'downloaded' ? 'bg-[#8da4c6]' : 'bg-[#d9a84e]'}`} /> <span>{updateState.message || 'Check GitHub Releases for a newer Project Alisa Studio build.'}</span></div><div className="flex flex-wrap items-center justify-between gap-3"><button type="button" onClick={handleCheckForUpdates} disabled={isUpdateActionRunning} className="inline-flex items-center gap-2 rounded-lg border border-[#303846] bg-[#1a1f27] px-3 py-2.5 text-xs font-medium text-[#a9b6c8] transition hover:border-[#53647b] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${isUpdateActionRunning ? 'animate-spin' : ''}`} />{isUpdateActionRunning ? 'Checking…' : 'Check for updates'}</button>{updateState.status === 'available' && <button type="button" onClick={handleDownloadUpdate} disabled={isUpdateActionRunning} className="rounded-lg bg-[#f0f2f5] px-3 py-2.5 text-xs font-semibold text-[#13161b] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50">Download update</button>}{updateState.status === 'downloaded' && <button type="button" onClick={handleInstallUpdate} className="rounded-lg bg-[#7ee787] px-3 py-2.5 text-xs font-semibold text-[#102016] transition hover:bg-[#a3f0ae]">Restart to update</button>}<div className="ml-auto flex gap-2"><button type="button" onClick={() => setShowSettings(false)} className="rounded-lg border border-[#303846] bg-[#1a1f27] px-3.5 py-2.5 text-sm font-medium text-[#a9b6c8] hover:border-[#53647b] hover:text-white">Cancel</button><button type="submit" className="rounded-lg bg-[#f0f2f5] px-3.5 py-2.5 text-sm font-semibold text-[#13161b] hover:bg-white">Save changes</button></div></div></div></form></div>}
    </div>
  );
}
