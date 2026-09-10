import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScheduleStore } from '../src/server/schedules';

test('scheduler prevents duplicate runs, waits for a busy workspace, and pauses on failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alisa-schedule-'));
  try {
    const store = new ScheduleStore(join(root, 'schedules.json'));
    store.create({ workspace: root, name: 'Check', prompt: 'Read', intervalMinutes: 15 }, 0);
    let count = 0;
    const execute = async () => { count++; await Bun.sleep(20); return 'result-chat'; };
    await store.tick(execute, () => true, 900000);
    expect(count).toBe(0);
    await Promise.all([store.tick(execute, () => false, 900000), store.tick(execute, () => false, 900000)]);
    expect(count).toBe(1);
    expect(store.list(root)[0].lastSessionId).toBe('result-chat');
    await store.tick(async () => { throw new Error('Provider unavailable'); }, () => false, 1800000);
    expect(store.list(root)[0].enabled).toBe(false);
    expect(new ScheduleStore(join(root, 'schedules.json')).list(root)[0].error).toBe('Provider unavailable');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
