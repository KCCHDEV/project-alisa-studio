import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';

export interface Schedule {
  id: string;
  workspace: string;
  name: string;
  prompt: string;
  intervalMinutes: number;
  nextRunAt: number;
  enabled: boolean;
  status: 'ready' | 'running' | 'done' | 'error';
  lastRunAt?: number;
  lastSessionId?: string;
  error?: string;
}

/** Single process scheduler. Due runs are claimed before awaiting; no catch-up burst. */
export class ScheduleStore {
  private items: Schedule[];
  constructor(private file: string) {
    this.items = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
    for (const item of this.items) if (item.status === 'running') {
      item.status = 'error'; item.enabled = false; item.error = 'Interrupted by app shutdown. Review the chat before resuming.';
    }
    this.persist();
  }
  list(workspace: string) { return this.items.filter(s => s.workspace === workspace).map(s => ({ ...s })); }
  create(input: Pick<Schedule, 'workspace' | 'name' | 'prompt' | 'intervalMinutes'>, now = Date.now()) {
    const item: Schedule = { ...input, id: randomUUID(), enabled: true, status: 'ready', nextRunAt: now + input.intervalMinutes * 60000 };
    this.items.push(item); this.persist(); return { ...item };
  }
  update(workspace: string, id: string, action: 'pause' | 'resume' | 'delete') {
    const item = this.items.find(s => s.id === id && s.workspace === workspace);
    if (!item) throw new Error('Schedule not found');
    if (item.status === 'running') throw new Error('Wait for the current run to finish before changing this schedule');
    if (action === 'delete') this.items = this.items.filter(s => s.id !== id);
    else { item.enabled = action === 'resume'; item.nextRunAt = Date.now() + item.intervalMinutes * 60000; }
    this.persist();
  }
  async tick(run: (schedule: Schedule) => Promise<string>, busy: (workspace: string) => boolean, now = Date.now()) {
    for (const item of this.items) {
      if (!item.enabled || item.status === 'running' || item.nextRunAt > now || busy(item.workspace)) continue;
      item.status = 'running'; item.lastRunAt = now; item.nextRunAt = now + item.intervalMinutes * 60000;
      this.persist();
      try { item.lastSessionId = await run({ ...item }); item.status = 'done'; item.error = undefined; }
      catch (err) { item.status = 'error'; item.enabled = false; item.error = err instanceof Error ? err.message : 'Scheduled task failed'; }
      this.persist();
    }
  }
  private persist() {
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.items), { mode: 0o600 });
    fs.renameSync(`${this.file}.tmp`, this.file);
  }
}
