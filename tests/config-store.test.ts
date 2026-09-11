import { test, expect } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AtomicJsonStore } from '../src/server/config-store.ts';

interface TestConfig {
  model: string;
  workspaceDir: string;
}

test('atomic config store keeps rolling backups and recovers a corrupt primary', () => {
  const root = mkdtempSync(join(tmpdir(), 'alisa-config-store-'));
  const filePath = join(root, '.alisa-config.json');
  const store = new AtomicJsonStore<TestConfig>(filePath, { backupCount: 3 });

  try {
    store.write({ model: 'model-1', workspaceDir: '/project/one' });
    store.write({ model: 'model-2', workspaceDir: '/project/two' });
    store.write({ model: 'model-3', workspaceDir: '/project/three' });
    store.write({ model: 'model-4', workspaceDir: '/project/four' });

    expect(JSON.parse(readFileSync(filePath, 'utf8')).model).toBe('model-4');
    expect(JSON.parse(readFileSync(store.backupPaths[0], 'utf8')).model).toBe('model-3');
    expect(JSON.parse(readFileSync(store.backupPaths[1], 'utf8')).model).toBe('model-2');
    expect(JSON.parse(readFileSync(store.backupPaths[2], 'utf8')).model).toBe('model-1');
    if (process.platform !== 'win32') {
      expect(statSync(filePath).mode & 0o777).toBe(0o600);
      expect(statSync(store.backupPaths[0]).mode & 0o777).toBe(0o600);
    }

    writeFileSync(filePath, '{"model":', 'utf8');
    const recovered = store.read();
    expect(recovered.repaired).toBe(true);
    expect(recovered.source).toBe(store.backupPaths[0]);
    expect(recovered.value?.model).toBe('model-3');

    store.write(recovered.value!, { rotateBackups: false, archivePrimary: true });
    expect(JSON.parse(readFileSync(filePath, 'utf8')).model).toBe('model-3');
    expect(readdirSync(root).some(name => name.startsWith('.alisa-config.json.corrupt-'))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('atomic config store migrates a valid legacy file into the primary path', () => {
  const root = mkdtempSync(join(tmpdir(), 'alisa-config-legacy-'));
  const filePath = join(root, '.alisa-config.json');
  const legacyPath = join(root, '.ichigo-config.json');
  const value = { model: 'legacy-model', workspaceDir: '/legacy/project' };
  writeFileSync(legacyPath, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
  const store = new AtomicJsonStore<TestConfig>(filePath, { legacyPaths: [legacyPath] });

  try {
    const loaded = store.read();
    expect(loaded.source).toBe(legacyPath);
    expect(loaded.value).toEqual(value);
    store.write(loaded.value!, { rotateBackups: false });
    expect(existsSync(filePath)).toBe(true);
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual(value);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
