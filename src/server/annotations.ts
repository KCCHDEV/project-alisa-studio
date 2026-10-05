import { randomUUID } from 'node:crypto';
import { AtomicJsonStore } from './config-store.ts';

export type AnnotationSide = 'new' | 'old';

export interface DiffAnnotation {
  id: string;
  worktreeId: string;
  filePath: string;
  /** 1-based line number on the chosen side of the hunk. */
  line: number;
  side: AnnotationSide;
  comment: string;
  createdAt: number;
  updatedAt: number;
  resolved: boolean;
}

export interface AnnotationInput {
  worktreeId: string;
  filePath: string;
  line: number;
  side?: AnnotationSide;
  comment: string;
}

interface AnnotationStoreShape {
  version: number;
  annotations: DiffAnnotation[];
}

const MAX_COMMENT_LENGTH = 4000;
const MAX_FILE_PATH_LENGTH = 512;
const MAX_ANNOTATIONS = 2000;

/**
 * Line comments attached to a worktree's diff.
 *
 * This is the "annotate the AI diff" loop: a reviewer marks lines, then the
 * collected notes are shipped back to the same agent as its next instruction.
 */
export class AnnotationStore {
  private readonly store: AtomicJsonStore<AnnotationStoreShape>;
  private cache: DiffAnnotation[];

  constructor(runtimeDir: string) {
    this.store = new AtomicJsonStore<AnnotationStoreShape>(
      `${runtimeDir}${pathSeparator()}.alisa-annotations.json`,
      { backupCount: 2 },
    );
    this.cache = normalizeList(this.store.read().value?.annotations);
  }

  list(worktreeId: string): DiffAnnotation[] {
    return this.cache
      .filter(annotation => annotation.worktreeId === worktreeId)
      .sort((left, right) => left.filePath.localeCompare(right.filePath) || left.line - right.line)
      .map(annotation => ({ ...annotation }));
  }

  /** Unresolved notes for a worktree, used to build the follow-up prompt. */
  open(worktreeId: string): DiffAnnotation[] {
    return this.list(worktreeId).filter(annotation => !annotation.resolved);
  }

  get(id: string): DiffAnnotation | undefined {
    const found = this.cache.find(annotation => annotation.id === id);
    return found ? { ...found } : undefined;
  }

  add(input: AnnotationInput): DiffAnnotation {
    const worktreeId = validateId(input.worktreeId, 'worktreeId');
    const filePath = validateFilePath(input.filePath);
    const comment = validateComment(input.comment);
    const line = Number(input.line);
    if (!Number.isInteger(line) || line < 1 || line > 1_000_000) throw new Error('Annotation line must be a positive integer');

    if (this.cache.length >= MAX_ANNOTATIONS) {
      throw new Error(`Only ${MAX_ANNOTATIONS} annotations can be stored. Delete some first.`);
    }

    const now = Date.now();
    const annotation: DiffAnnotation = {
      id: randomUUID(),
      worktreeId,
      filePath,
      line,
      side: input.side === 'old' ? 'old' : 'new',
      comment,
      createdAt: now,
      updatedAt: now,
      resolved: false,
    };
    this.persist([...this.cache, annotation]);
    return { ...annotation };
  }

  update(id: string, patch: { comment?: string; resolved?: boolean; line?: number }): DiffAnnotation {
    const existing = this.cache.find(annotation => annotation.id === id);
    if (!existing) throw new Error('Unknown annotation');
    if (patch.comment !== undefined) existing.comment = validateComment(patch.comment);
    if (patch.resolved !== undefined) {
      if (typeof patch.resolved !== 'boolean') throw new Error('resolved must be a boolean');
      existing.resolved = patch.resolved;
    }
    if (patch.line !== undefined) {
      const line = Number(patch.line);
      if (!Number.isInteger(line) || line < 1 || line > 1_000_000) throw new Error('Annotation line must be a positive integer');
      existing.line = line;
    }
    existing.updatedAt = Date.now();
    this.persist(this.cache);
    return { ...existing };
  }

  remove(id: string): boolean {
    const next = this.cache.filter(annotation => annotation.id !== id);
    if (next.length === this.cache.length) return false;
    this.persist(next);
    return true;
  }

  /** Drop every annotation for a worktree, called when it is removed. */
  clear(worktreeId: string): number {
    const next = this.cache.filter(annotation => annotation.worktreeId !== worktreeId);
    const removed = this.cache.length - next.length;
    if (removed > 0) this.persist(next);
    return removed;
  }

  private persist(annotations: DiffAnnotation[]) {
    this.cache = annotations.slice(-MAX_ANNOTATIONS);
    this.store.write({ version: 1, annotations: this.cache });
  }
}

/**
 * Render review notes as an instruction for the agent that produced the diff.
 *
 * Grouped by file so the agent reads it like a review checklist.
 */
export function formatAnnotationsForAgent(annotations: DiffAnnotation[], options: { title?: string } = {}): string {
  if (!annotations.length) return '';
  const byFile = new Map<string, DiffAnnotation[]>();
  for (const annotation of annotations) {
    const list = byFile.get(annotation.filePath) ?? [];
    list.push(annotation);
    byFile.set(annotation.filePath, list);
  }

  const lines: string[] = [];
  lines.push('A reviewer left notes on your changes. Address every point, then re-check the affected code.');
  if (options.title) lines.push(`Task: ${options.title}`);
  lines.push('');
  for (const [filePath, notes] of [...byFile.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`## ${filePath}`);
    for (const note of [...notes].sort((left, right) => left.line - right.line)) {
      const side = note.side === 'old' ? 'before' : 'after';
      lines.push(`- line ${note.line} (${side}): ${note.comment}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

function pathSeparator(): string {
  // Avoids importing `node:path` for a single separator.
  return process.platform === 'win32' ? '\\' : '/';
}

function validateId(value: string, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} is required`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120) throw new Error(`${field} must be 1-120 characters`);
  return trimmed;
}

function validateFilePath(value: string): string {
  if (typeof value !== 'string') throw new Error('filePath is required');
  const trimmed = value.trim();
  if (!trimmed) throw new Error('filePath is required');
  if (trimmed.length > MAX_FILE_PATH_LENGTH) throw new Error('filePath is too long');
  if (trimmed.startsWith('/') || /^[A-Za-z]:/.test(trimmed)) throw new Error('filePath must be relative to the worktree');
  if (trimmed.split(/[\\/]/).includes('..')) throw new Error('filePath cannot leave the worktree');
  return trimmed;
}

function validateComment(value: string): string {
  if (typeof value !== 'string') throw new Error('comment is required');
  const trimmed = value.trim();
  if (!trimmed) throw new Error('comment is required');
  if (trimmed.length > MAX_COMMENT_LENGTH) throw new Error('comment is too long');
  return trimmed;
}

function normalizeList(value: unknown): DiffAnnotation[] {
  if (!Array.isArray(value)) return [];
  const result: DiffAnnotation[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Partial<DiffAnnotation>;
    if (typeof candidate.id !== 'string' || !candidate.id) continue;
    if (typeof candidate.worktreeId !== 'string' || !candidate.worktreeId) continue;
    if (typeof candidate.filePath !== 'string' || !candidate.filePath) continue;
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    result.push({
      id: candidate.id,
      worktreeId: candidate.worktreeId,
      filePath: candidate.filePath,
      line: Number(candidate.line) || 1,
      side: candidate.side === 'old' ? 'old' : 'new',
      comment: typeof candidate.comment === 'string' ? candidate.comment : '',
      createdAt: Number(candidate.createdAt) || Date.now(),
      updatedAt: Number(candidate.updatedAt) || Number(candidate.createdAt) || Date.now(),
      resolved: candidate.resolved === true,
    });
  }
  return result;
}