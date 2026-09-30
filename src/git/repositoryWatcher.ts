import * as path from 'path';
import * as vscode from 'vscode';
import { globalGitConfigPaths, repositoryGitConfigPath } from './gitConfigFiles';
import type { GitExtension, Repository } from '../types/git';

export interface RepositoryWatcherCallbacks {
  /** A repository's HEAD now points at a different commit (commit, amend, checkout, pull, reset...). */
  onHeadChanged: () => void;
  /** Anything about a repository's state changed, a branch or remote branch moving included. */
  onStateChanged: () => void;
  /** A repository was opened or closed, so file → repository resolution may be stale. */
  onRepositoriesChanged: () => void;
  /** A git config file changed, so the remote URL or user.email may be different. */
  onConfigChanged: () => void;
}

/** Calls `listener` whenever the file at `filePath` is created, changed, or deleted. */
export function watchFile(filePath: string, listener: () => void): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(path.dirname(filePath)), path.basename(filePath)),
  );
  // Git rewrites a config file by renaming a lock file over it, which can read as any of the three.
  watcher.onDidCreate(listener);
  watcher.onDidChange(listener);
  watcher.onDidDelete(listener);
  return watcher;
}

/**
 * Watches repositories through the built-in git extension, along with each
 * repository's config file and the global git config. If that extension is
 * unavailable or disabled, only the global config is watched and other caches
 * only refresh when the document changes.
 */
export class RepositoryWatcher implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly perRepo = new Map<string, vscode.Disposable>();
  private disposed = false;

  constructor(private readonly callbacks: RepositoryWatcherCallbacks) {
    for (const file of globalGitConfigPaths()) {
      this.disposables.push(watchFile(file, () => this.callbacks.onConfigChanged()));
    }
    void this.start();
  }

  dispose(): void {
    this.disposed = true;
    for (const d of this.disposables) {
      d.dispose();
    }
    for (const d of this.perRepo.values()) {
      d.dispose();
    }
    this.perRepo.clear();
  }

  private async start(): Promise<void> {
    const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!ext) {
      return;
    }
    let api;
    try {
      const exports = ext.isActive ? ext.exports : await ext.activate();
      api = exports.getAPI(1);
    } catch {
      return;
    }
    if (this.disposed) {
      return;
    }

    for (const repo of api.repositories) {
      this.watch(repo);
    }
    this.disposables.push(
      api.onDidOpenRepository((repo) => {
        this.watch(repo);
        this.callbacks.onRepositoriesChanged();
      }),
      api.onDidCloseRepository((repo) => {
        const key = repo.rootUri.toString();
        this.perRepo.get(key)?.dispose();
        this.perRepo.delete(key);
        this.callbacks.onRepositoriesChanged();
      }),
    );
  }

  private watch(repo: Repository): void {
    const key = repo.rootUri.toString();
    if (this.perRepo.has(key)) {
      return;
    }
    // state.onDidChange also fires for plain working-tree edits; only a moved
    // HEAD can change which commit a line is attributed to.
    let lastHead = repo.state.HEAD?.commit;
    const disposables: vscode.Disposable[] = [
      repo.state.onDidChange(() => {
        this.callbacks.onStateChanged();
        const head = repo.state.HEAD?.commit;
        if (head !== lastHead) {
          lastHead = head;
          this.callbacks.onHeadChanged();
        }
      }),
    ];
    let closed = false;
    this.perRepo.set(key, {
      dispose: () => {
        closed = true;
        disposables.forEach((d) => d.dispose());
      },
    });

    void repositoryGitConfigPath(repo.rootUri.fsPath).then((configPath) => {
      if (configPath && !closed && !this.disposed) {
        disposables.push(watchFile(configPath, () => this.callbacks.onConfigChanged()));
      }
    });
  }
}
