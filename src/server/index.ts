import { discoverSkills } from '../core/skills';
import { ScheduleStore } from './schedules';
import { gitOverview, listPullRequests } from './git';
import { z } from 'zod';
import { SessionStore } from './sessions';
import { resolveWorkspacePath } from '../core/workspace';
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { Agent } from '../core/agent.ts';
import { LLMClient, type LLMConfig } from '../llm/client.ts';
import type { AgentEvent } from '../core/types.ts';
import { getTxManager, writeFileTool } from '../tools/file-ops.ts';
import { terminalTool } from '../tools/terminal.ts';

const PORT = Number(process.env.PORT || 3001);
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

const CONFIG_FILE = path.join(RUNTIME_DIR, '.alisa-config.json');
const LEGACY_CONFIG_FILE = path.join(RUNTIME_DIR, '.ichigo-config.json');
const ALISA_SESSIONS_DIR = path.join(RUNTIME_DIR, '.alisa-sessions');

if (!fs.existsSync(RUNTIME_DIR)) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
}
if (!fs.existsSync(ALISA_SESSIONS_DIR)) {
  fs.mkdirSync(ALISA_SESSIONS_DIR, { recursive: true });
}

// Helper to load Hermes OmniRoute config if available
function loadHermesConfig() {
  try {
    const userHome = process.env.USERPROFILE || process.env.HOME || process.cwd();
    const hermesCfgPath = path.join(userHome, 'AppData', 'Local', 'hermes', 'config.yaml');
    if (fs.existsSync(hermesCfgPath)) {
      const content = fs.readFileSync(hermesCfgPath, 'utf-8');
      const baseUrlMatch = content.match(/base_url:\s*([^\s\r\n]+)/);
      const apiKeyMatch = content.match(/api_key:\s*([^\s\r\n]+)/);
      const defaultModelMatch = content.match(/default:\s*([^\s\r\n]+)/);
      return {
        baseURL: baseUrlMatch ? baseUrlMatch[1] : 'http://100.84.157.69:10009/v1',
        apiKey: apiKeyMatch ? apiKeyMatch[1] : 'sk-b6e85876e760a13f-cbda91-e61a2aa3',
        model: defaultModelMatch ? defaultModelMatch[1] : 'auto/best-coding'
      };
    }
  } catch (err) {
    console.error('Failed reading hermes config fallback:', err);
  }
  return null;
}

const hermesFallback = loadHermesConfig();

const DEFAULT_PROVIDERS: ProviderProfile[] = [
  {
    id: 'omniroute',
    name: 'OmniRoute',
    baseURL: hermesFallback?.baseURL || 'http://100.84.157.69:10009/v1',
    apiKey: hermesFallback?.apiKey || 'sk-b6e85876e760a13f-cbda91-e61a2aa3',
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

const configFileToRead = fs.existsSync(CONFIG_FILE) ? CONFIG_FILE : (fs.existsSync(LEGACY_CONFIG_FILE) ? LEGACY_CONFIG_FILE : null);
if (configFileToRead) {
  try {
    const saved = JSON.parse(fs.readFileSync(configFileToRead, 'utf-8'));
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
  } catch {}
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
  if (url.pathname === '/api/provider/test' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        let testBaseURL = currentConfig.baseURL;
        let testApiKey = currentConfig.apiKey;
        if (body) {
          try {
            const parsed = JSON.parse(body);
            if (parsed.baseURL) testBaseURL = parsed.baseURL.trim();
            if (parsed.apiKey !== undefined && parsed.apiKey !== '') testApiKey = parsed.apiKey.trim();
          } catch {}
        }
        const response = await fetch(`${testBaseURL.replace(/\/+$/, '')}/models`, {
          headers: testApiKey ? { Authorization: `Bearer ${testApiKey}` } : undefined,
          signal: AbortSignal.timeout(15000),
          redirect: 'error'
        });
        if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}. Check the URL and API key.`);
        const data = await response.json() as { data?: Array<{ id: string }> };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          models: (data.data || []).filter(m => typeof m.id === 'string').map(m => m.id),
          message: `Connected successfully (${data.data?.length || 0} models found). Model discovery succeeded.`
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
        const { providerId } = JSON.parse(body);
        const target = currentConfig.providers.find(p => p.id === providerId);
        if (!target) throw new Error(`Provider "${providerId}" not found`);
        currentConfig.activeProviderId = target.id;
        currentConfig.baseURL = target.baseURL;
        currentConfig.apiKey = target.apiKey;
        currentConfig.model = target.model;
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2), 'utf-8');
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

        const existingIdx = currentConfig.providers.findIndex(p => p.id === id);
        const providerId = id || `custom_${Date.now()}`;
        const existing = existingIdx >= 0 ? currentConfig.providers[existingIdx] : null;

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
          currentConfig.providers[existingIdx] = updatedProfile;
        } else {
          currentConfig.providers.push(updatedProfile);
        }

        if (setActive || currentConfig.activeProviderId === providerId) {
          currentConfig.activeProviderId = providerId;
          currentConfig.baseURL = updatedProfile.baseURL;
          currentConfig.apiKey = updatedProfile.apiKey;
          currentConfig.model = updatedProfile.model;
        }

        fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2), 'utf-8');
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
        const target = currentConfig.providers.find(p => p.id === providerId);
        if (target?.isPreset) throw new Error('Cannot delete built-in provider presets');
        currentConfig.providers = currentConfig.providers.filter(p => p.id !== providerId);
        if (currentConfig.activeProviderId === providerId) {
          const fallback = currentConfig.providers[0];
          currentConfig.activeProviderId = fallback.id;
          currentConfig.baseURL = fallback.baseURL;
          currentConfig.apiKey = fallback.apiKey;
          currentConfig.model = fallback.model;
        }
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2), 'utf-8');
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
          const nextConfig = { ...currentConfig };
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

          fs.writeFileSync(CONFIG_FILE, JSON.stringify(nextConfig, null, 2), 'utf-8');
          currentConfig = nextConfig;
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
          currentConfig.recentWorkspaces = (currentConfig.recentWorkspaces || []).filter(w => w !== data.path);
          fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2), 'utf-8');
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
        const target = rel ? path.resolve(currentConfig.workspaceDir, rel) : currentConfig.workspaceDir;
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
        res.writeHead(400, { 'Content-Type': 'application/json' });
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
  if (url.pathname === '/api/sessions' && req.method === 'GET') {
    try {
      const workspace = url.searchParams.get('workspace') || currentConfig.workspaceDir;
      const session = sessions.get(workspace, url.searchParams.get('id') || undefined);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ workspaceDir: workspace, sessionId: session.id, messages: session.messages, sessions: sessions.list(workspace).map(({ messages, ...summary }) => summary) }));
    } catch (err: any) { res.writeHead(400); res.end(JSON.stringify({ error: err.message })); }
    return;
  }
  if (url.pathname === '/api/sessions' && req.method === 'POST') {
    if (activeWorkspaces.has(currentConfig.workspaceDir)) { res.writeHead(409); res.end(JSON.stringify({ error: 'Stop the active task before creating a chat' })); return; }
    const session = sessions.create(currentConfig.workspaceDir);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sessionId: session.id }));
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
  let filePath = path.join(distDir, reqPath);

  // If path doesn't exist directly, fallback to index.html for SPA routing
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(distDir, 'index.html');
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
  let running = false;
  const approvals = new Map<string, (approved: boolean) => void>();
  const broadcast = (event: AgentEvent | { type: 'session_saved'; sessionId: string }) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
  };
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'approval_response') { approvals.get(msg.resolveId)?.(msg.approved === true); return; }
      if (msg.type === 'abort_task') { agent?.abort(); return; }
      if (msg.type !== 'start_task') return;
      if (running || activeWorkspaces.has(currentConfig.workspaceDir)) throw new Error('A task is already running in this workspace');
      if (typeof msg.prompt !== 'string' || !msg.prompt.trim()) throw new Error('Prompt is required');
      const workspace = currentConfig.workspaceDir;
      const session = sessions.get(workspace, msg.sessionId);
      running = true;
      activeWorkspaces.add(workspace);
      agent = new Agent({ cwd: workspace, mode: msg.mode === 'ask' ? 'ask' : 'code', requestApproval: (action, details, signal) => new Promise(resolve => {
        const resolveId = crypto.randomUUID();
        const finish = (approved: boolean) => { approvals.delete(resolveId); signal.removeEventListener('abort', cancel); clearTimeout(timer); resolve(approved); };
        const cancel = () => finish(false);
        const timer = setTimeout(cancel, 5 * 60 * 1000);
        approvals.set(resolveId, finish);
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) { cancel(); return; }
        broadcast({ type: 'approval_requested', action, details, resolveId });
      }), llm: new LLMClient({ ...currentConfig }), onEvent: (event) => {
        if (event.type === 'message_added') {
          session.messages.push(event.message);
          sessions.save(session);
        }
        broadcast(event);
      }});
      try {
        await agent.runTask(msg.prompt.trim(), [...session.messages], Array.isArray(msg.skills) ? msg.skills.filter((s: unknown) => typeof s === 'string') : []);
      } finally {
        running = false;
        activeWorkspaces.delete(workspace);
        broadcast({ type: 'session_saved', sessionId: session.id });
      }
    } catch (err: any) {
      broadcast({ type: 'error', message: err.message || 'Task failed' });
      if (running && agent) broadcast({ type: 'status_change', status: agent.getStatus(), detail: err.message });
    }
  });
  ws.on('close', () => agent?.abort());
  broadcast({ type: 'status_change', status: 'idle', detail: 'Backend connected' });
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
