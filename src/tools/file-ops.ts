import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import type { ToolDefinition } from '../core/types.ts';
import { ASTSecurityGatekeeper } from '../core/security.ts';
import { FileTransactionManager } from '../core/snapshot.ts';

const gatekeeper = new ASTSecurityGatekeeper();
let transactionManager: FileTransactionManager | null = null;

function getTxManager(cwd: string) {
  if (!transactionManager) {
    transactionManager = new FileTransactionManager(cwd);
  }
  return transactionManager;
}

export { getTxManager };

// 1. Read File Tool
export const ReadFileInputSchema = z.object({
  path: z.string().describe('Relative or absolute file path to read'),
  offset: z.number().optional().default(1).describe('Start line number (1-indexed)'),
  limit: z.number().optional().default(2000).describe('Max lines to read'),
});

export const readFileTool: ToolDefinition<z.infer<typeof ReadFileInputSchema>, { content: string; totalLines: number }> = {
  name: 'read_file',
  description: 'Read a text file with line numbers and optional pagination.',
  parameters: ReadFileInputSchema,
  execute: async (args, context) => {
    const fullPath = path.isAbsolute(args.path) ? args.path : path.join(context.cwd, args.path);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${args.path}`);
    }
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      throw new Error(`Path is a directory, not a file: ${args.path}`);
    }

    const raw = fs.readFileSync(fullPath, 'utf-8');
    const lines = raw.split(/\r?\n/);
    const totalLines = lines.length;
    const startIdx = Math.max(0, (args.offset || 1) - 1);
    const endIdx = Math.min(totalLines, startIdx + (args.limit || 2000));
    
    const numbered = lines.slice(startIdx, endIdx).map((l, idx) => `${startIdx + idx + 1}| ${l}`).join('\n');
    return {
      content: numbered,
      totalLines,
    };
  }
};

// 2. Write File Tool
export const WriteFileInputSchema = z.object({
  path: z.string().describe('File path to create or overwrite'),
  content: z.string().describe('Complete file content to write'),
});

export const writeFileTool: ToolDefinition<z.infer<typeof WriteFileInputSchema>, { success: boolean; bytesWritten: number; path: string }> = {
  name: 'write_file',
  description: 'Write complete content to a file, automatically creating parent directories if needed.',
  parameters: WriteFileInputSchema,
  execute: async (args, context) => {
    const fullPath = path.isAbsolute(args.path) ? args.path : path.join(context.cwd, args.path);

    // 1. Audit secret leakage
    const audit = gatekeeper.auditFileWrite(args.path, args.content);
    if (!audit.allowed) {
      throw new Error(audit.reason || '🛡️ File write blocked by Security Gatekeeper');
    }

    // 2. Snapshot current state for 1-click rollback
    const tx = getTxManager(context.cwd);
    await tx.createSnapshot(fullPath);

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, args.content, 'utf-8');
    return {
      success: true,
      bytesWritten: Buffer.byteLength(args.content, 'utf-8'),
      path: args.path,
    };
  }
};

// 3. Patch File Tool (Search & Replace with fuzzy fallback)
export const PatchFileInputSchema = z.object({
  path: z.string().describe('File path to patch'),
  old_string: z.string().describe('Exact block of code to find'),
  new_string: z.string().describe('Replacement block of code'),
  replace_all: z.boolean().optional().default(false).describe('Replace all occurrences (default false)'),
});

export const patchFileTool: ToolDefinition<z.infer<typeof PatchFileInputSchema>, { success: boolean; diffSummary: string }> = {
  name: 'patch_file',
  description: 'Perform targeted find-and-replace edits on a file without rewriting the whole content.',
  parameters: PatchFileInputSchema,
  execute: async (args, context) => {
    const fullPath = path.isAbsolute(args.path) ? args.path : path.join(context.cwd, args.path);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${args.path}`);
    }

    // 1. Audit secret leakage
    const audit = gatekeeper.auditFileWrite(args.path, args.new_string);
    if (!audit.allowed) {
      throw new Error(audit.reason || '🛡️ Patch blocked by Security Gatekeeper');
    }

    // 2. Snapshot state for 1-click rollback
    const tx = getTxManager(context.cwd);
    await tx.createSnapshot(fullPath);

    const original = fs.readFileSync(fullPath, 'utf-8');

    // Normalize line endings for reliable matching
    const normalize = (s: string) => s.replace(/\r\n/g, '\n');
    const normOrig = normalize(original);
    const normOld = normalize(args.old_string);
    const normNew = normalize(args.new_string);

    if (!normOrig.includes(normOld)) {
      // Try trimmed lines fuzzy match
      const oldLines = normOld.trim().split('\n').map(l => l.trim());
      const origLines = normOrig.split('\n');
      let matchIdx = -1;

      for (let i = 0; i <= origLines.length - oldLines.length; i++) {
        let allMatch = true;
        for (let j = 0; j < oldLines.length; j++) {
          if (origLines[i + j].trim() !== oldLines[j]) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) {
          matchIdx = i;
          break;
        }
      }

      if (matchIdx === -1) {
        throw new Error(`Could not find old_string in ${args.path}. Please verify the exact lines and retry.`);
      }

      origLines.splice(matchIdx, oldLines.length, normNew);
      fs.writeFileSync(fullPath, origLines.join('\n'), 'utf-8');
      return {
        success: true,
        diffSummary: `Fuzzy matched and replaced at line ${matchIdx + 1}`,
      };
    }

    let updated: string;
    if (args.replace_all) {
      updated = normOrig.replaceAll(normOld, normNew);
    } else {
      const idx = normOrig.indexOf(normOld);
      updated = normOrig.slice(0, idx) + normNew + normOrig.slice(idx + normOld.length);
    }

    fs.writeFileSync(fullPath, updated, 'utf-8');
    return {
      success: true,
      diffSummary: `Successfully replaced target block in ${args.path}`,
    };
  }
};

// 4. List Directory Tool
export const ListDirInputSchema = z.object({
  path: z.string().optional().default('.').describe('Directory path to list'),
  recursive: z.boolean().optional().default(false).describe('List files recursively'),
  max_depth: z.number().optional().default(2).describe('Max recursion depth'),
});

export const listDirTool: ToolDefinition<z.infer<typeof ListDirInputSchema>, { entries: Array<{ name: string; isDirectory: boolean; size: number }> }> = {
  name: 'list_directory',
  description: 'List files and subdirectories in a directory with file sizes and directory flags.',
  parameters: ListDirInputSchema,
  execute: async (args, context) => {
    const fullPath = path.isAbsolute(args.path || '.') ? (args.path || '.') : path.join(context.cwd, args.path || '.');
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Directory not found: ${args.path}`);
    }

    const items = fs.readdirSync(fullPath, { withFileTypes: true });
    const entries = items.map(item => {
      let size = 0;
      try {
        if (!item.isDirectory()) {
          size = fs.statSync(path.join(fullPath, item.name)).size;
        }
      } catch {}
      return {
        name: item.name,
        isDirectory: item.isDirectory(),
        size,
      };
    });

    return { entries };
  }
};
