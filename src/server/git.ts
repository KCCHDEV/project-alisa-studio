import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

export async function gitOverview(workspace: string) {
  const options = { cwd: workspace, windowsHide: true, timeout: 15000, maxBuffer: 2 * 1024 * 1024 };
  const { stdout: branch } = await exec('git', ['branch', '--show-current'], options);
  const { stdout: status } = await exec('git', ['status', '--short'], options);
  const { stdout: diff } = await exec('git', ['diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--'], options);
  return { branch: branch.trim() || 'Detached HEAD', status, diff };
}

export async function listPullRequests(workspace: string) {
  try {
    const { stdout } = await exec('gh', ['pr', 'list', '--limit', '30', '--json', 'number,title,url,headRefName,isDraft,state'], { cwd: workspace, windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 });
    return JSON.parse(stdout);
  } catch {
    throw new Error('Unable to load pull requests. Install GitHub CLI, run gh auth login, and open a repository with a GitHub remote.');
  }
}
