import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { resolveWorkspacePath } from './workspace';

const builtins: Record<string, string> = {
  'openclaude-code-standards': 'Inspect before editing. Preserve existing work, use clear types, handle errors, and verify changes.',
  'systematic-debugging': 'Reproduce the issue, trace the first incorrect value to its source, apply a focused fix, then verify it.',
  'web-vulnerability-scanner': 'Check input validation, authorization, secret exposure, and unsafe browser or server boundaries.',
  'test-driven-development': 'Define a focused failing behavior first, implement the smallest correct fix, and run relevant tests.',
};

export interface SkillEntry { name: string; description: string; category: string; source: string; path: string; content: string }
export function discoverSkills(workspace: string): SkillEntry[] {
  const entries = new Map<string, SkillEntry>(Object.entries(builtins).map(([name, content]) => [name, { name, description: content, category: 'built-in', source: 'built-in', path: '', content }]));
  const scan = (root: string, source: string, prefix = '') => {
    if (!fs.existsSync(root)) return;
    for (const item of fs.readdirSync(root, { withFileTypes: true })) {
      if (!item.isDirectory()) continue;
      try {
        const file = resolveWorkspacePath(root, path.join(item.name, 'SKILL.md'));
        if (!fs.existsSync(file) || fs.statSync(file).size > 128000) continue;
        const content = fs.readFileSync(file, 'utf8');
        const name = `${prefix}${item.name}`;
        entries.set(name, { name, content, path: file, source, category: 'custom', description: content.match(/description:\s*["']?([^"\n\r]+)/i)?.[1] || 'Local skill instructions' });
      } catch { /* Ignore invalid skill entries; never follow paths outside their root. */ }
    }
  };
  scan(path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'hermes', 'skills'), 'hermes-system');
  scan(path.join(workspace, '.hermes', 'skills'), 'workspace-local');
  scan(path.join(workspace, '.agents', 'skills'), 'workspace-local');
  // Local instruction-only plugins. Tool servers and arbitrary plugin code are not executed.
  const plugins = path.join(workspace, '.alisa', 'plugins');
  if (fs.existsSync(plugins)) for (const item of fs.readdirSync(plugins, { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    try {
      const root = resolveWorkspacePath(workspace, path.join('.alisa', 'plugins', item.name));
      const manifest = JSON.parse(fs.readFileSync(resolveWorkspacePath(root, '.codex-plugin/plugin.json'), 'utf8'));
      if (typeof manifest.name === 'string' && manifest.name.trim()) scan(resolveWorkspacePath(root, 'skills'), `plugin: ${manifest.name}`, `${item.name}:`);
    } catch { /* An invalid plugin cannot introduce instructions. */ }
  }
  return [...entries.values()];
}
