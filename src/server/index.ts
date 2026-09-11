import { discoverSkills } from '../core/skills';
import { ScheduleStore } from './schedules';
import { gitOverview, listPullRequests } from './git';
import { z } from 'zod';
import { SessionStore, type SavedRun } from './sessions';
import { resolveWorkspacePath } from '../core/workspace';
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { Agent } from '../core/agent.ts';
import { SwarmRunner } from '../core/swarm.ts';
import { LLMClient, type LLMConfig } from '../llm/client.ts';
import type { AgentEvent, AgentMode, AgentStatus, Goal, SwarmAgent } from '../core/types.ts';
import { getTxManager, writeFileTool } from '../tools/file-ops.ts';
import { terminalTool } from '../tools/terminal.ts';
import { AtomicJsonStore } from './config-store.ts';
import { TerminalSessionManager, type TerminalTarget } from './terminal-sessions.ts';
import { detectCapabilities } from '../core/capabilities.ts';

const PORT = Number(process.env.PORT || 3101);
const RUNTIME_DIR = process.env.ALISA_CONFIG_DIR || process.cwd();
export interface ProviderProfile {
  id: string;
  name: string;
  baseURL: string;
  apiKey: string;
  model: string;
  isPreset?: boolean;
}

interface AppConfig extends LLMConfig {
  workspaceDir: string;
  recentWorkspaces: string[];
  activeProviderId: string;
  providers: ProviderProfile[];
}

interface ProviderModel {
  id: string;
  name?: string;
  ownedBy?: string;
  created?: number;
  contextWindow?: number;
}

interface ProviderModelCacheEntry {
  baseURL: string;
  apiKey: string;
  fetchedAt: number;
  models: ProviderModel[];
}

const providerModelCache = new Map<string, ProviderModelCacheEntry>();
const PROVIDER_MODEL_CACHE_TTL_MS = 5 * 60 * 1000;

function normalizeProviderModels(payload: unknown): ProviderModel[] {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
  const nestedData = root?.data && typeof root.data === 'object' && !Array.isArray(root.data)
    ? root.data as Record<string, unknown>
    : null;
  const records = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.data)
      ? root.data
      : Array.isArray(root?.models)
        ? root.models
        : Array.isArray(nestedData?.models)
          ? nestedData.models
          : [];

  const seen = new Set<string>();
  const models: ProviderModel[] = [];
  for (const record of records) {
    const value = typeof record === 'string'
      ? { id: record }
      : record && typeof record === 'object'
        ? record as Record<string, unknown>
        : null;
    if (!value) continue;
    const rawId = value.id ?? value.model ?? value.name;
    if (typeof rawId !== 'string') continue;
    const id = rawId.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const model: ProviderModel = { id };
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    const ownedBy = typeof value.owned_by === 'string'
      ? value.owned_by.trim()
      : typeof value.ownedBy === 'string'
        ? value.ownedBy.trim()
        : '';
    if (name && name !== id) model.name = name;
    if (ownedBy) model.ownedBy = ownedBy;
    if (typeof value.created === 'number') model.created = value.created;
    const rawContextWindow = value.context_length ?? value.contextWindow ?? value.context_window ?? value.max_context_length ?? value.max_input_tokens;
    if (typeof rawContextWindow === 'number' && Number.isFinite(rawContextWindow) && rawContextWindow > 0) {
      model.contextWindow = Math.round(rawContextWindow);
    }
    models.push(model);
  }
  return models;
}

const DEFAULT_CONTEXT_WINDOW = 128_000;

function contextWindowForModel(providerId: string, modelId: string) {
  const models = providerModelCache.get(providerId)?.models || [];
  const exact = models.find(model => model.id === modelId);
  return exact?.contextWindow || DEFAULT_CONTEXT_WINDOW;
}

function invalidateProviderModels(providerId?: string) {
  if (providerId) providerModelCache.delete(providerId);
  else providerModelCache.clear();
}

async function discoverProviderModels(provider: ProviderProfile, force = false) {
  const baseURL = provider.baseURL.replace(/\/+$/, '');
  const cached = providerModelCache.get(provider.id);
  if (!force && cached && cached.baseURL === baseURL && cached.apiKey === provider.apiKey && Date.now() - cached.fetchedAt < PROVIDER_MODEL_CACHE_TTL_MS) {
    return { ...cached, cached: true };
  }

  const headers = provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : undefined;
  const response = await fetch(`${baseURL}/models`, {
    headers,
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (!response.ok) {
    throw new Error(`Provider returned HTTP ${response.status}. Check the URL and API key.`);
  }
  const models = normalizeProviderModels(await response.json() as unknown);
  const entry: ProviderModelCacheEntry = { baseURL, apiKey: provider.apiKey, fetchedAt: Date.now(), models };
  providerModelCache.set(provider.id, entry);
  return { ...entry, cached: false };
}

const CONFIG_FILE = path.join(RUNTIME_DIR, '.alisa-config.json');
const LEGACY_CONFIG_FILE = path.join(RUNTIME_DIR, '.ichigo-config.json');
const ALISA_SESSIONS_DIR = path.join(RUNTIME_DIR, '.alisa-sessions');
const migrationConfigSources = process.env.ALISA_CONFIG_MIGRATION_SOURCE
  ? [path.resolve(process.env.ALISA_CONFIG_MIGRATION_SOURCE)]
  : [];
const configStore = new AtomicJsonStore<AppConfig>(CONFIG_FILE, {
  backupCount: 3,
  legacyPaths: [LEGACY_CONFIG_FILE, ...migrationConfigSources],
});

if (!fs.existsSync(RUNTIME_DIR)) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
}
try { fs.chmodSync(RUNTIME_DIR, 0o700); } catch { /* Best Effort on Windows. */ }
if (!fs.existsSync(ALISA_SESSIONS_DIR)) {
  fs.mkdirSync(ALISA_SESSIONS_DIR, { recursive: true });
}
try { fs.chmodSync(ALISA_SESSIONS_DIR, 0o700); } catch { /* Best Effort on Windows. */ }

// Helper to load Hermes OmniRoute config if available
function loadHermesConfig() {
  try {
    const userHome = process.env.USERPROFILE || process.env.HOME || process.cwd();
    const candidates = process.platform === 'win32'
      ? [path.join(userHome, 'AppData', 'Local', 'hermes', 'config.yaml')]
      : [path.join(userHome, '.config', 'hermes', 'config.yaml'), path.join(userHome, '.local', 'share', 'hermes', 'config.yaml')];
    const hermesCfgPath = candidates.find(candidate => fs.existsSync(candidate));
    if (hermesCfgPath) {
      const content = fs.readFileSync(hermesCfgPath, 'utf-8');
      const baseUrlMatch = content.match(/(?:base_url|baseURL):\s*([^\s\r\n]+)/);
      const apiKeyMatch = content.match(/(?:api_key|apiKey):\s*([^\s\r\n]+)/);
      const defaultModelMatch = content.match(/(?:default|model):\s*([^\s\r\n]+)/);
      return {
        baseURL: baseUrlMatch?.[1]?.replace(/^['"]|['"]$/g, ''),
        apiKey: apiKeyMatch?.[1]?.replace(/^['"]|['"]$/g, ''),
        model: defaultModelMatch?.[1]?.replace(/^['"]|['"]$/g, ''),
      };
    }
  } catch (err) {
    console.error('Failed reading Hermes config:', err);
  }
  return null;
}

const hermesFallback = loadHermesConfig();

const DEFAULT_PROVIDERS: ProviderProfile[] = [
  {
    id: 'omniroute',
    name: 'OmniRoute',
    baseURL: hermesFallback?.baseURL || process.env.OMNIROUTE_BASE_URL || 'http://127.0.0.1:10009/v1',
    apiKey: hermesFallback?.apiKey || process.env.OMNIROUTE_API_KEY || '',
    model: hermesFallback?.model || 'auto/best-coding',
    isPreset: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY || '',
    model: 'deepseek/deepseek-chat',
    isPreset: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    isPreset: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY || '',
    model: 'gpt-4o-mini',
    isPreset: true,
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    baseURL: 'http://127.0.0.1:11434/v1',
    apiKey: 'ollama',
    model: 'qwen2.5-coder:latest',
    isPreset: true,
  },
];

let currentConfig: AppConfig = {
  apiKey: DEFAULT_PROVIDERS[0].apiKey,
  baseURL: DEFAULT_PROVIDERS[0].baseURL,
  model: DEFAULT_PROVIDERS[0].model,
  workspaceDir: process.cwd(),
  recentWorkspaces: [process.cwd()],
  activeProviderId: DEFAULT_PROVIDERS[0].id,
  providers: DEFAULT_PROVIDERS,
};

function cloneConfig(config: AppConfig = currentConfig): AppConfig {
  return {
    ...config,
    recentWorkspaces: [...(config.recentWorkspaces || [])],
    providers: (config.providers || []).map(provider => ({ ...provider })),
  };
}

function persistConfig(
  config: AppConfig = currentConfig,
  options: { repair?: boolean } = {},
) {
  configStore.write(config, {
    rotateBackups: !options.repair,
    archivePrimary: options.repair,
  });
}

const loadedConfig = configStore.read();
const configFileToRead = loadedConfig.source;
if (configFileToRead && loadedConfig.value) {
  try {
    const saved = loadedConfig.value;
    currentConfig = { ...currentConfig, ...saved };
    if (!Array.isArray(currentConfig.providers) || currentConfig.providers.length === 0) {
      currentConfig.providers = DEFAULT_PROVIDERS;
    } else {
      for (const def of DEFAULT_PROVIDERS) {
        const found = currentConfig.providers.find(p => p.id === def.id);
        if (!found) {
          currentConfig.providers.push(def);
        } else if (!found.apiKey && def.apiKey) {
          found.apiKey = def.apiKey;
        }
      }
    }
    if (saved.baseURL && !saved.activeProviderId) {
      // Legacy config or test provided explicit baseURL/apiKey
      currentConfig.baseURL = saved.baseURL;
      currentConfig.apiKey = saved.apiKey || '';
      currentConfig.model = saved.model || 'auto/best-coding';
      const existing = currentConfig.providers.find(p => p.baseURL === saved.baseURL);
      if (existing) {
        currentConfig.activeProviderId = existing.id;
        existing.apiKey = currentConfig.apiKey;
        existing.model = currentConfig.model;
      } else {
        const custom: ProviderProfile = {
          id: 'custom_default',
          name: 'Custom Endpoint',
          baseURL: saved.baseURL,
          apiKey: currentConfig.apiKey,
          model: currentConfig.model,
          isPreset: false,
        };
        currentConfig.providers.unshift(custom);
        currentConfig.activeProviderId = custom.id;
      }
    } else {
      if (!currentConfig.activeProviderId) {
        currentConfig.activeProviderId = 'omniroute';
      }
      const active = currentConfig.providers.find(p => p.id === currentConfig.activeProviderId) || currentConfig.providers[0];
      currentConfig.baseURL = active.baseURL;
      currentConfig.apiKey = active.apiKey;
      currentConfig.model = active.model;
    }
    if (!fs.existsSync(currentConfig.workspaceDir) || !fs.statSync(currentConfig.workspaceDir).isDirectory()) {
      currentConfig.workspaceDir = process.cwd();
    } else {
      currentConfig.workspaceDir = path.resolve(currentConfig.workspaceDir);
    }
    if (Array.isArray(saved.recentWorkspaces)) {
      currentConfig.recentWorkspaces = saved.recentWorkspaces.filter((w: any) => typeof w === 'string' && fs.existsSync(w));
    }
    if (!currentConfig.recentWorkspaces.includes(currentConfig.workspaceDir)) {
      currentConfig.recentWorkspaces.unshift(currentConfig.workspaceDir);
    }
    if (loadedConfig.repaired) {
      persistConfig(currentConfig, { repair: true });
      console.warn(`[Alisa Studio] Restored settings from ${path.basename(configFileToRead)} and rewrote ${path.basename(CONFIG_FILE)}.`);
    }
  } catch (error) {
    console.error('[Alisa Studio] Failed to normalize saved settings:', error);
  }
} else if (loadedConfig.errors.length > 0) {
  try {
    persistConfig(currentConfig, { repair: true });
    console.warn(`[Alisa Studio] Settings files were unreadable; preserved recovery copies and wrote fresh defaults to ${CONFIG_FILE}.`);
  } catch (error) {
    console.error('[Alisa Studio] Unable to repair settings:', error);
  }
}

function getPublicConfig(config: AppConfig) {
  const maskKey = (key?: string) => {
    if (!key) return '';
    if (key.length <= 8) return '••••••••';
    return `${key.slice(0, 4)}••••${key.slice(-4)}`;
  };

  return {
    baseURL: config.baseURL,
    model: config.model,
    workspaceDir: config.workspaceDir,
    recentWorkspaces: config.recentWorkspaces || [config.workspaceDir],
    hasKey: Boolean(config.apiKey),
    apiKeyMasked: maskKey(config.apiKey),
    activeProviderId: config.activeProviderId || 'omniroute',
    providers: (config.providers || DEFAULT_PROVIDERS).map(p => ({
      id: p.id,
      name: p.name,
      baseURL: p.baseURL,
      model: p.model,
      isPreset: Boolean(p.isPreset),
      hasKey: Boolean(p.apiKey),
      apiKeyMasked: maskKey(p.apiKey),
    })),
  };
}

function pickFolderNative(): Promise<string | null> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    let cmd = '';
    let args: string[] = [];

    if (isWin) {
      cmd = 'powershell';
      args = [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-Command',
        "[System.Reflection.Assembly]::LoadWithPartialName('System.windows.forms') | Out-Null; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select Project Workspace'; $f.ShowNewFolderButton = $true; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($f.SelectedPath) }"
      ];
    } else if (isMac) {
      cmd = 'osascript';
      args = ['-e', 'POSIX path of (choose folder with prompt "Select Project Workspace")'];
    } else {
      cmd = 'zenity';
      args = ['--file-selection', '--directory', '--title=Select Project Workspace'];
    }

    try {
      const child = spawn(cmd, args, { windowsHide: true });
      let output = '';
      child.stdout?.on('data', (chunk) => output += chunk.toString());
      child.on('close', (code) => {
        const trimmed = output.trim();
        if (code === 0 && trimmed && fs.existsSync(trimmed) && fs.statSync(trimmed).isDirectory()) {
          resolve(trimmed);
        } else {
          resolve(null);
        }
      });
      child.on('error', () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

const sessions = new SessionStore(ALISA_SESSIONS_DIR);
const activeWorkspaces = new Set<string>();
type SessionSavedEvent = { type: 'session_saved'; sessionId: string; status: AgentStatus; detail?: string; durationMs: number; completedAt: number; swarm?: boolean; agents?: SwarmAgent[] };
type TaskStateEvent = { type: 'task_state'; sessionId: string; status: AgentStatus; detail?: string; model: string; mode: AgentMode; startedAt: number; swarm?: boolean; contextWindow?: number };
type TerminalServerEvent =
  | { type: 'terminal_started'; id: string; kind: 'local' | 'ssh'; cwd?: string; host?: string; username?: string; port?: number; startedAt: number }
  | { type: 'terminal_output'; sessionId: string; data: string; stream: 'stdout' | 'stderr' }
  | { type: 'terminal_exit'; sessionId: string; code: number | null; signal: NodeJS.Signals | null; reason?: string }
  | { type: 'terminal_error'; sessionId: string; message: string };
const activeTaskStates = new Map<string, TaskStateEvent>();
const schedules = new ScheduleStore(path.join(RUNTIME_DIR, '.alisa-schedules.json'));
const scheduler = setInterval(() => {
  schedules.tick(async schedule => {
    const workspace = schedule.workspace;
    if (!fs.existsSync(workspace)) throw new Error('Scheduled workspace no longer exists');
    activeWorkspaces.add(workspace);
    const session = sessions.create(workspace);
    const agent = new Agent({ cwd: workspace, mode: 'ask', maxIterations: 10, llm: new LLMClient({ ...currentConfig }), onEvent(event) {
      if (event.type === 'message_added') { session.messages.push(event.message); sessions.save(session); }
    }});
    try {
      await agent.runTask(schedule.prompt);
      if (agent.getStatus() === 'error') throw new Error(`Scheduled task failed. Review chat ${session.id}`);
      return session.id;
    } finally { activeWorkspaces.delete(workspace); }
  }, workspace => activeWorkspaces.has(workspace)).catch(err => console.error('Scheduler failed:', err.message));
}, 15000);
scheduler.unref();

const trustedOrigins = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`, 'http://127.0.0.1:3050', 'http://localhost:3050', 'http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost']);

function trustedHost(host?: string) {
  try { return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(`http://${host}`).hostname); } catch { return false; }
}

const server = http.createServer(async (req, res) => {
  // Enable CORS
  const origin = req.headers.origin;
  if ((origin && !trustedOrigins.has(origin)) || !trustedHost(req.headers.host)) {
    res.writeHead(403); res.end('Untrusted origin'); return;
  }
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'POST' && req.headers['content-type'] && !req.headers['content-type'].startsWith('application/json')) {
    res.writeHead(415); res.end('Use application/json'); return;
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (url.pathname === '/api/git' && req.method === 'GET') {
    try { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await gitOverview(currentConfig.workspaceDir))); }
    catch { res.writeHead(400); res.end(JSON.stringify({ error: 'Cannot read Git status. Open an initialized Git repository with at least one commit.' })); }
    return;
  }
  if (url.pathname === '/api/pull-requests' && req.method === 'GET') {
    try { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ pullRequests: await listPullRequests(currentConfig.workspaceDir) })); }
    catch (err: any) { res.writeHead(400); res.end(JSON.stringify({ error: err.message })); }
    return;
  }
  if (url.pathname === '/api/schedules' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ schedules: schedules.list(currentConfig.workspaceDir) })); return;
  }
  if (url.pathname === '/api/schedules' && req.method === 'POST') {
    try {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 64000) throw new Error('Schedule request is too large'); }
      const data = JSON.parse(body);
      if (data.action) {
        const change = z.object({ id: z.string().uuid(), action: z.enum(['pause', 'resume', 'delete']) }).parse(data);
        schedules.update(currentConfig.workspaceDir, change.id, change.action);
      } else {
        const input = z.object({ name: z.string().trim().min(1).max(100), prompt: z.string().trim().min(1).max(20000), intervalMinutes: z.number().int().min(15).max(43200) }).parse(data);
        schedules.create({ ...input, workspace: currentConfig.workspaceDir });
      }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ schedules: schedules.list(currentConfig.workspaceDir) }));
    } catch (err: any) { res.writeHead(400); res.end(JSON.stringify({ error: err.message })); }
    return;
  }

  if ((url.pathname === '/api/providers/models' || url.pathname === '/api/provider/models') && req.method === 'GET') {
    try {
      const providerId = url.searchParams.get('providerId') || currentConfig.activeProviderId;
      const target = currentConfig.providers.find(provider => provider.id === providerId);
      if (!target) throw new Error(`Provider "${providerId}" not found`);
      const discovered = await discoverProviderModels(target, url.searchParams.get('refresh') === 'true');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        providerId: target.id,
        providerName: target.name,
        models: discovered.models.map(model => model.id),
        modelDetails: discovered.models,
        cached: discovered.cached,
        fetchedAt: discovered.fetchedAt,
      }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Unable to discover provider models' }));
    }
    return;
  }

  if (url.pathname === '/api/provider/test' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 64000) req.destroy(new Error('Provider test request is too large'));
    });
    req.on('end', async () => {
      try {
        let testBaseURL = currentConfig.baseURL;
        let testApiKey = currentConfig.apiKey;
        let testModel = currentConfig.model;
        if (body) {
          try {
            const parsed = JSON.parse(body);
            if (parsed.baseURL) testBaseURL = parsed.baseURL.trim();
            if (parsed.apiKey !== undefined && parsed.apiKey !== '') testApiKey = parsed.apiKey.trim();
            if (parsed.model) testModel = parsed.model.trim();
          } catch {}
        }
        const baseURL = testBaseURL.replace(/\/+$/, '');
        const headers = testApiKey ? { Authorization: `Bearer ${testApiKey}` } : undefined;
        const response = await fetch(`${baseURL}/models`, {
          headers,
          signal: AbortSignal.timeout(15000),
          redirect: 'error'
        });
        let modelIds: string[] = [];
        let discoveryMessage = 'Model discovery succeeded.';
        if (response.ok) {
          modelIds = normalizeProviderModels(await response.json() as unknown).map(model => model.id);
        } else if (response.status === 404 || response.status === 405) {
          // Some OpenAI-compatible gateways omit /models. A tiny chat request still
          // verifies that the endpoint and credentials can actually serve a model.
          const chatResponse = await fetch(`${baseURL}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(headers || {}) },
            body: JSON.stringify({ model: testModel, messages: [{ role: 'user', content: 'Respond with OK.' }], max_tokens: 4, stream: false }),
            signal: AbortSignal.timeout(15000),
            redirect: 'error',
          });
          if (!chatResponse.ok) throw new Error(`Provider returned HTTP ${chatResponse.status}. Check the URL, API key, and model.`);
          discoveryMessage = 'Connected successfully. This provider does not expose model discovery; the configured model responded.';
        } else {
          throw new Error(`Provider returned HTTP ${response.status}. Check the URL and API key.`);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          models: modelIds,
          message: response.ok
            ? `Connected successfully (${modelIds.length} models found). ${discoveryMessage}`
            : discoveryMessage,
        }));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (url.pathname === '/api/providers/switch' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = z.object({
          providerId: z.string().trim().min(1).max(120),
          model: z.string().trim().min(1).max(240).optional(),
        }).parse(JSON.parse(body));
        if (activeWorkspaces.has(currentConfig.workspaceDir)) throw new Error('Stop the active task before changing the model');
        const { providerId, model } = data;
        const nextConfig = cloneConfig();
        const target = nextConfig.providers.find(p => p.id === providerId);
        if (!target) throw new Error(`Provider "${providerId}" not found`);
        if (model) target.model = model;
        nextConfig.activeProviderId = target.id;
        nextConfig.baseURL = target.baseURL;
        nextConfig.apiKey = target.apiKey;
        nextConfig.model = target.model;
        persistConfig(nextConfig);
        currentConfig = nextConfig;
        invalidateProviderModels();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, config: getPublicConfig(currentConfig) }));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (url.pathname === '/api/providers/save' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { id, name, baseURL, apiKey, model, setActive } = data;
        if (!name || !baseURL) throw new Error('Name and Base URL are required');
        const trimmedUrl = baseURL.trim().replace(/\/+$/, '');
        const parsedURL = new URL(trimmedUrl);
        if (!['http:', 'https:'].includes(parsedURL.protocol)) throw new Error('Use an HTTP or HTTPS API URL');

        const nextConfig = cloneConfig();
        const existingIdx = nextConfig.providers.findIndex(p => p.id === id);
        const providerId = id || `custom_${Date.now()}`;
        const existing = existingIdx >= 0 ? nextConfig.providers[existingIdx] : null;

        const nextApiKey = apiKey !== undefined && apiKey !== '' ? apiKey.trim() : (existing?.apiKey || '');
        const nextModel = (model || existing?.model || 'auto/best-coding').trim();

        const updatedProfile: ProviderProfile = {
          id: providerId,
          name: name.trim(),
          baseURL: trimmedUrl,
          apiKey: nextApiKey,
          model: nextModel,
          isPreset: existing?.isPreset || false,
        };

        if (existingIdx >= 0) {
          nextConfig.providers[existingIdx] = updatedProfile;
        } else {
          nextConfig.providers.push(updatedProfile);
        }

        if (setActive || nextConfig.activeProviderId === providerId) {
          nextConfig.activeProviderId = providerId;
          nextConfig.baseURL = updatedProfile.baseURL;
          nextConfig.apiKey = updatedProfile.apiKey;
          nextConfig.model = updatedProfile.model;
        }

        persistConfig(nextConfig);
        currentConfig = nextConfig;
        invalidateProviderModels(providerId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, config: getPublicConfig(currentConfig) }));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (url.pathname === '/api/providers/delete' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { providerId } = data;
        const nextConfig = cloneConfig();
        const target = nextConfig.providers.find(p => p.id === providerId);
        if (target?.isPreset) throw new Error('Cannot delete built-in provider presets');
        nextConfig.providers = nextConfig.providers.filter(p => p.id !== providerId);
        if (nextConfig.activeProviderId === providerId) {
          const fallback = nextConfig.providers[0];
          if (!fallback) throw new Error('At least one provider must remain');
          nextConfig.activeProviderId = fallback.id;
          nextConfig.baseURL = fallback.baseURL;
          nextConfig.apiKey = fallback.apiKey;
          nextConfig.model = fallback.model;
        }
        persistConfig(nextConfig);
        currentConfig = nextConfig;
        invalidateProviderModels(providerId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, config: getPublicConfig(currentConfig) }));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (url.pathname === '/api/config') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getPublicConfig(currentConfig)));
    } else if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (activeWorkspaces.size) throw new Error('Stop running tasks before changing settings or workspace');
          const nextConfig = cloneConfig();
          if (data.apiKey !== undefined) {
            if (typeof data.apiKey !== 'string') throw new Error('API key must be text');
            const nextApiKey = data.apiKey.trim();
            if (nextApiKey || data.clearApiKey === true) {
              nextConfig.apiKey = nextApiKey;
            }
          }
          if (data.baseURL !== undefined) {
            if (typeof data.baseURL !== 'string' || !data.baseURL.trim()) {
              throw new Error('Base URL must be a non-empty URL');
            }
            const parsedURL = new URL(data.baseURL.trim());
            if (!['http:', 'https:'].includes(parsedURL.protocol)) throw new Error('Use an HTTP or HTTPS API URL');
            nextConfig.baseURL = data.baseURL.trim().replace(/\/+$/, '');
          }
          if (data.model !== undefined) {
            if (typeof data.model !== 'string' || !data.model.trim()) {
              throw new Error('Model must be a non-empty identifier');
            }
            nextConfig.model = data.model.trim();
          }
          if (data.workspaceDir !== undefined) {
            if (typeof data.workspaceDir !== 'string' || !data.workspaceDir.trim()) {
              throw new Error('Workspace directory must be a non-empty path');
            }
            const requestedWorkspace = path.resolve(data.workspaceDir);
            if (!fs.existsSync(requestedWorkspace) || !fs.statSync(requestedWorkspace).isDirectory()) {
              throw new Error(`Workspace directory does not exist: ${data.workspaceDir}`);
            }
            nextConfig.workspaceDir = requestedWorkspace;
            const existingRecent = (nextConfig.recentWorkspaces || []).filter(w => w !== requestedWorkspace);
            nextConfig.recentWorkspaces = [requestedWorkspace, ...existingRecent].slice(0, 20);
          }

          // Keep active provider in sync with direct config changes
          const activeIdx = nextConfig.providers.findIndex(p => p.id === nextConfig.activeProviderId);
          if (activeIdx >= 0) {
            nextConfig.providers[activeIdx] = {
              ...nextConfig.providers[activeIdx],
              baseURL: nextConfig.baseURL,
              apiKey: nextConfig.apiKey,
              model: nextConfig.model,
            };
          }

          persistConfig(nextConfig);
          currentConfig = nextConfig;
          invalidateProviderModels();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, config: getPublicConfig(currentConfig) }));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    }
    return;
  }

  if (url.pathname === '/api/workspace/pick-folder' && req.method === 'POST') {
    try {
      const selected = await pickFolderNative();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ path: selected }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Unable to pick folder' }));
    }
    return;
  }

  if (url.pathname === '/api/workspace/remove-recent' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (typeof data.path === 'string') {
          const nextConfig = cloneConfig();
          nextConfig.recentWorkspaces = nextConfig.recentWorkspaces.filter(w => w !== data.path);
          persistConfig(nextConfig);
          currentConfig = nextConfig;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, recentWorkspaces: currentConfig.recentWorkspaces }));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (url.pathname === '/api/files/create' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const relPath = (data.path || '').trim();
        if (!relPath) throw new Error('Path is required');
        const full = path.isAbsolute(relPath) ? path.resolve(relPath) : path.resolve(currentConfig.workspaceDir, relPath);
        if (!isPathInsideWorkspace(full, currentConfig.workspaceDir)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Cannot create files outside active workspace' }));
          return;
        }
        if (data.isDirectory) {
          fs.mkdirSync(full, { recursive: true });
        } else {
          const dir = path.dirname(full);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          if (!fs.existsSync(full)) fs.writeFileSync(full, '', 'utf-8');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, path: relPath }));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (url.pathname === '/api/files/reveal' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const rel = typeof data.path === 'string' ? data.path.trim() : '';
        const target = rel ? resolveWorkspacePath(currentConfig.workspaceDir, rel) : resolveWorkspacePath(currentConfig.workspaceDir, '.');
        if (fs.existsSync(target)) {
          if (process.platform === 'win32') {
            const isDir = fs.statSync(target).isDirectory();
            spawn('explorer.exe', [isDir ? target : `/select,${target}`], { detached: true });
          } else if (process.platform === 'darwin') {
            spawn('open', ['-R', target], { detached: true });
          } else {
            spawn('xdg-open', [fs.statSync(target).isDirectory() ? target : path.dirname(target)], { detached: true });
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err: any) {
        res.writeHead(err?.message?.includes('outside') ? 403 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (url.pathname === '/api/files/tree' && req.method === 'GET') {
    const rootDir = currentConfig.workspaceDir;
    const tree = getFileTree(rootDir, rootDir);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ files: tree, workspaceDir: rootDir }));
    return;
  }

  if (url.pathname === '/api/skills' && req.method === 'GET') {
    const skills = discoverSkills(currentConfig.workspaceDir).map(({ content, ...entry }) => entry);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ skills }));
    return;
  }

  if (url.pathname === '/api/capabilities' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(detectCapabilities(currentConfig.workspaceDir)));
    return;
  }

  if (url.pathname === '/api/files/read' && req.method === 'GET') {
    const filePath = url.searchParams.get('path');
    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing path' }));
      return;
    }
    const full = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(currentConfig.workspaceDir, filePath);
    if (!isPathInsideWorkspace(full, currentConfig.workspaceDir)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File is outside the active workspace' }));
      return;
    }
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File not found' }));
      return;
    }
    const content = fs.readFileSync(full, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ content, path: filePath }));
    return;
  }

  if (url.pathname === '/api/files/write' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        if (typeof data.path !== 'string' || !data.path.trim()) {
          throw new Error('Missing file path');
        }
        if (typeof data.content !== 'string') {
          throw new Error('File content must be text');
        }

        const requestedPath = data.path.trim();
        const fullPath = path.isAbsolute(requestedPath)
          ? path.resolve(requestedPath)
          : path.resolve(currentConfig.workspaceDir, requestedPath);
        if (!isPathInsideWorkspace(fullPath, currentConfig.workspaceDir)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'File is outside the active workspace' }));
          return;
        }
        if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'File not found' }));
          return;
        }

        if (typeof data.originalContent === 'string' && fs.readFileSync(fullPath, 'utf8') !== data.originalContent) {
          res.writeHead(409); res.end(JSON.stringify({ error: 'File changed on disk. Reopen it and review the changes before saving.' })); return;
        }
        await writeFileTool.execute(
          { path: requestedPath, content: data.content },
          {
            cwd: currentConfig.workspaceDir,
            sessionId: 'editor',
            env: {},
            emitEvent: () => undefined,
          },
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, path: requestedPath }));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Unable to save file' }));
      }
    });
    return;
  }

  if (url.pathname === '/api/terminal' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        if (typeof data.command !== 'string' || !data.command.trim()) {
          throw new Error('Command must be a non-empty string');
        }
        const timeout = Number(data.timeout_s ?? 60);
        if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 300) {
          throw new Error('Timeout must be between 1 and 300 seconds');
        }

        const requestedWorkdir = typeof data.workdir === 'string' && data.workdir.trim()
          ? data.workdir.trim()
          : currentConfig.workspaceDir;
        const workdir = path.isAbsolute(requestedWorkdir)
          ? path.resolve(requestedWorkdir)
          : path.resolve(currentConfig.workspaceDir, requestedWorkdir);
        if (!isPathInsideWorkspace(workdir, currentConfig.workspaceDir)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Command directory is outside the active workspace' }));
          return;
        }
        if (!fs.existsSync(workdir) || !fs.statSync(workdir).isDirectory()) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Command directory not found' }));
          return;
        }

        const result = await terminalTool.execute(
          { command: data.command.trim(), timeout_s: timeout, workdir },
          {
            cwd: currentConfig.workspaceDir,
            sessionId: 'terminal-ui',
            env: {},
            emitEvent: () => undefined,
          },
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: result.exitCode === 0, ...result }));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Unable to execute command' }));
      }
    });
    return;
  }

  // Auto-Update Engine Endpoint
  if (url.pathname === '/api/update/check' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      upToDate: null,
      version: '1.0.0',
      preinstalledSkillsCount: 5,
      lastChecked: new Date().toISOString(),
      status: 'Automatic updates are not configured for this Tauri build. Check GitHub Releases manually.'
    }));
    return;
  }
  if (url.pathname === '/api/sessions/search' && req.method === 'GET') {
    try {
      const workspace = activeWorkspace(url.searchParams.get('workspace') || undefined);
      const query = url.searchParams.get('q') || '';
      const includeArchived = url.searchParams.get('includeArchived') !== 'false';
      const matches = sessions.search(workspace, query).filter(session => includeArchived || !session.archived);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        workspaceDir: workspace,
        sessions: matches.map(({ messages, ...summary }) => ({ ...summary, messageCount: messages.length })),
      }));
    } catch (err: any) { res.writeHead(400); res.end(JSON.stringify({ error: err.message })); }
    return;
  }
  if (url.pathname === '/api/goals' && req.method === 'POST') {
    try {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 64000) throw new Error('Goal request is too large'); }
      const goalStepSchema = z.object({
        id: z.string().trim().min(1).max(80),
        title: z.string().trim().min(1).max(240),
        status: z.enum(['pending', 'in_progress', 'completed', 'blocked']),
      });
      const goalSchema = z.object({
        id: z.string().trim().min(1).max(120).optional(),
        title: z.string().trim().min(1).max(240),
        description: z.string().max(2000).optional(),
        status: z.enum(['active', 'completed', 'paused', 'blocked']),
        progress: z.number().int().min(0).max(100),
        steps: z.array(goalStepSchema).max(30).default([]),
        createdAt: z.number().finite().positive().optional(),
        updatedAt: z.number().finite().positive().optional(),
      });
      const data = z.object({ sessionId: z.string().trim().min(1).max(120), goal: goalSchema.nullable() }).parse(JSON.parse(body));
      const session = sessions.get(currentConfig.workspaceDir, data.sessionId);
      const goal: Goal | undefined = data.goal === null ? undefined : {
        id: data.goal.id || `goal_${Date.now()}`,
        title: data.goal.title,
        description: data.goal.description || '',
        status: data.goal.status,
        progress: data.goal.progress,
        steps: data.goal.steps,
        createdAt: data.goal.createdAt || session.goal?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
      const saved = sessions.update(currentConfig.workspaceDir, session.id, { goal });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, goal: saved.goal }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Unable to save goal' }));
    }
    return;
  }
  if (url.pathname === '/api/sessions/action' && req.method === 'POST') {
    try {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 64000) throw new Error('Session request is too large'); }
      const data = z.object({
        id: z.string().trim().min(1).max(120),
        action: z.enum(['rename', 'pin', 'unpin', 'archive', 'restore', 'set_model', 'set_swarm']),
        title: z.string().trim().min(1).max(120).optional(),
        model: z.string().trim().min(1).max(240).optional(),
        swarm: z.boolean().optional(),
      }).parse(JSON.parse(body));
      if (data.action === 'set_model' && !data.model) throw new Error('Model is required');
      if (data.action === 'set_swarm' && data.swarm === undefined) throw new Error('Swarm state is required');
      const patch = data.action === 'rename'
        ? { title: data.title || '' }
        : data.action === 'pin'
          ? { pinned: true }
          : data.action === 'unpin'
            ? { pinned: false }
            : data.action === 'archive'
              ? { archived: true }
              : data.action === 'restore'
              ? { archived: false }
              : data.action === 'set_model'
                ? { model: data.model! }
                : { swarm: data.swarm! };
      const session = sessions.update(currentConfig.workspaceDir, data.id, patch);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, session: (({ messages, ...summary }) => summary)(session) }));
    } catch (err: any) { res.writeHead(400); res.end(JSON.stringify({ error: err.message })); }
    return;
  }
  if (url.pathname === '/api/sessions' && req.method === 'GET') {
    try {
      const workspace = activeWorkspace(url.searchParams.get('workspace') || undefined);
      const session = sessions.get(workspace, url.searchParams.get('id') || undefined);
      const includeArchived = url.searchParams.get('includeArchived') !== 'false';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        workspaceDir: workspace,
        sessionId: session.id,
        messages: session.messages,
        plan: session.plan || [],
        goal: session.goal,
        sessions: sessions.list(workspace, { includeArchived }).map(({ messages, ...summary }) => ({ ...summary, messageCount: messages.length })),
      }));
    } catch (err: any) { res.writeHead(400); res.end(JSON.stringify({ error: err.message })); }
    return;
  }
  if (url.pathname === '/api/sessions' && req.method === 'POST') {
    if (activeWorkspaces.has(currentConfig.workspaceDir)) { res.writeHead(409); res.end(JSON.stringify({ error: 'Stop the active task before creating a chat' })); return; }
    try {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 16000) throw new Error('Session request is too large'); }
      const data: { title?: string; mode?: AgentMode } = body
        ? z.object({ title: z.string().trim().min(1).max(120).optional(), mode: z.enum(['ask', 'plan', 'code', 'auto']).optional() }).parse(JSON.parse(body))
        : {};
      const session = sessions.create(currentConfig.workspaceDir);
      if (data.title || data.mode) sessions.update(currentConfig.workspaceDir, session.id, { title: data.title, mode: data.mode });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessionId: session.id }));
    } catch (err: any) { res.writeHead(400); res.end(JSON.stringify({ error: err.message })); }
    return;
  }
  if (url.pathname === '/api/rollback' && req.method === 'POST') {
    try {
      if (activeWorkspaces.size) throw new Error('Stop active tasks before rollback');
      const tx = getTxManager(currentConfig.workspaceDir);
      const rollbackResult = await tx.rollbackLatest();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rollbackResult));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: err.message }));
    }
    return;
  }

  if (url.pathname.startsWith('/api/')) { res.writeHead(404); res.end(JSON.stringify({ error: 'API route not found' })); return; }

  // Serve static UI assets from dist folder
  let distDir = path.join(__dirname, '../dist');
  if (!fs.existsSync(distDir)) {
    distDir = path.join(process.cwd(), 'dist');
  }
  if (!fs.existsSync(distDir) && process.env.ALISA_RESOURCES_DIR) {
    distDir = path.join(process.env.ALISA_RESOURCES_DIR, 'dist');
  }

  let reqPath = url.pathname === '/' ? '/index.html' : url.pathname;
  try { reqPath = decodeURIComponent(reqPath); } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Malformed URL path' }));
    return;
  }
  const distRoot = path.resolve(distDir);
  const requestedFile = path.resolve(distRoot, `.${reqPath}`);
  const relativeFile = path.relative(distRoot, requestedFile);
  const insideDist = relativeFile !== '..' && !relativeFile.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeFile);
  let filePath = insideDist ? requestedFile : path.join(distRoot, 'index.html');

  // If path doesn't exist directly, fallback to index.html for SPA routing
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(distRoot, 'index.html');
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.woff2': 'font/woff2',
      '.woff': 'font/woff',
      '.ttf': 'font/ttf',
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

function getFileTree(dir: string, base: string, depth = 0): any[] {
  if (depth > 4) return [];
  const IGNORED = new Set([
    'node_modules',
    '.git',
    'dist',
    'release',
    'build',
    '.next',
    '.cache',
    '.ichigo-sessions',
    '.alisa-sessions',
    '.ichigo-snapshots',
    'config.json',
    '.ichigo-config.json',
    'work.md',
  ]);
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries
      .filter(e => !IGNORED.has(e.name) && (!e.name.startsWith('.') || e.name === '.env.example'))
      .map(e => {
        const full = path.join(dir, e.name);
        const rel = path.relative(base, full);
        if (e.isDirectory()) {
          return {
            name: e.name,
            path: rel,
            type: 'directory',
            children: getFileTree(full, base, depth + 1),
          };
        }
        return {
          name: e.name,
          path: rel,
          type: 'file',
          size: fs.statSync(full).size,
        };
      });
  } catch {
    return [];
  }
}

function isPathInsideWorkspace(filePath: string, workspaceDir: string): boolean {
  try { resolveWorkspacePath(workspaceDir, filePath); return true; } catch { return false; }
}

function activeWorkspace(requested?: string): string {
  if (!requested) return currentConfig.workspaceDir;
  const active = path.resolve(currentConfig.workspaceDir);
  const candidate = path.resolve(requested);
  if (candidate === active) return currentConfig.workspaceDir;
  try {
    if (fs.realpathSync(candidate) === fs.realpathSync(active)) return currentConfig.workspaceDir;
  } catch { /* Report an invalid or non-active workspace below. */ }
  throw new Error('Session workspace must match the active project');
}

// WebSocket Server
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 * 1024, verifyClient: ({ origin, req }: { origin: string; req: http.IncomingMessage }) => (!origin || trustedOrigins.has(origin)) && trustedHost(req.headers.host) });

wss.on('error', (err: any) => {
  if (err?.code === 'EADDRINUSE' || err?.message?.includes('in use')) {
    // Port in use will be handled by server.on('error')
    return;
  }
  console.error('WebSocket server error:', err);
});

wss.on('connection', (ws: WebSocket) => {
  let agent: Agent | undefined;
  let swarmRunner: SwarmRunner | undefined;
  let activeAgents: Agent[] = [];
  let running = false;
  const approvals = new Map<string, (approved: boolean) => void>();
  const terminalSessions = new TerminalSessionManager();
  const broadcast = (event: AgentEvent | SessionSavedEvent | TaskStateEvent | TerminalServerEvent) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
  };
  ws.on('message', async (data) => {
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
      if (msg.type === 'approval_response') { approvals.get(msg.resolveId)?.(msg.approved === true); return; }
      if (msg.type === 'abort_task') { swarmRunner?.abort(); agent?.abort(); for (const worker of activeAgents) worker.abort(); return; }
      if (msg.type === 'terminal_start') {
        let target: TerminalTarget;
        if (msg.target === 'ssh') {
          const host = typeof msg.host === 'string' ? msg.host.trim() : '';
          const username = typeof msg.username === 'string' ? msg.username.trim() : '';
          const rawIdentityFile = typeof msg.identityFile === 'string' ? msg.identityFile.trim() : '';
          const userHome = process.env.USERPROFILE || process.env.HOME || process.cwd();
          const identityFile = rawIdentityFile
            ? rawIdentityFile.startsWith('~/') ? path.join(userHome, rawIdentityFile.slice(2)) : path.resolve(rawIdentityFile)
            : undefined;
          const remoteCwd = typeof msg.remoteCwd === 'string' && msg.remoteCwd.trim() ? msg.remoteCwd.trim() : undefined;
          target = { kind: 'ssh', host, username, port: Number(msg.port ?? 22), identityFile, remoteCwd };
        } else {
          const requestedWorkdir = typeof msg.workdir === 'string' && msg.workdir.trim() ? msg.workdir.trim() : currentConfig.workspaceDir;
          const candidate = path.isAbsolute(requestedWorkdir)
            ? path.resolve(requestedWorkdir)
            : path.resolve(currentConfig.workspaceDir, requestedWorkdir);
          if (!isPathInsideWorkspace(candidate, currentConfig.workspaceDir)) throw new Error('Local terminal directory must stay inside the active workspace');
          const workdir = resolveWorkspacePath(currentConfig.workspaceDir, candidate);
          if (!fs.existsSync(workdir) || !fs.statSync(workdir).isDirectory()) throw new Error('Local terminal directory was not found');
          target = { kind: 'local', cwd: workdir };
        }
        const info = terminalSessions.start(target, {
          onOutput: (sessionId, output, stream) => broadcast({ type: 'terminal_output', sessionId, data: output, stream }),
          onExit: (sessionId, code, signal, reason) => broadcast({ type: 'terminal_exit', sessionId, code, signal, reason }),
          onError: (sessionId, error) => broadcast({ type: 'terminal_error', sessionId, message: error.message }),
        });
        broadcast({ type: 'terminal_started', ...info });
        return;
      }
      if (msg.type === 'terminal_input') {
        if (typeof msg.sessionId !== 'string' || typeof msg.data !== 'string') throw new Error('Terminal session and input are required');
        terminalSessions.write(msg.sessionId, msg.data);
        return;
      }
      if (msg.type === 'terminal_stop') {
        if (typeof msg.sessionId !== 'string') throw new Error('Terminal session is required');
        terminalSessions.stop(msg.sessionId);
        return;
      }
      if (msg.type !== 'start_task') return;
      if (running || activeWorkspaces.has(currentConfig.workspaceDir)) throw new Error('A task is already running in this workspace');
      if (typeof msg.prompt !== 'string' || !msg.prompt.trim()) throw new Error('Prompt is required');
      const workspace = currentConfig.workspaceDir;
      const session = sessions.get(workspace, msg.sessionId);
      const supportedModes = new Set<AgentMode>(['ask', 'plan', 'code', 'auto']);
      const mode: AgentMode = supportedModes.has(msg.mode) ? msg.mode : (session.mode || 'code');
      const useSwarm = msg.swarm === true;
      const requestedModel = typeof msg.model === 'string' && msg.model.trim()
        ? msg.model.trim()
        : currentConfig.model;
      if (!requestedModel || requestedModel.length > 240) throw new Error('Model must be a non-empty identifier');
      const contextWindow = contextWindowForModel(currentConfig.activeProviderId, requestedModel);
      running = true;
      agent = undefined;
      swarmRunner = undefined;
      activeAgents = [];
      activeWorkspaces.add(workspace);
      session.mode = mode;
      session.model = requestedModel;
      session.swarm = useSwarm;
      sessions.save(session);
      const startedAt = Date.now();
      activeTaskStates.set(workspace, { type: 'task_state', sessionId: session.id, status: 'thinking', detail: useSwarm ? 'Starting agent swarm' : 'Starting task', model: requestedModel, mode, startedAt, swarm: useSwarm, contextWindow });
      const requestApproval = (action: string, details: Record<string, unknown>, signal: AbortSignal) => new Promise<boolean>(resolve => {
        const resolveId = crypto.randomUUID();
        const finish = (approved: boolean) => { approvals.delete(resolveId); signal.removeEventListener('abort', cancel); clearTimeout(timer); resolve(approved); };
        const cancel = () => finish(false);
        const timer = setTimeout(cancel, 5 * 60 * 1000);
        approvals.set(resolveId, finish);
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) { cancel(); return; }
        broadcast({ type: 'approval_requested', action, details, resolveId });
      });
      const handleAgentEvent = (event: AgentEvent) => {
        if (event.type === 'status_change') {
          const task = activeTaskStates.get(workspace);
          if (task) {
            const overallStatus = useSwarm && (event.status === 'done' || event.status === 'idle') ? 'acting' : event.status;
            const prefix = event.agentRole ? `${event.agentRole}: ` : '';
            activeTaskStates.set(workspace, { ...task, status: overallStatus, detail: prefix + (event.detail || event.status) });
          }
        }
        if (event.type === 'message_added') {
          const internalSwarmPrompt = useSwarm && Boolean(event.agentRole) && event.message.role === 'user';
          if (!internalSwarmPrompt) {
            session.messages.push(event.message);
            sessions.save(session);
          } else {
            return;
          }
        }
        if (event.type === 'plan_update') {
          session.plan = event.items;
          sessions.save(session);
        }
        if (event.type === 'goal_update') {
          session.goal = event.goal;
          sessions.save(session);
        }
        broadcast(event);
      };
      try {
        const skillNames = Array.isArray(msg.skills) ? msg.skills.filter((s: unknown) => typeof s === 'string') : [];
        if (useSwarm) {
          const userMessage = {
            id: `msg_user_${Date.now()}`,
            role: 'user' as const,
            content: msg.prompt.trim(),
            timestamp: Date.now(),
          };
          session.messages.push(userMessage);
          sessions.save(session);
          broadcast({ type: 'message_added', message: userMessage });
          swarmRunner = new SwarmRunner({
            cwd: workspace,
            sessionId: session.id,
            prompt: msg.prompt.trim(),
            history: [...session.messages],
            skillNames,
            llmConfig: { ...currentConfig, model: requestedModel },
            contextWindow,
            goal: session.goal,
            requestApproval,
            onEvent: handleAgentEvent,
            onGoalUpdate: goal => { session.goal = goal; sessions.save(session); },
            onAgentCreated: worker => activeAgents.push(worker),
          });
          const result = await swarmRunner.run();
          activeTaskStates.set(workspace, { ...activeTaskStates.get(workspace)!, status: result.status, detail: result.detail });
        } else {
          agent = new Agent({
            cwd: workspace,
            sessionId: session.id,
            mode,
            goal: session.goal,
            contextWindow,
            requestApproval,
            llm: new LLMClient({ ...currentConfig, model: requestedModel }),
            onEvent: handleAgentEvent,
          });
          activeAgents.push(agent);
          await agent.runTask(msg.prompt.trim(), [...session.messages], skillNames);
        }
      } finally {
        const finalStatus = swarmRunner?.getAgents().some(worker => worker.status === 'error')
          ? 'error'
          : swarmRunner
            ? (activeTaskStates.get(workspace)?.status || 'done')
            : (agent?.getStatus() || 'error');
        const finalDetail = swarmRunner
          ? (activeTaskStates.get(workspace)?.detail || (finalStatus === 'done' ? 'Completed' : 'Agent swarm stopped'))
          : finalStatus === 'done' ? 'Completed' : finalStatus === 'idle' ? 'Cancelled' : activeTaskStates.get(workspace)?.detail;
        const durationMs = Math.max(0, Date.now() - startedAt);
        const completedAt = Date.now();
        const lastRun: SavedRun = { status: finalStatus, detail: finalDetail, durationMs, completedAt };
        session.lastRun = lastRun;
        sessions.save(session);
        const completedSwarm = Boolean(swarmRunner);
        const completedAgents = swarmRunner?.getAgents();
        running = false;
        activeWorkspaces.delete(workspace);
        activeTaskStates.delete(workspace);
        swarmRunner = undefined;
        activeAgents = [];
        broadcast({ type: 'session_saved', sessionId: session.id, status: finalStatus, detail: finalDetail, durationMs, completedAt, swarm: completedSwarm, agents: completedAgents });
      }
    } catch (err: any) {
      const wasRunning = running;
      if (running) {
        running = false;
        activeWorkspaces.delete(currentConfig.workspaceDir);
        activeTaskStates.delete(currentConfig.workspaceDir);
      }
      if (typeof msg?.type === 'string' && msg.type.startsWith('terminal_')) {
        broadcast({ type: 'terminal_error', sessionId: typeof msg.sessionId === 'string' ? msg.sessionId : '', message: err.message || 'Terminal request failed' });
      } else {
        broadcast({ type: 'error', message: err.message || 'Task failed' });
      }
      if (wasRunning) broadcast({ type: 'status_change', status: agent?.getStatus() || 'error', detail: err.message });
    }
  });
  ws.on('close', () => { terminalSessions.disposeAll(); swarmRunner?.abort(); agent?.abort(); for (const worker of activeAgents) worker.abort(); });
  const activeTask = activeTaskStates.get(currentConfig.workspaceDir);
  if (activeTask) broadcast(activeTask);
  else broadcast({ type: 'status_change', status: 'idle', detail: 'Backend connected' });
});

server.on('error', (err: any) => {
  if (err?.code === 'EADDRINUSE' || err?.message?.includes('in use') || err?.message?.includes('EADDRINUSE')) {
    console.warn(`[WARN] Port ${PORT} is already in use. Project Alisa Studio backend may already be running.`);
    process.exit(1);
  } else {
    console.error('[ERROR] Server error:', err);
    process.exit(1);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[Alisa Studio] Backend running on http://127.0.0.1:${PORT}`);
  console.log(`[Workspace] Active: ${currentConfig.workspaceDir}`);
});
