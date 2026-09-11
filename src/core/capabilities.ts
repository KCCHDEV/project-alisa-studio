import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export type CapabilityAvailability = 'ready' | 'manual' | 'unavailable';

export interface CapabilityStatus {
  mcp: {
    skillInstalled: true;
    availability: CapabilityAvailability;
    configuredFiles: Array<{ path: string; serverCount: number }>;
    serverCount: number;
  };
  computerUse: {
    skillInstalled: true;
    availability: CapabilityAvailability;
    inputBridges: string[];
    platform: string;
  };
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function executableNames() {
  if (process.platform === 'win32') return ['powershell.exe', 'pyautogui.exe'];
  if (process.platform === 'darwin') return ['osascript'];
  return ['wtype', 'ydotool', 'xdotool'];
}

function findExecutables(names: string[]) {
  const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const found: string[] = [];
  for (const name of names) {
    if (pathEntries.some(directory => {
      const candidate = path.join(directory, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    })) found.push(name.replace(/\.exe$/i, ''));
  }
  return found;
}

function mcpConfigCandidates(workspace: string) {
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  return unique([
    path.join(workspace, '.mcp.json'),
    path.join(workspace, '.alisa', 'mcp.json'),
    path.join(workspace, '.config', 'mcp.json'),
    path.join(home, '.mcp.json'),
    path.join(home, '.config', 'mcp', 'config.json'),
    path.join(home, '.config', 'mcp', 'servers.json'),
    path.join(home, '.config', 'claude', 'mcp.json'),
    path.join(home, '.claude.json'),
    path.join(home, '.cursor', 'mcp.json'),
    path.join(appData, 'mcp', 'config.json'),
  ]);
}

function readServerCount(file: string) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    const servers = parsed.mcpServers ?? parsed.servers;
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return 0;
    return Object.keys(servers).length;
  } catch {
    // Invalid or non-JSON config is still deliberately ignored. The app never
    // executes a server from a config file just to populate this status.
    return 0;
  }
}

/**
 * Report the bundled capability packs and safe local discovery status. This is
 * intentionally read-only: MCP processes and desktop input are never started
 * implicitly from a config file.
 */
export function detectCapabilities(workspace: string): CapabilityStatus {
  const configuredFiles = mcpConfigCandidates(path.resolve(workspace))
    .filter(file => fs.existsSync(file))
    .map(file => ({ path: file, serverCount: readServerCount(file) }));
  const serverCount = configuredFiles.reduce((total, entry) => total + entry.serverCount, 0);
  const inputBridges = findExecutables(executableNames());

  return {
    mcp: {
      skillInstalled: true,
      availability: serverCount > 0 ? 'ready' : 'manual',
      configuredFiles,
      serverCount,
    },
    computerUse: {
      skillInstalled: true,
      availability: inputBridges.length ? 'ready' : 'manual',
      inputBridges,
      platform: process.platform,
    },
  };
}
