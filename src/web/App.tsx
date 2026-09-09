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
  ShieldAlert
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

interface TaskPlanItem {
  id: string;
  title: string;
  status: 'completed' | 'in_progress' | 'pending';
}

interface SkillItem {
  name: string;
  category: string;
  description: string;
  source: string;
  path: string;
  active?: boolean;
}

interface GoalStep {
  id: string;
  title: string;
  description: string;
  status: 'completed' | 'in_progress' | 'pending';
  icon: string;
}

interface QuickCommand {
  id: string;
  command: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  category: string;
}

const API_BASE = (typeof window !== 'undefined' && (window.location.protocol === 'file:' || !window.location.host))
  ? 'http://localhost:3001'
  : '';

export default function App() {
  const [activeTab, setActiveTab] = useState<'chat' | 'goal' | 'editor' | 'terminal' | 'plan' | 'skills'>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [status, setStatus] = useState<'idle' | 'thinking' | 'acting' | 'waiting_approval' | 'self_correcting' | 'error' | 'done'>('idle');
  const [statusDetail, setStatusDetail] = useState('Connecting to backend…');
  const [isBackendConnected, setIsBackendConnected] = useState(false);
  
  // Workspace & Files
  const [workspaceDir, setWorkspaceDir] = useState('');
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  
  // OpenClaude Skills System State
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [activeSkillNames, setActiveSkillNames] = useState<string[]>([
    'openclaude-code-standards',
    'subagent-orchestration',
    'systematic-debugging'
  ]);

  // Automated Goal System State
  const [goalObjective, setGoalObjective] = useState('Automate codebase refactoring, typechecking, and security auditing');
  const [isAutomatingGoal, setIsAutomatingGoal] = useState(false);
  const [goalSteps, setGoalSteps] = useState<GoalStep[]>([
    {
      id: 'g1',
      title: 'Inspect Project & Map Dependencies',
      description: 'วิเคราะห์โครงสร้างไฟล์ TypeScript, JSON configs และ package.json',
      status: 'completed',
      icon: 'search'
    },
    {
      id: 'g2',
      title: 'Execute Typecheck & Static Analysis',
      description: 'ตรวจสอบ Type Safety และค้นหาข้อผิดพลาดทางตรรกะในซอร์สโค้ด',
      status: 'in_progress',
      icon: 'bug'
    },
    {
      id: 'g3',
      title: 'Senior Refactoring & Clean Architecture',
      description: 'ปรับปรุงประสิทธิภาพโค้ด จัดการ error handling แบบ defensive',
      status: 'pending',
      icon: 'code'
    },
    {
      id: 'g4',
      title: 'OWASP Security & Secret Leakage Audit',
      description: 'สแกนช่องโหว่ความปลอดภัยและตรวจจับ API Keys ที่สุ่มเสี่ยง',
      status: 'pending',
      icon: 'shield'
    },
    {
      id: 'g5',
      title: 'Build Electron Executable & Verify Artifacts',
      description: 'คอมไพล์ UI/Server และทดสอบการทำงานก่อนส่งมอบ',
      status: 'pending',
      icon: 'target'
    }
  ]);
  
  // Quick Commands & Command Palette Modal
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandSearch, setCommandSearch] = useState('');

  const quickCommands: QuickCommand[] = [
    {
      id: 'c1',
      command: '/goal',
      label: 'Automate Goal Engine',
      description: 'รันวงจรเป้าหมายอัตโนมัติ (Automated Goal Sequence Execution)',
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

  // Tasks Plan / Roadmap
  const [planItems, setPlanItems] = useState<TaskPlanItem[]>([
    { id: '1', title: 'ออกแบบ UI/UX Minimal Dark Mode สไตล์ Project Alisa Studio', status: 'completed' },
    { id: '2', title: 'สร้าง Custom Frameless Top Bar พร้อมปุ่มควบคุม ปิด/ย่อ/ขยาย', status: 'completed' },
    { id: '3', title: 'แก้ไขปัญหาสินค้าจอดำ (File Protocol Restrictions & API Proxy)', status: 'completed' },
    { id: '4', title: 'พัฒนาระบบ Automated Goal Execution และ Command Palette (Ctrl+K)', status: 'completed' },
    { id: '5', title: 'ทดสอบการทำงานจริงบนไฟล์ Project Alisa.exe', status: 'completed' }
  ]);

  // Settings state
  const [showSettings, setShowSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);
  const [workspaceInput, setWorkspaceInput] = useState('');
  const [workspaceSwitchError, setWorkspaceSwitchError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
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
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, activeToolTraces]);

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
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    if (window.electronAPI?.onTouchBarEvent) {
      window.electronAPI.onTouchBarEvent((eventName: string) => {
        if (eventName === 'touchbar-new-chat') {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'clear_history' }));
          }
          setMessages([]);
          addTerminalLog('🧹 [TouchBar] Started New Chat Session.');
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
      setApiKey(data.apiKey || '');
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
        body: JSON.stringify({ apiKey, baseURL, model, workspaceDir }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Settings request failed (${res.status})`);
      }
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
      setSelectedFile(null);
      setFileContent('');
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
    setActiveTab('editor');
    try {
      const res = await fetch(`${API_BASE}/api/files/read?path=${encodeURIComponent(filePath)}`);
      if (!res.ok) throw new Error(`File request failed (${res.status})`);
      const data = await res.json();
      if (data.content !== undefined) {
        setFileContent(data.content);
        addTerminalLog(`📄 Opened File: ${filePath}`);
      }
    } catch (err) {
      console.error('Failed reading file:', err);
    }
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

  const handleSendPrompt = () => {
    if (!inputPrompt.trim() || status === 'thinking' || status === 'acting' || status === 'waiting_approval' || status === 'self_correcting') return;

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setStatus('error');
      setStatusDetail('Backend offline');
      addTerminalLog('⚠️ Cannot send command while the backend is offline.');
      return;
    }

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: inputPrompt,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setStatus('thinking');
    window.electronAPI?.updateTouchBarStatus?.({
      status: 'thinking',
      text: '⚡ Alisa: Thinking...'
    });
    setStatusDetail('Processing query...');

    addTerminalLog(`💬 User: ${inputPrompt}`);

    wsRef.current.send(
      JSON.stringify({
        type: 'start_task',
        prompt: inputPrompt,
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
      setActiveTab('goal');
      handleStartGoalAutomation();
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

  // Automated Goal Sequence Execution Simulation
  const handleStartGoalAutomation = () => {
    setIsAutomatingGoal(true);
    addTerminalLog(`🎯 Starting Goal Sequence: "${goalObjective}"`);

    let currentStep = 0;
    const interval = setInterval(() => {
      setGoalSteps((prev) =>
        prev.map((step, idx) => {
          if (idx < currentStep) return { ...step, status: 'completed' };
          if (idx === currentStep) return { ...step, status: 'in_progress' };
          return { ...step, status: 'pending' };
        })
      );

      if (currentStep >= goalSteps.length) {
        clearInterval(interval);
        setIsAutomatingGoal(false);
        addTerminalLog(`✅ Goal Automation Completed Successfully!`);
        setGoalSteps((prev) => prev.map((s) => ({ ...s, status: 'completed' })));
      } else {
        addTerminalLog(`🔄 Executing Goal Step ${currentStep + 1}: ${goalSteps[currentStep].title}`);
        currentStep++;
      }
    }, 2000);
  };

  const renderFileTree = (nodes: FileNode[]) => {
    return nodes.map((node) => (
      <div key={node.path} className="pl-3">
        {node.type === 'directory' ? (
          <div>
            <div className="flex items-center gap-1.5 py-1 px-1.5 rounded hover:bg-[#1c1c1c] text-xs font-mono text-[#aaaaaa]">
              <Folder className="w-3.5 h-3.5 text-[#777777] shrink-0" />
              <span className="truncate">{node.name}</span>
            </div>
            {node.children && renderFileTree(node.children)}
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

  const completedStepsCount = goalSteps.filter((s) => s.status === 'completed').length;
  const goalProgressPct = Math.round((completedStepsCount / goalSteps.length) * 100);
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

  return (
    <div className="flex flex-col h-screen bg-[#0e0e0e] text-[#e0e0e0] font-sans overflow-hidden select-none">
      {/* ── Custom Window Header Bar (Project Alisa Style) ── */}
      <div className="h-9 bg-[#121212] border-b border-[#242424] px-3 flex items-center justify-between shrink-0 drag-region">
        {/* Left Window Controls & Brand */}
        <div className="flex items-center space-x-3 no-drag">
          <div className="flex items-center space-x-1.5">
            <div 
              onClick={() => (window as any).electronAPI?.close()} 
              className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] cursor-pointer hover:opacity-80 flex items-center justify-center group" 
              title="Close"
            >
              <X className="w-2 h-2 text-[#4a0000] opacity-0 group-hover:opacity-100" />
            </div>
            <div 
              onClick={() => (window as any).electronAPI?.minimize()} 
              className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123] cursor-pointer hover:opacity-80 flex items-center justify-center group" 
              title="Minimize"
            >
              <Minus className="w-2 h-2 text-[#4a3000] opacity-0 group-hover:opacity-100" />
            </div>
            <div 
              onClick={() => (window as any).electronAPI?.maximize()} 
              className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29] cursor-pointer hover:opacity-80 flex items-center justify-center group" 
              title="Maximize"
            >
              <Maximize className="w-2 h-2 text-[#004a00] opacity-0 group-hover:opacity-100" />
            </div>
          </div>

          <div className="h-4 w-px bg-[#262626]" />

          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-[#ffffff] text-[#0e0e0e] flex items-center justify-center font-bold text-[11px] font-mono shadow-sm">
              A
            </div>
            <span className="font-bold text-xs tracking-wider text-[#ffffff] font-mono uppercase">
              ALISA <span className="text-[10px] text-[#777777] font-normal">STUDIO</span>
            </span>
          </div>
        </div>

        {/* Center Title & Live Agent Status Pill (Persistent 24/7) */}
        <div className="hidden md:flex items-center gap-3 font-mono text-xs">
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#181818] border border-[#2a2a2a] shadow-inner">
            <span className={`w-2 h-2 rounded-full ${statusDot}`} />
            <span className={`text-[11px] font-semibold ${statusColor}`}>
              {statusLabel}
            </span>
            {visibleStatusDetail && (
              <span className="text-[#777777] text-[10px] truncate max-w-[180px]">| {visibleStatusDetail}</span>
            )}
          </div>
          <span className="text-[#444444]">•</span>
          <span className="hidden xl:inline text-[#888888] truncate max-w-[180px]">{workspaceDir || 'Project workspace'}</span>
        </div>

        {/* Right Status & Actions */}
        <div className="flex items-center space-x-2 no-drag">
          <button
            onClick={() => {
              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'clear_history' }));
              }
              setMessages([]);
              addTerminalLog('🧹 Started New Chat Session.');
            }}
            className="flex items-center gap-1 px-2 py-1 rounded bg-[#1c1c1c] border border-[#2b2b2b] text-[11px] font-mono whitespace-nowrap text-[#aaaaaa] hover:text-[#ffffff] hover:border-[#444444] transition-all"
            title="New Chat Session"
          >
            <span>+ New Chat</span>
          </button>

          <button
            disabled={status === 'thinking' || status === 'acting' || status === 'waiting_approval' || status === 'self_correcting'}
            onClick={handleOpenWorkspacePicker}
            className="flex items-center gap-1 px-2 py-1 rounded bg-[#1c1c1c] border border-[#2b2b2b] text-[11px] font-mono whitespace-nowrap text-[#aaaaaa] hover:text-[#ffffff] hover:border-[#444444] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            title="Switch project workspace"
          >
            <span>📂 Workspace</span>
          </button>

          <button
            onClick={() => setShowCommandPalette(true)}
            className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#1c1c1c] border border-[#2b2b2b] text-[11px] font-mono whitespace-nowrap text-[#aaaaaa] hover:text-[#ffffff] hover:border-[#444444] transition-all"
            title="Command Palette (Ctrl+K)"
          >
            <Command className="w-3 h-3 text-[#ffffff]" />
            <span className="hidden sm:inline">Commands</span>
            <kbd className="text-[9px] px-1 bg-[#262626] rounded text-[#888888]">Ctrl+K</kbd>
          </button>

          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#1a1a1a] border border-[#262626] text-[11px] font-mono text-[#888888]">
            <div className={`w-2 h-2 rounded-full ${status === 'acting' || status === 'thinking' || status === 'waiting_approval' || status === 'self_correcting' ? 'bg-[#27c93f] animate-pulse' : 'bg-[#777777]'}`} />
            <span className="text-[#cccccc] text-[10px]">{model.split('/')[1] || model}</span>
          </div>

          <button
            onClick={() => {
              setSettingsError(null);
              setShowSettings(true);
            }}
            className="p-1 rounded text-[#888888] hover:text-[#ffffff] hover:bg-[#242424] transition-colors"
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Main Application Content Layout ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── Left Sidebar (Workspace & File Explorer) ── */}
        <div className="w-64 bg-[#121212] border-r border-[#242424] flex flex-col shrink-0">
          <div className="p-3 border-b border-[#242424] flex items-center justify-between">
            <span className="text-xs font-mono font-bold text-[#aaaaaa] uppercase tracking-wider flex items-center gap-1.5">
              <FolderTree className="w-3.5 h-3.5 text-[#ffffff]" /> Explorer
            </span>
            <button onClick={fetchWorkspaceFiles} className="text-[#666666] hover:text-[#ffffff]">
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
            {fileTree.length > 0 ? (
              renderFileTree(fileTree)
            ) : isWorkspaceLoading ? (
              <div className="text-xs text-[#777777] p-3 font-mono italic">
                Loading workspace files…
              </div>
            ) : workspaceError ? (
              <div className="p-3 space-y-2">
                <div className="text-xs text-[#ff8a80] leading-relaxed">{workspaceError}</div>
                <button
                  onClick={fetchWorkspaceFiles}
                  className="text-[11px] text-[#cccccc] hover:text-white underline underline-offset-2"
                >
                  Try again
                </button>
              </div>
            ) : (
              <div className="text-xs text-[#777777] p-3 font-mono italic">
                This workspace has no visible files.
              </div>
            )}
          </div>
        </div>

        {/* ── Center Main Editor / Chat Panel ── */}
        <div className="min-w-0 flex-1 flex flex-col bg-[#0e0e0e] overflow-hidden">
          {/* Top Tab Bar Navigation */}
          <div className="min-w-0 h-10 bg-[#141414] border-b border-[#242424] px-3 flex items-center justify-between shrink-0">
            <div className="tab-scroll min-w-0 flex items-center space-x-1 overflow-x-auto">
              <button
                onClick={() => setActiveTab('chat')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-mono whitespace-nowrap shrink-0 transition-colors rounded ${
                  activeTab === 'chat' ? 'bg-[#242424] text-[#ffffff] font-semibold' : 'text-[#888888] hover:text-[#cccccc]'
                }`}
              >
                <Bot className="w-3.5 h-3.5 text-[#ffffff]" /> Agent Chat
              </button>

              <button
                onClick={() => setActiveTab('goal')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-mono whitespace-nowrap shrink-0 transition-colors rounded ${
                  activeTab === 'goal' ? 'bg-[#242424] text-[#27c93f] font-semibold' : 'text-[#888888] hover:text-[#cccccc]'
                }`}
              >
                <Target className="w-3.5 h-3.5 text-[#27c93f]" /> Automate Goal ({goalProgressPct}%)
              </button>

              <button
                onClick={() => setActiveTab('skills')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-mono whitespace-nowrap shrink-0 transition-colors rounded ${
                  activeTab === 'skills' ? 'bg-[#242424] text-[#ffffff] font-semibold' : 'text-[#888888] hover:text-[#cccccc]'
                }`}
              >
                <Puzzle className="w-3.5 h-3.5 text-[#ffbd2e]" /> Skill Manager ({skills.length})
              </button>

              <button
                onClick={() => setActiveTab('editor')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-mono whitespace-nowrap shrink-0 transition-colors rounded ${
                  activeTab === 'editor' ? 'bg-[#242424] text-[#ffffff] font-semibold' : 'text-[#888888] hover:text-[#cccccc]'
                }`}
              >
                <Code2 className="w-3.5 h-3.5 text-[#ffffff]" /> Editor & Diffs
              </button>

              <button
                onClick={() => setActiveTab('terminal')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-mono whitespace-nowrap shrink-0 transition-colors rounded ${
                  activeTab === 'terminal' ? 'bg-[#242424] text-[#ffffff] font-semibold' : 'text-[#888888] hover:text-[#cccccc]'
                }`}
              >
                <TerminalIcon className="w-3.5 h-3.5 text-[#ffffff]" /> Terminal ({terminalLogs.length})
              </button>

              <button
                onClick={() => setActiveTab('plan')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-mono whitespace-nowrap shrink-0 transition-colors rounded ${
                  activeTab === 'plan' ? 'bg-[#242424] text-[#ffffff] font-semibold' : 'text-[#888888] hover:text-[#cccccc]'
                }`}
              >
                <ListTodo className="w-3.5 h-3.5 text-[#ffffff]" /> Roadmap
              </button>
            </div>

            <div className={`hidden lg:flex items-center gap-2 text-[10px] font-mono px-2 py-1 rounded-full border ${
              isBackendConnected
                ? 'text-[#7ee787] border-[#214d2b] bg-[#122218]'
                : 'text-[#ffbd2e] border-[#4a3b1a] bg-[#211c10]'
            }`} title={isBackendConnected ? 'Backend connected' : 'Backend offline'}>
              <span className={`w-1.5 h-1.5 rounded-full ${isBackendConnected ? 'bg-[#27c93f]' : 'bg-[#ffbd2e]'}`} />
              {isBackendConnected ? 'Backend connected' : 'Backend offline'}
            </div>
          </div>

          {/* ── TAB 1: REACT EXECUTION LOGS & CHAT ── */}
          {activeTab === 'chat' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                {messages.length === 0 && !streamingContent && activeToolTraces.length === 0 && (
                  <div className="h-full min-h-[280px] flex items-center justify-center px-6">
                    <div className="w-full max-w-xl text-center">
                      <div className="mx-auto mb-4 w-12 h-12 rounded-2xl bg-[#f4f4f4] text-[#101010] flex items-center justify-center text-xl font-bold shadow-lg shadow-black/20">
                        A
                      </div>
                      <h1 className="text-xl font-semibold tracking-tight text-white">Project Alisa Studio</h1>
                      <p className="mt-2 text-sm leading-relaxed text-[#8f8f8f]">
                        Ask the agent to inspect, explain, or change the code in your workspace.
                      </p>
                      <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-2 text-left">
                        {[
                          ['Inspect this project', 'สรุปโครงสร้างโปรเจกต์'],
                          ['Find a bug', 'วิเคราะห์บั๊กให้หน่อย'],
                          ['Improve a file', 'ปรับปรุงไฟล์นี้ให้ดีขึ้น'],
                        ].map(([label, prompt]) => (
                          <button
                            key={label}
                            onClick={() => setInputPrompt(prompt)}
                            className="rounded-xl border border-[#2b2b2b] bg-[#151515] px-3 py-3 text-left transition-colors hover:border-[#555555] hover:bg-[#1b1b1b]"
                          >
                            <div className="text-xs font-medium text-[#e5e5e5]">{label}</div>
                            <div className="mt-1 text-[11px] text-[#777777]">{prompt}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                {messages.map((m) => (
                  <div key={m.id} className="space-y-2">
                    {/* User Prompt Bubble */}
                    {m.role === 'user' && (
                      <div className="flex justify-end">
                        <div className="bg-[#242424] text-[#ffffff] px-4 py-2.5 rounded-2xl rounded-tr-none text-sm max-w-2xl font-sans border border-[#333333] shadow-md">
                          {m.content}
                        </div>
                      </div>
                    )}

                    {/* Assistant Response & ReAct Execution Logs */}
                    {m.role === 'assistant' && (
                      <div className="space-y-3">
                        {/* Tool Execution Cards (ReAct Trace Cards) */}
                        {m.toolTraces && m.toolTraces.map((trace, idx) => (
                          <div key={idx} className="bg-[#141414] border border-[#242424] rounded-xl p-3 text-xs font-mono space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded bg-[#262626] text-[#ffffff] font-bold text-[10px] uppercase tracking-wider">
                                  {trace.toolName}
                                </span>
                                <span className="text-[#888888] truncate max-w-md">
                                  {JSON.stringify(trace.args)}
                                </span>
                              </div>
                              <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                                trace.status === 'success' ? 'bg-[#1a331e] text-[#27c93f]' : 'bg-[#3b1c1c] text-[#ff5f56]'
                              }`}>
                                {trace.status}
                              </span>
                            </div>

                            {trace.result && (
                              <pre className="bg-[#0a0a0a] p-2.5 rounded-lg text-[11px] text-[#cccccc] overflow-x-auto border border-[#1f1f1f]">
                                {trace.result}
                              </pre>
                            )}
                          </div>
                        ))}

                        {/* Assistant Thought Block */}
                        {m.thought && (
                          <div className="bg-[#121212] border-l-2 border-[#777777] p-3 text-xs font-mono text-[#888888] rounded-r-lg space-y-1">
                            <div className="text-[10px] uppercase font-bold text-[#aaaaaa] flex items-center gap-1">
                              <Sparkles className="w-3 h-3 text-[#ffffff]" /> Thought Process
                            </div>
                            <div className="whitespace-pre-wrap leading-relaxed">{m.thought}</div>
                          </div>
                        )}

                        {/* Assistant Final Content Output */}
                        <div className="bg-[#121212] border border-[#242424] rounded-2xl rounded-tl-none p-4 text-sm font-sans text-[#e0e0e0] leading-relaxed space-y-2 shadow-lg">
                          <div className="whitespace-pre-wrap">{m.content}</div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Streaming Assistant Card */}
                {(streamingContent || activeToolTraces.length > 0) && (
                  <div className="space-y-3">
                    {activeToolTraces.map((trace, idx) => (
                      <div key={idx} className="bg-[#141414] border border-[#242424] rounded-xl p-3 text-xs font-mono space-y-2 animate-pulse">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-[#262626] text-[#ffffff] font-bold text-[10px] uppercase">
                              {trace.toolName}
                            </span>
                            <span className="text-[#888888]">{JSON.stringify(trace.args)}</span>
                          </div>
                          <span className="text-[10px] text-[#ffbd2e]">EXECUTING...</span>
                        </div>
                      </div>
                    ))}

                    {streamingContent && (
                      <div className="bg-[#121212] border border-[#242424] rounded-2xl rounded-tl-none p-4 text-sm font-sans text-[#e0e0e0] whitespace-pre-wrap">
                        {streamingContent}
                      </div>
                    )}
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>

              {/* ── Input Box Container (OpenCode Minimalist Floating Design) ── */}
              <div className="p-4 bg-[#121212] border-t border-[#242424] shrink-0">
                <div className="bg-[#181818] border border-[#262626] rounded-xl p-3 space-y-2.5 focus-within:border-[#444444] transition-all shadow-inner">
                  <textarea
                    rows={3}
                    value={inputPrompt}
                    onChange={(e) => setInputPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendPrompt();
                      }
                    }}
                    placeholder="ถามคำสั่ง หรือสั่งงานพัฒนาโค้ด (เช่น 'เขียนโค้ด', 'วิเคราะห์บั๊ก', '/goal', '/audit')..."
                    className="w-full bg-transparent text-xs text-[#ffffff] placeholder-[#555555] focus:outline-none resize-none font-sans"
                  />

                  <div className="flex items-center justify-between border-t border-[#222222] pt-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowCommandPalette(true)}
                        className="px-2.5 py-1 rounded-full bg-[#222222] text-[#888888] hover:text-[#ffffff] text-[10px] font-mono flex items-center gap-1 hover:bg-[#2b2b2b] transition-all"
                      >
                        <Command className="w-3 h-3 text-[#ffffff]" /> Quick Actions
                      </button>

                      <div className="px-2.5 py-1 rounded-full bg-[#222222] text-[#888888] text-[10px] font-mono flex items-center gap-1">
                        <Puzzle className="w-3 h-3 text-[#ffbd2e]" /> Skills: {activeSkillNames.length} Active
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-[#666666] font-mono hidden sm:inline">Press Enter to Send</span>
                      <button
                        onClick={handleSendPrompt}
                        disabled={!inputPrompt.trim() || status === 'thinking' || status === 'acting' || status === 'waiting_approval' || status === 'self_correcting'}
                        className="px-3.5 py-1.5 rounded-lg bg-[#ffffff] text-[#0e0e0e] hover:bg-[#e0e0e0] font-bold text-xs disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
                      >
                        <Send className="w-3 h-3" /> ส่งคำสั่ง
                      </button>
                    </div>
                  </div>
                </div>

                {/* Mandatory Safety Notice */}
                <div className="text-center mt-2.5 text-[10px] text-[#666666] font-sans">
                  Alisa เป็นเพียง AI ที่อาจทำงานผิดได้ โปรดตรวจสอบคำตอบทุกครั้ง
                </div>
              </div>
            </div>
          )}

          {/* ── TAB 2: AUTOMATED GOAL ENGINE ── */}
          {activeTab === 'goal' && (
            <div className="flex-1 p-6 overflow-y-auto bg-[#0e0e0e] space-y-6 custom-scrollbar">
              <div className="bg-[#141414] border border-[#262626] rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#1f3a22] border border-[#27c93f] flex items-center justify-center">
                      <Target className="w-5 h-5 text-[#27c93f]" />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-[#ffffff] font-mono">Autonomous Goal Execution Engine</h2>
                      <p className="text-xs text-[#888888]">วางแผนและประมวลผลงานแบบอัตโนมัติทีละขั้นตอน (Sequential Subtask Execution)</p>
                    </div>
                  </div>

                  <button
                    onClick={handleStartGoalAutomation}
                    disabled={isAutomatingGoal}
                    className="px-4 py-2 rounded-xl bg-[#27c93f] text-[#0e0e0e] font-bold text-xs font-mono hover:bg-[#22b537] disabled:opacity-50 transition-all flex items-center gap-2 shadow-lg"
                  >
                    {isAutomatingGoal ? <PauseCircle className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
                    {isAutomatingGoal ? 'Executing Goal...' : 'Run Goal Sequence'}
                  </button>
                </div>

                {/* Goal Objective Input */}
                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-[#888888]">Goal Objective</label>
                  <input
                    type="text"
                    value={goalObjective}
                    onChange={(e) => setGoalObjective(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-[#0a0a0a] border border-[#262626] text-xs text-[#ffffff] font-mono focus:outline-none focus:border-[#444444]"
                  />
                </div>

                {/* Progress Bar */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-[#888888]">Goal Progress</span>
                    <span className="text-[#27c93f] font-bold">{goalProgressPct}% Completed</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-[#222222] overflow-hidden">
                    <div className="h-full bg-[#27c93f] transition-all duration-500" style={{ width: `${goalProgressPct}%` }} />
                  </div>
                </div>
              </div>

              {/* Goal Steps List */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-[#aaaaaa] font-mono uppercase tracking-wider">Sequential Action Plan</h3>
                {goalSteps.map((step, idx) => (
                  <div
                    key={step.id}
                    className={`p-4 rounded-xl border flex items-center justify-between transition-all ${
                      step.status === 'completed'
                        ? 'bg-[#141a14] border-[#1e3b21]'
                        : step.status === 'in_progress'
                        ? 'bg-[#1a1810] border-[#3d3319]'
                        : 'bg-[#121212] border-[#222222]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-lg bg-[#222222] text-[#ffffff] font-mono text-xs font-bold flex items-center justify-center">
                        {idx + 1}
                      </div>
                      <div>
                        <div className="font-bold text-xs text-[#ffffff] font-mono">{step.title}</div>
                        <div className="text-xs text-[#888888]">{step.description}</div>
                      </div>
                    </div>

                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-mono uppercase font-bold ${
                      step.status === 'completed'
                        ? 'bg-[#1a331e] text-[#27c93f]'
                        : step.status === 'in_progress'
                        ? 'bg-[#3d3319] text-[#ffbd2e] animate-pulse'
                        : 'bg-[#222222] text-[#777777]'
                    }`}>
                      {step.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── TAB 3: SKILL SYSTEM MANAGER ── */}
          {activeTab === 'skills' && (
            <div className="flex-1 p-6 overflow-y-auto bg-[#0e0e0e] space-y-4 custom-scrollbar">
              <div className="flex items-center justify-between pb-3 border-b border-[#242424]">
                <div>
                  <h2 className="text-sm font-bold text-[#ffffff] font-mono flex items-center gap-2">
                    <Puzzle className="w-4 h-4 text-[#ffbd2e]" /> Agent Skills
                  </h2>
                  <p className="text-xs text-[#888888]">เปิดใช้ความสามารถที่ Alisa ควรใช้กับงานใน session นี้</p>
                </div>
                <button
                  onClick={fetchSkills}
                  className="px-3 py-1.5 rounded bg-[#1c1c1c] hover:bg-[#242424] text-[#ffffff] text-xs font-mono border border-[#262626]"
                >
                  Refresh Skills
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {skills.map((skill) => {
                  const isActive = activeSkillNames.includes(skill.name);
                  return (
                    <div
                      key={skill.name}
                      className={`p-4 rounded-xl border transition-all ${
                        isActive
                          ? 'bg-[#161616] border-[#383838]'
                          : 'bg-[#121212] border-[#222222]'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-[#ffffff] font-mono">{skill.name}</span>
                            <span className="text-[9px] px-2 py-0.5 rounded bg-[#242424] text-[#888888] font-mono uppercase">
                              {skill.category}
                            </span>
                          </div>
                          <p className="text-xs text-[#aaaaaa] leading-relaxed">{skill.description}</p>
                        </div>
                        <button
                          onClick={() => toggleSkillActive(skill.name)}
                          className={`px-3 py-1 rounded text-xs font-mono transition-all ${
                            isActive
                              ? 'bg-[#27c93f] text-[#0e0e0e] font-bold'
                              : 'bg-[#222222] text-[#888888] hover:text-[#ffffff]'
                          }`}
                        >
                          {isActive ? 'ACTIVE' : 'ENABLE'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── TAB 4: EDITOR & FILE DIFFS ── */}
          {activeTab === 'editor' && (
            <div className="flex-1 flex flex-col bg-[#0e0e0e] overflow-hidden">
              <div className="p-3 bg-[#121212] border-b border-[#242424] text-xs font-mono text-[#888888] flex items-center justify-between">
                <span>File: <strong className="text-[#ffffff]">{selectedFile || 'No file selected'}</strong></span>
                <span className="text-[10px] text-[#666666]">Read-only Diff Viewer</span>
              </div>
              <div className="flex-1 overflow-auto p-4 custom-scrollbar">
                {fileContent ? (
                  <pre className="text-xs font-mono text-[#dddddd] whitespace-pre-wrap leading-relaxed">
                    {fileContent}
                  </pre>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-[#666666] font-mono">
                    เลือกไฟล์ทางซ้ายเพื่อแสดงโค้ดและ Diff
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── TAB 5: TERMINAL CONSOLE LOGS ── */}
          {activeTab === 'terminal' && (
            <div className="flex-1 flex flex-col bg-[#0a0a0a] overflow-hidden font-mono p-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#222222] mb-3">
                <span className="text-xs font-bold text-[#aaaaaa] flex items-center gap-2">
                  <TerminalIcon className="w-4 h-4 text-[#ffffff]" /> Terminal & ReAct System Logs
                </span>
                <button
                  onClick={() => setTerminalLogs([])}
                  className="px-2.5 py-1 rounded bg-[#1c1c1c] text-[#888888] hover:text-[#ffffff] text-xs"
                >
                  Clear Console
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-1.5 text-xs text-[#27c93f] custom-scrollbar">
                {terminalLogs.slice(-200).map((log, i) => (
                  <div key={i} className="leading-relaxed whitespace-pre-wrap">{log}</div>
                ))}
              </div>
            </div>
          )}

          {/* ── TAB 6: ROADMAP ── */}
          {activeTab === 'plan' && (
            <div className="flex-1 p-6 overflow-y-auto bg-[#0e0e0e] space-y-4 custom-scrollbar">
              <h2 className="text-sm font-bold text-[#ffffff] font-mono flex items-center gap-2">
                <ListTodo className="w-4 h-4 text-[#ffffff]" /> Project Task Roadmap
              </h2>
              <div className="space-y-2">
                {planItems.map((item) => (
                  <div key={item.id} className="p-3 rounded-lg bg-[#141414] border border-[#242424] flex items-center justify-between text-xs font-mono">
                    <span className="text-[#dddddd]">{item.title}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      item.status === 'completed' ? 'bg-[#1a331e] text-[#27c93f]' : 'bg-[#3b2d1c] text-[#ffbd2e]'
                    }`}>
                      {item.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── COMMAND PALETTE MODAL (Ctrl + K) ── */}
      {showCommandPalette && (
        <div className="fixed inset-0 bg-black/80 flex items-start justify-center pt-20 p-4 z-50">
          <div className="bg-[#141414] border border-[#2c2c2c] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl space-y-2">
            <div className="p-3 border-b border-[#242424] flex items-center gap-2 bg-[#0e0e0e]">
              <Search className="w-4 h-4 text-[#777777]" />
              <input
                type="text"
                value={commandSearch}
                onChange={(e) => setCommandSearch(e.target.value)}
                placeholder="Search commands or actions (e.g. /goal, /test, /audit)..."
                className="w-full bg-transparent text-xs text-[#ffffff] focus:outline-none font-mono"
                autoFocus
              />
              <button onClick={() => setShowCommandPalette(false)} className="text-[#888888] hover:text-[#ffffff] text-xs font-mono">
                ESC
              </button>
            </div>

            <div className="p-2 max-h-80 overflow-y-auto space-y-1 custom-scrollbar">
              {quickCommands
                .filter((cmd) => cmd.command.toLowerCase().includes(commandSearch.toLowerCase()) || cmd.label.toLowerCase().includes(commandSearch.toLowerCase()))
                .map((cmd) => (
                  <div
                    key={cmd.id}
                    onClick={() => handleExecuteCommand(cmd)}
                    className="p-2.5 rounded-xl hover:bg-[#222222] cursor-pointer flex items-center justify-between group transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-[#1c1c1c] border border-[#2b2b2b]">
                        {cmd.icon}
                      </div>
                      <div>
                        <div className="font-bold text-xs text-[#ffffff] font-mono flex items-center gap-2">
                          {cmd.label}
                          <span className="text-[10px] text-[#777777] font-normal">{cmd.command}</span>
                        </div>
                        <div className="text-[11px] text-[#888888]">{cmd.description}</div>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-[#555555] group-hover:text-[#ffffff] transition-colors" />
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {showWorkspacePicker && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              handleSwitchWorkspace();
            }}
            className="bg-[#141414] border border-[#262626] rounded-xl w-full max-w-lg p-5 space-y-4 text-xs font-mono shadow-2xl"
          >
            <div className="flex items-center justify-between pb-2 border-b border-[#242424]">
              <div>
                <h3 className="font-bold text-[#ffffff]">Switch Workspace</h3>
                <p className="mt-1 text-[11px] text-[#777777]">เลือกโฟลเดอร์โปรเจกต์ที่ Alisa จะอ่านและแก้ไข</p>
              </div>
              <button type="button" onClick={() => setShowWorkspacePicker(false)} className="text-[#888888] hover:text-[#ffffff]">✕</button>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[#888888]" htmlFor="workspace-path">Absolute workspace path</label>
              <input
                id="workspace-path"
                type="text"
                value={workspaceInput}
                onChange={(event) => setWorkspaceInput(event.target.value)}
                placeholder="C:/Users/YourName/Desktop/my-project"
                autoFocus
                className="w-full px-3 py-2 rounded bg-[#0a0a0a] border border-[#242424] text-[#ffffff] focus:outline-none focus:border-[#555555]"
              />
            </div>

            {workspaceSwitchError && (
              <div className="rounded-lg border border-[#5b2929] bg-[#241313] px-3 py-2 text-[11px] leading-relaxed text-[#ffaaa4]">
                {workspaceSwitchError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-[#242424]">
              <button type="button" onClick={() => setShowWorkspacePicker(false)} className="px-3 py-1.5 rounded bg-[#222222] text-[#aaaaaa] hover:text-[#ffffff]">Cancel</button>
              <button type="submit" className="px-3 py-1.5 rounded bg-[#ffffff] text-[#0e0e0e] font-bold">Switch workspace</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Settings Modal ── */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-[#141414] border border-[#262626] rounded-xl w-full max-w-md p-5 space-y-4 text-xs font-mono shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-[#242424]">
              <h3 className="font-bold text-[#ffffff]">Project Alisa Settings</h3>
              <button onClick={() => setShowSettings(false)} className="text-[#888888] hover:text-[#ffffff]">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[#888888] mb-1">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full px-3 py-1.5 rounded bg-[#0a0a0a] border border-[#242424] text-[#ffffff] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[#888888] mb-1">Base URL (Gateway)</label>
                <input
                  type="text"
                  value={baseURL}
                  onChange={(e) => setBaseURL(e.target.value)}
                  className="w-full px-3 py-1.5 rounded bg-[#0a0a0a] border border-[#242424] text-[#ffffff] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[#888888] mb-1">LLM Model</label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full px-3 py-1.5 rounded bg-[#0a0a0a] border border-[#242424] text-[#ffffff] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[#888888] mb-1">Workspace Directory</label>
                <input
                  type="text"
                  value={workspaceDir}
                  onChange={(e) => setWorkspaceDir(e.target.value)}
                  className="w-full px-3 py-1.5 rounded bg-[#0a0a0a] border border-[#242424] text-[#ffffff] focus:outline-none"
                />
              </div>
            </div>
            {settingsError && (
              <div className="rounded-lg border border-[#5b2929] bg-[#241313] px-3 py-2 text-[11px] leading-relaxed text-[#ffaaa4]">
                {settingsError}
              </div>
            )}
            <div className="flex items-center justify-between pt-2 border-t border-[#242424]">
              <button
                onClick={async () => {
                try {
                  addTerminalLog('🔄 Checking for harness updates & pre-installed skills...');
                    const res = await fetch(`${API_BASE}/api/update/check`);
                    if (!res.ok) throw new Error(`Update check failed (${res.status})`);
                    const data = await res.json();
                    addTerminalLog(`✨ Update Status: ${data.status} (Version: ${data.version})`);
                    alert(`Update Check: ${data.status}`);
                    fetchSkills();
                  } catch (err: any) {
                    alert('Update check failed: ' + err.message);
                  }
                }}
                className="px-3 py-1 rounded bg-[#1c1c1c] border border-[#2b2b2b] text-[#cccccc] hover:text-[#ffffff] transition-colors"
              >
                🔄 Check Updates & Skills
              </button>
              <div className="flex gap-2">
                <button onClick={() => setShowSettings(false)} className="px-3 py-1 rounded bg-[#222222] text-[#aaaaaa]">Cancel</button>
                <button onClick={handleSaveConfig} className="px-3 py-1 rounded bg-[#ffffff] text-[#0e0e0e] font-bold">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
