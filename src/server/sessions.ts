import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { AgentMode, AgentStatus, Goal, Message, PlanItem } from '../core/types';

export type SavedRun = {
  status: AgentStatus;
  detail?: string;
  durationMs: number;
  completedAt: number;
};

export interface SavedSession {
  id: string;
  title: string;
  workspace: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  pinned?: boolean;
  archived?: boolean;
  customTitle?: boolean;
  mode?: AgentMode;
  model?: string;
  plan?: PlanItem[];
  goal?: Goal;
  swarm?: boolean;
  lastRun?: SavedRun;
}

export class SessionStore {
  constructor(private directory: string) { fs.mkdirSync(directory, { recursive: true }); }
  private file(workspace: string) {
    return path.join(this.directory, `${createHash('sha256').update(path.resolve(workspace)).digest('hex')}.json`);
  }
  private normalize(session: Partial<SavedSession>, workspace: string): SavedSession {
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const firstPrompt = messages.find(m => m?.role === 'user')?.content?.slice(0, 80);
    const validModes = new Set<AgentMode>(['ask', 'plan', 'code', 'auto']);
    const validStatuses = new Set<AgentStatus>(['idle', 'thinking', 'acting', 'waiting_approval', 'self_correcting', 'error', 'done']);
    const validGoalStatuses = new Set<Goal['status']>(['active', 'completed', 'paused', 'blocked']);
    const rawGoal = session.goal;
    const goal = rawGoal && typeof rawGoal === 'object'
      && typeof rawGoal.title === 'string' && rawGoal.title.trim()
      && validGoalStatuses.has(rawGoal.status)
      && Number.isFinite(rawGoal.progress)
      ? {
        id: typeof rawGoal.id === 'string' && rawGoal.id ? rawGoal.id.slice(0, 120) : `goal_${Date.now()}`,
        title: rawGoal.title.trim().slice(0, 240),
        description: typeof rawGoal.description === 'string' ? rawGoal.description.slice(0, 2000) : '',
        status: rawGoal.status,
        progress: Math.max(0, Math.min(100, Math.round(rawGoal.progress))),
        steps: Array.isArray(rawGoal.steps)
          ? rawGoal.steps.filter(step => step && typeof step.id === 'string' && typeof step.title === 'string' && ['pending', 'in_progress', 'completed', 'blocked'].includes(step.status)).slice(0, 30).map(step => ({
            id: step.id.slice(0, 80),
            title: step.title.trim().slice(0, 240),
            status: step.status,
          }))
          : [],
        createdAt: Number.isFinite(rawGoal.createdAt) ? rawGoal.createdAt : Date.now(),
        updatedAt: Number.isFinite(rawGoal.updatedAt) ? rawGoal.updatedAt : Date.now(),
      } as Goal
      : undefined;
    const rawRun = session.lastRun;
    const lastRun = rawRun && validStatuses.has(rawRun.status)
      && Number.isFinite(rawRun.durationMs) && rawRun.durationMs >= 0
      && Number.isFinite(rawRun.completedAt) && rawRun.completedAt > 0
      ? {
        status: rawRun.status,
        detail: typeof rawRun.detail === 'string' ? rawRun.detail.slice(0, 240) : undefined,
        durationMs: Math.round(rawRun.durationMs),
        completedAt: Math.round(rawRun.completedAt),
      }
      : undefined;
    return {
      id: typeof session.id === 'string' && session.id ? session.id : randomUUID(),
      title: typeof session.title === 'string' && session.title ? session.title : (firstPrompt || 'New chat'),
      workspace: typeof session.workspace === 'string' && session.workspace ? session.workspace : workspace,
      createdAt: typeof session.createdAt === 'number' ? session.createdAt : (typeof session.updatedAt === 'number' ? session.updatedAt : Date.now()),
      updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : Date.now(),
      messages,
      pinned: session.pinned === true,
      archived: session.archived === true,
      customTitle: session.customTitle === true,
      mode: validModes.has(session.mode as AgentMode) ? session.mode : undefined,
      model: typeof session.model === 'string' ? session.model : undefined,
      plan: Array.isArray(session.plan) ? session.plan : [],
      goal,
      swarm: session.swarm === true,
      lastRun,
    };
  }

  private read(workspace: string): SavedSession[] {
    const file = this.file(workspace);
    if (fs.existsSync(file)) {
      try {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Array.isArray(saved) && saved.length) return saved.map(entry => this.normalize(entry, workspace));
      } catch {
        // A corrupt session file should not prevent the workspace from opening.
      }
    }
    // Preserve the previous one-conversation-per-project format on first access.
    const legacy = path.join(this.directory, `project_${Buffer.from(workspace).toString('base64').replace(/[/+=]/g, '_')}.json`);
    let messages: Message[] = [];
    try {
      const legacyMessages = fs.existsSync(legacy) ? JSON.parse(fs.readFileSync(legacy, 'utf8')) : [];
      if (Array.isArray(legacyMessages)) messages = legacyMessages;
    } catch {
      messages = [];
    }
    const first = this.normalize({
      id: randomUUID(),
      workspace,
      title: messages.find(m => m?.role === 'user')?.content?.slice(0, 80) || 'New chat',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages,
    }, workspace);
    this.write(workspace, [first]);
    return [first];
  }

  list(workspace: string, options: { includeArchived?: boolean } = {}): SavedSession[] {
    const sessions = this.read(workspace);
    return options.includeArchived === false ? sessions.filter(session => !session.archived) : sessions;
  }

  create(workspace: string, messages: Message[] = []): SavedSession {
    const now = Date.now();
    const session: SavedSession = {
      id: randomUUID(),
      workspace,
      title: messages.find(m => m.role === 'user')?.content.slice(0, 80) || 'New chat',
      createdAt: now,
      updatedAt: now,
      messages,
      pinned: false,
      archived: false,
      customTitle: false,
      plan: [],
      swarm: false,
    };
    const sessions = this.read(workspace);
    this.write(workspace, [session, ...sessions]);
    return session;
  }

  get(workspace: string, id?: string): SavedSession {
    const sessions = this.list(workspace);
    const session = id ? sessions.find(s => s.id === id) : sessions[0];
    if (!session) throw new Error('Chat session not found in this workspace');
    return session;
  }

  update(workspace: string, id: string, patch: Partial<Pick<SavedSession, 'title' | 'pinned' | 'archived' | 'mode' | 'model' | 'plan' | 'goal' | 'swarm'>>): SavedSession {
    const sessions = this.list(workspace);
    const session = sessions.find(entry => entry.id === id);
    if (!session) throw new Error('Chat session not found in this workspace');
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title || title.length > 120) throw new Error('Chat title must be between 1 and 120 characters');
      session.title = title;
      session.customTitle = true;
    }
    if (patch.pinned !== undefined) session.pinned = patch.pinned === true;
    if (patch.archived !== undefined) session.archived = patch.archived === true;
    if (patch.mode !== undefined) session.mode = patch.mode;
    if (patch.model !== undefined) session.model = patch.model;
    if (patch.plan !== undefined) session.plan = patch.plan;
    if ('goal' in patch) session.goal = patch.goal;
    if (patch.swarm !== undefined) session.swarm = patch.swarm === true;
    session.updatedAt = Date.now();
    this.write(workspace, [session, ...sessions.filter(entry => entry.id !== session.id)]);
    return session;
  }

  search(workspace: string, query: string): SavedSession[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return this.list(workspace, { includeArchived: false });
    return this.list(workspace).filter(session => {
      if (session.title.toLowerCase().includes(normalized)) return true;
      return session.messages.some(message => message.content?.toLowerCase().includes(normalized));
    });
  }

  save(session: SavedSession) {
    session.updatedAt = Date.now();
    if (!session.customTitle) {
      session.title = session.messages.find(m => m.role === 'user')?.content.slice(0, 80) || 'New chat';
    }
    const sessions = this.list(session.workspace);
    this.write(session.workspace, [session, ...sessions.filter(s => s.id !== session.id)]);
  }
  private write(workspace: string, sessions: SavedSession[]) {
    const file = this.file(workspace);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(sessions), { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
  }
}
