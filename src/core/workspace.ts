import * as fs from 'node:fs';
import * as path from 'node:path';

/** Resolve existing ancestors too, so symlinks/junctions cannot escape the workspace. */
export function resolveWorkspacePath(workspace: string, requested: string): string {
  const root = fs.realpathSync(workspace);
  const target = path.resolve(root, requested);
  let ancestor = target;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error('Path has no existing parent');
    ancestor = parent;
  }
  const resolved = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, target));
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Path is outside the active workspace');
  }
  return resolved;
}
