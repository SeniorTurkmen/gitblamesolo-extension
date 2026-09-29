import * as vscode from 'vscode';
import type { GitExtension, Repository } from '../types/git';

export interface RepositoryWatcherCallbacks {
  /** A repository's HEAD now points at a different commit (commit, amend, checkout, pull, reset...). */
  onHeadChanged: () => void;
  /** A repository was opened or closed, so file → repository resolution may be stale. */
  onRepositoriesChanged: () => void;
}

/**
 * Watches repositories through the built-in git extension. If that extension
 * is unavailable or disabled, nothing is watched and caches only refresh when
 * the document changes.
 */
export class RepositoryWatcher implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly perRepo = new Map<string, vscode.Disposable>();
  private disposed = false;

  constructor(private readonly callbacks: RepositoryWatcherCallbacks) {
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
    this.perRepo.set(
      key,
      repo.state.onDidChange(() => {
        const head = repo.state.HEAD?.commit;
        if (head !== lastHead) {
          lastHead = head;
          this.callbacks.onHeadChanged();
        }
      }),
    );
  }
}
