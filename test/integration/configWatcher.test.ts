import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { repositoryGitConfigPath } from '../../src/git/gitConfigFiles';
import { watchFile } from '../../src/git/repositoryWatcher';
import { removeRepo } from '../fixtures/tempRepo';

// Needs the VS Code API, so it only runs in the extension host (`vscode-test`).
describe('git config file watching', () => {
  let repoRoot: string;

  before(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitblamesolo-watch-'));
    execFileSync('git', ['init'], { cwd: repoRoot });
  });

  after(() => {
    removeRepo(repoRoot);
  });

  it('notices `git config` and `git remote` changing the repository config outside the workspace', async () => {
    const configPath = await repositoryGitConfigPath(repoRoot);
    assert.ok(configPath);

    for (const args of [
      ['config', 'user.email', 'new@example.com'],
      ['remote', 'add', 'origin', 'https://github.com/o/r.git'],
    ]) {
      let resolveChanged: () => void = () => undefined;
      const changed = new Promise<void>((resolve) => (resolveChanged = resolve));
      const watcher = watchFile(configPath!, () => resolveChanged());
      try {
        // Give the watcher a moment to start before changing the file.
        await new Promise((resolve) => setTimeout(resolve, 500));
        execFileSync('git', args, { cwd: repoRoot });
        await Promise.race([
          changed,
          new Promise((_, reject) => setTimeout(() => reject(new Error(`no change event for git ${args[0]}`)), 10000)),
        ]);
      } finally {
        watcher.dispose();
      }
    }
  });
});
