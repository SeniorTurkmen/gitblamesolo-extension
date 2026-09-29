import * as fs from 'fs';
import * as path from 'path';

function makeWritable(dir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      makeWritable(entryPath);
    } else {
      try {
        fs.chmodSync(entryPath, 0o666);
      } catch (err) {
        // A lock file git removed in the meantime.
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }
    }
  }
}

/**
 * Deletes a test repository. Git writes object files read-only, and on
 * Windows the Node in VS Code's extension host can't delete read-only files,
 * so make them writable first. In the extension host, VS Code's own git
 * extension may still be writing to a repository a test opened, so retry.
 */
export function removeRepo(repoRoot: string): void {
  makeWritable(repoRoot);
  fs.rmSync(repoRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
