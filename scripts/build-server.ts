import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
mkdirSync('src-tauri/binaries', { recursive: true });
const output = `src-tauri/binaries/alisa-server${process.platform === 'win32' ? '.exe' : ''}`;
execFileSync(process.execPath, ['build', '--compile', 'src/server/index.ts', '--outfile', output], { stdio: 'inherit' });
