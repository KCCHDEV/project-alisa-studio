import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const appDataDir = process.env.ALISA_CONFIG_DIR || (() => {
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'com.project.alisa');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'com.project.alisa');
  }
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'com.project.alisa');
})();
const environment = {
  ...process.env,
  FORCE_COLOR: '1',
  ALISA_CONFIG_DIR: appDataDir,
  // One-time compatibility path for settings created by the old source/dev store.
  ALISA_CONFIG_MIGRATION_SOURCE: resolve(root, '.alisa-config.json'),
};
const backend = Bun.spawn([process.execPath, '--watch', resolve(root, 'src/server/index.ts')], {
  cwd: root,
  env: environment,
  stdin: 'ignore',
  stdout: 'inherit',
  stderr: 'inherit',
});
const frontend = Bun.spawn([process.execPath, resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '3050'], {
  cwd: root,
  env: environment,
  stdin: 'ignore',
  stdout: 'inherit',
  stderr: 'inherit',
});

let requestedStop = false;
let stopped = false;
const stopChildren = () => {
  if (stopped) return;
  stopped = true;
  backend.kill();
  frontend.kill();
};

process.on('SIGINT', () => {
  requestedStop = true;
  stopChildren();
});
process.on('SIGTERM', () => {
  requestedStop = true;
  stopChildren();
});

const firstExit = await Promise.race([
  backend.exited.then(code => ({ name: 'backend', code })),
  frontend.exited.then(code => ({ name: 'frontend', code })),
]);

if (!requestedStop && firstExit.code !== 0) {
  console.error(`[desktop-dev] ${firstExit.name} exited with code ${firstExit.code}`);
}
stopChildren();
await Promise.allSettled([backend.exited, frontend.exited]);
process.exitCode = requestedStop ? 0 : (firstExit.code === 0 ? 1 : firstExit.code);
