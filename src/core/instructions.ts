import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveWorkspacePath } from './workspace.ts';

const MAX_FILE_CHARS = 32000;
const MAX_TOTAL_CHARS = 64000;

/**
 * Load durable project guidance without following links outside the active
 * workspace. The file names mirror the conventions used by Codex-like tools.
 */
export function loadProjectInstructions(workspace: string): string {
  const candidates = ['AGENTS.md', '.agents/AGENTS.md', '.codex/AGENTS.md'];
  const sections: string[] = [];

  for (const relative of candidates) {
    if (sections.join('\n\n').length >= MAX_TOTAL_CHARS) break;
    try {
      const file = resolveWorkspacePath(workspace, relative);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
      const content = fs.readFileSync(file, 'utf8').slice(0, MAX_FILE_CHARS).trim();
      if (content) sections.push(`### ${path.basename(file)}\n${content}`);
    } catch {
      // Invalid or escaping instruction paths are ignored deliberately.
    }
  }

  return sections.join('\n\n').slice(0, MAX_TOTAL_CHARS);
}

