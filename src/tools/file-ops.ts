import { resolveWorkspacePath } from '../core/workspace';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import type { ToolDefinition } from '../core/types.ts';
import { ASTSecurityGatekeeper } from '../core/security.ts';
import { FileTransactionManager } from '../core/snapshot.ts';

const gatekeeper = new ASTSecurityGatekeeper();
const transactionManagers = new Map<string, FileTransactionManager>();

function getTxManager(cwd: string) {
  const workspace = path.resolve(cwd);
  let manager = transactionManagers.get(workspace);
  if (!manager) {
    manager = new FileTransactionManager(workspace);
    transactionManagers.set(workspace, manager);
  }
  return manager;
}

export { getTxManager };

// 1. Read File Tool
export const ReadFileInputSchema = z.object({
  path: z.string().trim().min(1).max(4096).describe('Relative or absolute file path to read'),
  offset: z.number().int().min(1).max(1_000_000).optional().default(1).describe('Start line number (1-indexed)'),
  limit: z.number().int().min(1).max(5000).optional().default(2000).describe('Max lines to read'),
});

export const readFileTool: ToolDefinition<z.input<typeof ReadFileInputSchema>, { content: string; totalLines: number }> = {
  name: 'read_file',
  description: 'Read a text file with line numbers and optional pagination.',
  parameters: ReadFileInputSchema,
  execute: async (args, context) => {
    const fullPath = resolveWorkspacePath(context.cwd, args.path);
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
  path: z.string().trim().min(1).max(4096).describe('File path to create or overwrite'),
  content: z.string().max(8_000_000).describe('Complete file content to write'),
});

export const writeFileTool: ToolDefinition<z.infer<typeof WriteFileInputSchema>, { success: boolean; bytesWritten: number; path: string }> = {
  name: 'write_file',
  description: 'Write complete content to a file, automatically creating parent directories if needed.',
  parameters: WriteFileInputSchema,
  execute: async (args, context) => {
    const fullPath = resolveWorkspacePath(context.cwd, args.path);

    // 1. Audit secret leakage
    const audit = gatekeeper.auditFileWrite(args.path, args.content);
    if (!audit.allowed) {
      throw new Error(audit.reason || '[Security Policy] File write blocked by Security Gatekeeper');
    }

    await getTxManager(context.cwd).writeFile(fullPath, args.content);
    return {
      success: true,
      bytesWritten: Buffer.byteLength(args.content, 'utf-8'),
      path: args.path,
    };
  }
};

// 3. Patch File Tool (Search & Replace with fuzzy fallback)
export const PatchFileInputSchema = z.object({
  path: z.string().trim().min(1).max(4096).describe('File path to patch'),
  old_string: z.string().min(1).max(1_000_000).describe('Exact block of code to find'),
  new_string: z.string().max(1_000_000).describe('Replacement block of code'),
  replace_all: z.boolean().optional().default(false).describe('Replace all occurrences (default false)'),
});

export const patchFileTool: ToolDefinition<z.input<typeof PatchFileInputSchema>, { success: boolean; diffSummary: string }> = {
  name: 'patch_file',
  description: 'Perform targeted find-and-replace edits on a file without rewriting the whole content.',
  parameters: PatchFileInputSchema,
  execute: async (args, context) => {
    const fullPath = resolveWorkspacePath(context.cwd, args.path);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${args.path}`);
    }

    // 1. Audit secret leakage
    const audit = gatekeeper.auditFileWrite(args.path, args.new_string);
    if (!audit.allowed) {
      throw new Error(audit.reason || '[Security Policy] Patch blocked by Security Gatekeeper');
    }

    const original = fs.readFileSync(fullPath, 'utf-8');
    const normalize = (text: string) => text.replace(/\r\n/g, '\n');
    const source = normalize(original);
    const old = normalize(args.old_string);
    if (!old) throw new Error('old_string must not be empty');
    if (!source.includes(old)) throw new Error('Exact text not found. Read the file again before patching.');
    if (!args.replace_all && source.indexOf(old) !== source.lastIndexOf(old)) throw new Error('Multiple matches. Provide more context or set replace_all.');
    const replacement = normalize(args.new_string);
    let updated = args.replace_all ? source.replaceAll(old, () => replacement) : source.replace(old, () => replacement);
    if (original.includes('\r\n')) updated = updated.replace(/\n/g, '\r\n');
    await getTxManager(context.cwd).writeFile(fullPath, updated);
    return { success: true, diffSummary: `Replaced target block in ${args.path}` };
  }
};

// 4. List Directory Tool
export const ListDirInputSchema = z.object({
  path: z.string().trim().min(1).max(4096).optional().default('.').describe('Directory path to list'),
  recursive: z.boolean().optional().default(false).describe('List files recursively'),
  max_depth: z.number().int().min(0).max(8).optional().default(2).describe('Max recursion depth'),
});

export const listDirTool: ToolDefinition<z.input<typeof ListDirInputSchema>, { entries: Array<{ name: string; isDirectory: boolean; size: number }> }> = {
  name: 'list_directory',
  description: 'List files and subdirectories in a directory with file sizes and directory flags.',
  parameters: ListDirInputSchema,
  execute: async (args, context) => {
    const fullPath = resolveWorkspacePath(context.cwd, args.path || '.');
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Directory not found: ${args.path}`);
    }

    const entries: Array<{ name: string; isDirectory: boolean; size: number }> = [];
    const maxEntries = 2000;
    const visit = (directory: string, prefix: string, depth: number) => {
      if (entries.length >= maxEntries) return;
      let items: fs.Dirent[] = [];
      try { items = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
      for (const item of items) {
        if (entries.length >= maxEntries) break;
        const itemPath = path.join(directory, item.name);
        const name = prefix ? path.join(prefix, item.name) : item.name;
        let size = 0;
        if (!item.isDirectory()) {
          try { size = fs.statSync(itemPath).size; } catch { /* Keep inaccessible entries visible with size 0. */ }
        }
        entries.push({ name, isDirectory: item.isDirectory(), size });
        if (args.recursive && item.isDirectory() && depth < (args.max_depth ?? 2)) visit(itemPath, name, depth + 1);
      }
    };
    visit(fullPath, '', 0);

    return { entries };
  }
};
