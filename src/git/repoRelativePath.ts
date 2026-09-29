import * as fs from 'fs';
import * as path from 'path';

function isInside(relative: string): boolean {
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * A file's path relative to the repository root, with forward slashes.
 * Git reports the root with symlinks resolved (on macOS, /var is really
 * /private/var), so when the file was opened through a symlink its folder is
 * resolved too. Undefined for a file outside the repository.
 */
export async function repoRelativePath(repoRoot: string, filePath: string): Promise<string | undefined> {
  let relative = path.relative(repoRoot, filePath);
  if (!isInside(relative)) {
    try {
      // Resolve the folder rather than the file, which may not exist on disk yet.
      const [realRoot, realFolder] = await Promise.all([
        fs.promises.realpath(repoRoot),
        fs.promises.realpath(path.dirname(filePath)),
      ]);
      relative = path.relative(realRoot, path.join(realFolder, path.basename(filePath)));
    } catch {
      return undefined;
    }
    if (!isInside(relative)) {
      return undefined;
    }
  }
  return relative.split(path.sep).join('/');
}
