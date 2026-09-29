import * as fs from 'fs';
import * as path from 'path';

function makeWritable(dir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      makeWritable(entryPath);
    } else {
      fs.chmodSync(entryPath, 0o666);
    }
  }
}

/**
 * Deletes a test repository. Git writes object files read-only, and on
 * Windows the Node in VS Code's extension host can't delete read-only files,
 * so make them writable first.
 */
export function removeRepo(repoRoot: string): void {
  makeWritable(repoRoot);
  fs.rmSync(repoRoot, { recursive: true, force: true });
}
