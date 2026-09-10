import { resolveWorkspacePath } from '../core/workspace';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import type { ToolDefinition } from '../core/types.ts';

export const SearchFilesInputSchema = z.object({
  query: z.string().describe('Search query or regex pattern'),
  path: z.string().optional().default('.').describe('Directory to search in'),
  file_glob: z.string().optional().describe('Filter files by extension (e.g. *.ts, *.json)'),
  max_results: z.number().optional().default(50).describe('Maximum matches to return'),
});

export const searchFilesTool: ToolDefinition<z.input<typeof SearchFilesInputSchema>, { matches: Array<{ file: string; line: number; text: string }> }> = {
  name: 'search_files',
  description: 'Search for text or regex patterns across files in the workspace.',
  parameters: SearchFilesInputSchema,
  execute: async (args, context) => {
    const rootDir = resolveWorkspacePath(context.cwd, args.path || '.');
    const matches: Array<{ file: string; line: number; text: string }> = [];
    const maxResults = args.max_results || 50;

    let regex: RegExp;
    try {
      regex = new RegExp(args.query, 'i');
    } catch {
      regex = new RegExp(args.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }

    const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', 'artifacts']);

    function scan(dir: string, depth = 0) {
      if (depth > 8 || matches.length >= maxResults) return;
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (matches.length >= maxResults) break;
        if (entry.name.startsWith('.') && entry.name !== '.env.example' && entry.name !== '.hermes.md') {
          if (IGNORED.has(entry.name)) continue;
        }
        if (IGNORED.has(entry.name)) continue;

        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(full, depth + 1);
        } else if (entry.isFile()) {
          // Check extension filter
          if (args.file_glob && !entry.name.endsWith(args.file_glob.replace('*', ''))) {
            continue;
          }

          try {
            const content = fs.readFileSync(full, 'utf-8');
            const lines = content.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) {
                matches.push({
                  file: path.relative(rootDir, full),
                  line: i + 1,
                  text: lines[i].trim().slice(0, 300),
                });
                if (matches.length >= maxResults) break;
              }
            }
          } catch {}
        }
      }
    }

    scan(rootDir);
    return { matches };
  }
};
