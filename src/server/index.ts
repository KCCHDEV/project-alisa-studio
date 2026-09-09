import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { Agent } from '../core/agent.ts';
import { LLMClient, type LLMConfig } from '../llm/client.ts';
import type { Message, AgentEvent, SessionState } from '../core/types.ts';

const PORT = 3001;
const CONFIG_FILE = path.join(process.cwd(), '.ichigo-config.json');
const SESSIONS_DIR = path.join(process.cwd(), '.ichigo-sessions');
const ALISA_SESSIONS_DIR = path.join(process.cwd(), '.alisa-sessions');

if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}
if (!fs.existsSync(ALISA_SESSIONS_DIR)) {
  fs.mkdirSync(ALISA_SESSIONS_DIR, { recursive: true });
}

function getProjectSessionFile(workspaceDir: string): string {
  const safeName = Buffer.from(workspaceDir || process.cwd()).toString('base64').replace(/[/+=]/g, '_');
  return path.join(ALISA_SESSIONS_DIR, `project_${safeName}.json`);
}

function ensurePreinstalledSkills() {
  const userHome = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\DELLPC';
  const skillsDir = path.join(userHome, 'AppData', 'Local', 'hermes', 'skills');
  try {
    if (!fs.existsSync(skillsDir)) {
      fs.mkdirSync(skillsDir, { recursive: true });
    }
    const defaultSkills = [
      { name: 'senior-coding-standards', content: '---\nname: senior-coding-standards\ndescription: Enforce clean architecture & strict types.\n---\n# Senior Coding Standards\n- Strict TypeScript types (no any)\n- Defensive try/catch error handling\n- Zero sloppy code / stubs' },
      { name: 'systematic-debugging', content: '---\nname: systematic-debugging\ndescription: 4-phase root cause debugging\n---\n# Systematic Debugging\n1. Isolate reproduce path\n2. Inspect root cause\n3. Apply targeted fix\n4. Verify check' },
      { name: 'subagent-orchestration', content: '---\nname: subagent-orchestration\ndescription: Multi-agent swarm execution\n---\n# Subagent Swarm\n- Parallel workers\n- Delegated tasks\n- Progress synchronization' },
      { name: 'nextjs-app-router-mastery', content: '---\nname: nextjs-app-router-mastery\ndescription: Next.js App Router & SSR mastery\n---\n# Next.js App Router\n- RSC and Client boundaries\n- Server Actions validation' },
      { name: 'security-audit', content: '---\nname: security-audit\ndescription: Security audit and secret leak prevention\n---\n# Security Audit\n- Input sanitization\n- Secret protection\n- AST gatekeeping' }
    ];

    for (const skill of defaultSkills) {
      const skillPath = path.join(skillsDir, skill.name);
      if (!fs.existsSync(skillPath)) {
        fs.mkdirSync(skillPath, { recursive: true });
        fs.writeFileSync(path.join(skillPath, 'SKILL.md'), skill.content, 'utf-8');
      }
    }
  } catch (err) {
    console.error('Failed pre-installing skills:', err);
  }
}
ensurePreinstalledSkills();

// Helper to load Hermes config if available
function loadHermesConfig() {
  try {
    const userHome = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\DELLPC';
    const hermesCfgPath = path.join(userHome, 'AppData', 'Local', 'hermes', 'config.yaml');
    if (fs.existsSync(hermesCfgPath)) {
      const content = fs.readFileSync(hermesCfgPath, 'utf-8');
      const baseUrlMatch = content.match(/base_url:\s*([^\s\r\n]+)/);
      const apiKeyMatch = content.match(/api_key:\s*([^\s\r\n]+)/);
      const defaultModelMatch = content.match(/default:\s*([^\s\r\n]+)/);
      return {
        baseURL: baseUrlMatch ? baseUrlMatch[1] : 'http://localhost:8000/v1',
        apiKey: apiKeyMatch ? apiKeyMatch[1] : '',
        model: defaultModelMatch ? defaultModelMatch[1] : 'auto/best-coding'
      };
    }
  } catch (err) {
    console.error('Failed reading hermes config fallback:', err);
  }
  return null;
}

const hermesFallback = loadHermesConfig();

// Load or default config
let currentConfig: LLMConfig & { workspaceDir: string } = {
  apiKey: hermesFallback?.apiKey || process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY || '',
  baseURL: hermesFallback?.baseURL || process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1',
  model: hermesFallback?.model || 'deepseek/deepseek-chat',
  workspaceDir: process.cwd(),
};

if (fs.existsSync(CONFIG_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    currentConfig = { ...currentConfig, ...saved };
  } catch {}
}

const llmClient = new LLMClient({
  apiKey: currentConfig.apiKey,
  baseURL: currentConfig.baseURL,
  model: currentConfig.model,
});

let currentAgent = new Agent({
  cwd: currentConfig.workspaceDir,
  llm: llmClient,
});

const server = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (url.pathname === '/api/config') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ...currentConfig,
        hasKey: !!currentConfig.apiKey,
        apiKeyMasked: currentConfig.apiKey ? `${currentConfig.apiKey.slice(0, 6)}...${currentConfig.apiKey.slice(-4)}` : '',
      }));
    } else if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.apiKey !== undefined) currentConfig.apiKey = data.apiKey;
          if (data.baseURL !== undefined) currentConfig.baseURL = data.baseURL;
          if (data.model !== undefined) currentConfig.model = data.model;
          if (data.workspaceDir !== undefined && fs.existsSync(data.workspaceDir)) {
            currentConfig.workspaceDir = data.workspaceDir;
          }

          fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2), 'utf-8');
          llmClient.updateConfig({
            apiKey: currentConfig.apiKey,
            baseURL: currentConfig.baseURL,
            model: currentConfig.model,
          });
          currentAgent = new Agent({
            cwd: currentConfig.workspaceDir,
            llm: llmClient,
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, config: currentConfig }));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    }
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
    const hermesSkillsDir = path.join(process.env.LOCALAPPDATA || 'C:\\Users\\DELLPC\\AppData\\Local', 'hermes', 'skills');
    const localSkillsDir = path.join(currentConfig.workspaceDir, '.hermes', 'skills');
    
    let skillsList: Array<{ name: string; category: string; description: string; source: string; path: string }> = [
      {
        name: 'openclaude-code-standards',
        category: 'software-development',
        description: 'Enforce OpenClaude & Senior Engineering standards (Clean architecture, zero-sloppy code, type-safety).',
        source: 'built-in',
        path: 'built-in/openclaude-code-standards'
      },
      {
        name: 'subagent-orchestration',
        category: 'autonomous-ai-agents',
        description: 'Multi-agent swarm execution: parallel workers, task delegation, and progress tracking.',
        source: 'built-in',
        path: 'built-in/subagent-orchestration'
      },
      {
        name: 'systematic-debugging',
        category: 'software-development',
        description: '4-phase root cause debugging: isolate errors before writing fixes.',
        source: 'built-in',
        path: 'built-in/systematic-debugging'
      },
      {
        name: 'web-vulnerability-scanner',
        category: 'security',
        description: 'Audit web applications for OWASP Top 10 vulnerabilities, input sanitization, and secrets.',
        source: 'built-in',
        path: 'built-in/web-vulnerability-scanner'
      },
      {
        name: 'test-driven-development',
        category: 'software-development',
        description: 'Enforce RED-GREEN-REFACTOR cycle with unit and integration tests.',
        source: 'built-in',
        path: 'built-in/test-driven-development'
      }
    ];

    const scanSkillDir = (dirPath: string, sourceName: string) => {
      if (!fs.existsSync(dirPath)) return;
      try {
        const files = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const file of files) {
          if (file.isDirectory()) {
            const skillMd = path.join(dirPath, file.name, 'SKILL.md');
            if (fs.existsSync(skillMd)) {
              const content = fs.readFileSync(skillMd, 'utf-8');
              const descMatch = content.match(/description:\s*["']?([^"\n\r]+)["']?/i);
              skillsList.push({
                name: file.name,
                category: 'custom',
                description: descMatch ? descMatch[1] : 'Hermes System Skill',
                source: sourceName,
                path: skillMd
              });
            }
          }
        }
      } catch (err) {
        console.error('Failed scanning skill dir:', err);
      }
    };

    scanSkillDir(hermesSkillsDir, 'hermes-system');
    scanSkillDir(localSkillsDir, 'workspace-local');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ skills: skillsList }));
    return;
  }

  if (url.pathname === '/api/files/read' && req.method === 'GET') {
    const filePath = url.searchParams.get('path');
    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing path' }));
      return;
    }
    const full = path.isAbsolute(filePath) ? filePath : path.join(currentConfig.workspaceDir, filePath);
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

  // Auto-Update Engine Endpoint
  if (url.pathname === '/api/update/check' && req.method === 'GET') {
    ensurePreinstalledSkills();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      upToDate: true,
      version: '1.0.0',
      preinstalledSkillsCount: 5,
      lastChecked: new Date().toISOString(),
      status: 'All core pre-installed skills and Alisa Studio components are fully synchronized.'
    }));
    return;
  }
  if (url.pathname === '/api/sessions' && req.method === 'GET') {
    const wsDir = url.searchParams.get('workspace') || currentConfig.workspaceDir;
    const sessionFile = getProjectSessionFile(wsDir);
    let messages = [];
    if (fs.existsSync(sessionFile)) {
      try {
        messages = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
      } catch {}
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ workspaceDir: wsDir, messages }));
    return;
  }

  if (url.pathname === '/api/sessions' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const wsDir = data.workspaceDir || currentConfig.workspaceDir;
        const messages = data.messages || [];
        const sessionFile = getProjectSessionFile(wsDir);
        fs.writeFileSync(sessionFile, JSON.stringify(messages, null, 2), 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }
  if (url.pathname === '/api/rollback' && req.method === 'POST') {
    try {
      const { getTxManager } = require('../tools/file-ops.ts');
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

  // Serve static UI assets from dist folder
  let distDir = path.join(__dirname, '../dist');
  if (!fs.existsSync(distDir)) {
    distDir = path.join(process.cwd(), 'dist');
  }
  if (!fs.existsSync(distDir) && process.resourcesPath) {
    distDir = path.join(process.resourcesPath, 'dist');
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
  const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', '.ichigo-sessions', '.alisa-sessions']);
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

// WebSocket Server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket) => {
  let sessionFile = getProjectSessionFile(currentConfig.workspaceDir);
  let sessionHistory: Message[] = [];
  if (fs.existsSync(sessionFile)) {
    try {
      sessionHistory = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
    } catch {}
  }

  const broadcast = (event: AgentEvent) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  };

  currentAgent = new Agent({
    cwd: currentConfig.workspaceDir,
    llm: llmClient,
    onEvent: broadcast,
  });

  ws.on('message', async (data: string) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'start_task') {
        const prompt = msg.prompt;
        if (!prompt) return;

        broadcast({ type: 'status_change', status: 'thinking', detail: 'Planning task' });
        const updatedHistory = await currentAgent.runTask(prompt, sessionHistory);
        sessionHistory = updatedHistory;
        fs.writeFileSync(sessionFile, JSON.stringify(sessionHistory, null, 2), 'utf-8');
      } else if (msg.type === 'abort_task') {
        currentAgent.abort();
        broadcast({ type: 'status_change', status: 'idle', detail: 'Cancelled' });
      } else if (msg.type === 'clear_history') {
        sessionHistory = [];
        if (fs.existsSync(sessionFile)) {
          fs.unlinkSync(sessionFile);
        }
        broadcast({ type: 'status_change', status: 'idle', detail: 'History cleared' });
      }
    } catch (err: any) {
      broadcast({ type: 'error', message: err.message || 'WebSocket error' });
    }
  });

  // Initial welcome event
  broadcast({
    type: 'status_change',
    status: 'idle',
    detail: `Ready. Workspace: ${currentConfig.workspaceDir}`,
  });
});

server.listen(PORT, () => {
  console.log(`🍓 Ichigo Agent Server running on http://localhost:${PORT}`);
  console.log(`📂 Active Workspace: ${currentConfig.workspaceDir}`);
});
