import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { resolveWorkspacePath } from './workspace';

interface FileSnapshot {
  id: string;
  filePath: string;
  originalContent: string | null;
  expectedHash: string;
  timestamp: number;
}
const hash = (content: string) => createHash('sha256').update(content).digest('hex');

export class FileTransactionManager {
  private snapshotDir: string;
  private history: FileSnapshot[] = [];
  constructor(private workspaceDir: string) {
    this.snapshotDir = resolveWorkspacePath(workspaceDir, '.ichigo-snapshots');
    fs.mkdirSync(this.snapshotDir, { recursive: true });
    for (const file of fs.readdirSync(this.snapshotDir).filter(f => f.endsWith('.bak'))) {
      const snapshot = JSON.parse(fs.readFileSync(path.join(this.snapshotDir, file), 'utf8'));
      // Legacy backups lack the post-write hash and cannot safely auto-restore.
      if (typeof snapshot.expectedHash === 'string' && snapshot.id === file.slice(0, -4)) this.history.push(snapshot);
    }
    this.history.sort((a, b) => a.timestamp - b.timestamp);
  }
  async writeFile(filePath: string, content: string): Promise<void> {
    const target = resolveWorkspacePath(this.workspaceDir, filePath);
    const snapshot: FileSnapshot = {
      id: randomUUID(), filePath: target,
      originalContent: fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null,
      expectedHash: hash(content), timestamp: Math.max(Date.now(), (this.history.at(-1)?.timestamp || 0) + 1),
    };
    // Fail closed: never write if the original cannot be read or its backup saved.
    fs.writeFileSync(path.join(this.snapshotDir, `${snapshot.id}.bak`), JSON.stringify(snapshot), { mode: 0o600 });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
    this.history.push(snapshot);
  }
  async rollbackLatest(): Promise<{ success: boolean; filePath?: string; message: string }> {
    const last = this.history.at(-1);
    if (!last) return { success: false, message: 'No supported file changes to roll back.' };
    try {
      const target = resolveWorkspacePath(this.workspaceDir, last.filePath);
      if (!fs.existsSync(target) || hash(fs.readFileSync(target, 'utf8')) !== last.expectedHash) {
        throw new Error('File changed after this snapshot. Save or review those changes before rollback.');
      }
      if (last.originalContent === null) fs.unlinkSync(target);
      else fs.writeFileSync(target, last.originalContent, 'utf8');
      fs.unlinkSync(path.join(this.snapshotDir, `${last.id}.bak`));
      this.history.pop();
      return { success: true, filePath: target, message: `Restored ${path.basename(target)}` };
    } catch (err) { return { success: false, message: err instanceof Error ? err.message : 'Rollback failed' }; }
  }
  getRevisionCount() { return this.history.length; }
}
