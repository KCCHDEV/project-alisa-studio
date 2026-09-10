import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Message } from '../core/types';

export interface SavedSession {
  id: string;
  title: string;
  workspace: string;
  updatedAt: number;
  messages: Message[];
}

export class SessionStore {
  constructor(private directory: string) { fs.mkdirSync(directory, { recursive: true }); }
  private file(workspace: string) {
    return path.join(this.directory, `${createHash('sha256').update(path.resolve(workspace)).digest('hex')}.json`);
  }
  list(workspace: string): SavedSession[] {
    const file = this.file(workspace);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    // Preserve the previous one-conversation-per-project format on first access.
    const legacy = path.join(this.directory, `project_${Buffer.from(workspace).toString('base64').replace(/[/+=]/g, '_')}.json`);
    const messages = fs.existsSync(legacy) ? JSON.parse(fs.readFileSync(legacy, 'utf8')) : [];
    return [this.create(workspace, messages)];
  }
  create(workspace: string, messages: Message[] = []): SavedSession {
    const session = { id: randomUUID(), workspace, title: messages.find(m => m.role === 'user')?.content.slice(0, 80) || 'New chat', updatedAt: Date.now(), messages };
    const file = this.file(workspace);
    const sessions: SavedSession[] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
    this.write(workspace, [session, ...sessions]);
    return session;
  }
  get(workspace: string, id?: string): SavedSession {
    const sessions = this.list(workspace);
    const session = id ? sessions.find(s => s.id === id) : sessions[0];
    if (!session) throw new Error('Chat session not found in this workspace');
    return session;
  }
  save(session: SavedSession) {
    session.updatedAt = Date.now();
    session.title = session.messages.find(m => m.role === 'user')?.content.slice(0, 80) || 'New chat';
    const sessions = this.list(session.workspace);
    this.write(session.workspace, [session, ...sessions.filter(s => s.id !== session.id)]);
  }
  private write(workspace: string, sessions: SavedSession[]) {
    const file = this.file(workspace);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(sessions), { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
  }
}
