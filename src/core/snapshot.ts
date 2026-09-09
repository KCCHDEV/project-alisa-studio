/**
 * FileTransactionManager - 1-Click Rollback Snapshot Engine for Ichigo Agent
 */
import * as fs from 'fs';
import * as path from 'path';

export interface FileSnapshot {
  id: string;
  filePath: string;
  originalContent: string | null; // null if file was created newly
  timestamp: number;
}

export class FileTransactionManager {
  private snapshotDir: string;
  private history: FileSnapshot[] = [];

  constructor(workspaceDir: string) {
    this.snapshotDir = path.join(workspaceDir, '.ichigo-snapshots');
    if (!fs.existsSync(this.snapshotDir)) {
      try {
        fs.mkdirSync(this.snapshotDir, { recursive: true });
      } catch (err) {
        console.error('Failed to create snapshot directory:', err);
      }
    }
  }

  /**
   * Save snapshot before file mutation
   */
  async createSnapshot(filePath: string): Promise<string> {
    const id = `snap_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    let originalContent: string | null = null;

    if (fs.existsSync(filePath)) {
      try {
        originalContent = fs.readFileSync(filePath, 'utf-8');
      } catch (err) {
        console.error(`Failed to read file for snapshot (${filePath}):`, err);
      }
    }

    const snapshot: FileSnapshot = {
      id,
      filePath,
      originalContent,
      timestamp: Date.now(),
    };

    this.history.push(snapshot);

    // Save backup to disk
    const backupFile = path.join(this.snapshotDir, `${id}.bak`);
    try {
      fs.writeFileSync(
        backupFile,
        JSON.stringify({ filePath, originalContent, timestamp: snapshot.timestamp }, null, 2),
        'utf-8'
      );
    } catch {}

    return id;
  }

  /**
   * Rollback the most recent file change
   */
  async rollbackLatest(): Promise<{ success: boolean; filePath?: string; message: string }> {
    if (this.history.length === 0) {
      return { success: false, message: 'ไม่มีประวัติการแก้ไขไฟล์ให้ Rollback' };
    }

    const last = this.history.pop()!;
    try {
      if (last.originalContent === null) {
        // File was newly created, delete it
        if (fs.existsSync(last.filePath)) {
          fs.unlinkSync(last.filePath);
        }
      } else {
        // Restore original content
        fs.mkdirSync(path.dirname(last.filePath), { recursive: true });
        fs.writeFileSync(last.filePath, last.originalContent, 'utf-8');
      }

      return {
        success: true,
        filePath: last.filePath,
        message: `↩️ Rollback สำเร็จ: คืนค่าไฟล์ ${path.basename(last.filePath)} เรียบร้อยแล้ว`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `❌ Rollback ล้มเหลว: ${err.message}`,
      };
    }
  }

  /**
   * Get revision count
   */
  getRevisionCount(): number {
    return this.history.length;
  }
}
