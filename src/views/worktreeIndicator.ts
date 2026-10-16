import * as vscode from 'vscode';
import { samePath, Worktree } from '../git/gitWorktree';
import { worktreeLabel, WorktreeTreeProvider } from './worktreeTree';

/**
 * Shows that the window has a linked worktree open, not the repository's main
 * working tree: a status bar item, the view's description, a `WT` badge on the
 * workspace folder when there are several, and the `gitBlameSolo.inWorktree`
 * context key.
 */
export class WorktreeIndicator implements vscode.Disposable, vscode.FileDecorationProvider {
  private readonly statusBar = vscode.window.createStatusBarItem('gitBlameSolo.worktree', vscode.StatusBarAlignment.Left, 100);
  private readonly decorationEmitter = new vscode.EventEmitter<vscode.Uri[]>();
  readonly onDidChangeFileDecorations = this.decorationEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];
  /** Workspace folders that are linked worktrees, by URI. */
  private linked = new Map<string, Worktree>();

  constructor(
    private readonly provider: WorktreeTreeProvider,
    private readonly view: vscode.TreeView<unknown>,
  ) {
    this.statusBar.name = 'Git Blame Solo: Worktree';
    this.statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.statusBar.command = 'gitBlameSolo.worktrees.focus';
    this.disposables.push(
      this.statusBar,
      this.decorationEmitter,
      provider.onDidChangeModel(() => this.update()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.update()),
      vscode.window.registerFileDecorationProvider(this),
    );
    this.update();
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private update(): void {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const previous = [...this.linked.keys()];
    this.linked = new Map();
    for (const folder of folders) {
      for (const repository of this.provider.getRepositories()) {
        const worktree = repository.worktrees.find((w) => !w.isMain && samePath(w.path, folder.uri.fsPath));
        if (worktree) {
          this.linked.set(folder.uri.toString(), worktree);
        }
      }
    }
    const worktrees = [...this.linked.values()];
    void vscode.commands.executeCommand('setContext', 'gitBlameSolo.inWorktree', worktrees.length > 0);

    if (worktrees.length > 0) {
      const labels = worktrees.map(worktreeLabel);
      this.statusBar.text = `$(list-tree) Worktree: ${labels.join(', ')}`;
      this.statusBar.tooltip = new vscode.MarkdownString(
        `This window has a linked worktree open, not the repository's main folder:\n\n${worktrees
          .map((w) => `- **${worktreeLabel(w)}** — ${w.path}`)
          .join('\n')}\n\nClick to show the Worktrees view.`,
      );
      this.statusBar.show();
      this.view.description = `Worktree · ${labels.join(', ')}`;
    } else {
      this.statusBar.hide();
      this.view.description = undefined;
    }
    const changed = new Set([...previous, ...this.linked.keys()]);
    if (changed.size > 0) {
      this.decorationEmitter.fire([...changed].map((uri) => vscode.Uri.parse(uri)));
    }
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    // With one folder, the explorer shows no root folder row to badge.
    if ((vscode.workspace.workspaceFolders?.length ?? 0) < 2) {
      return undefined;
    }
    const worktree = this.linked.get(uri.toString());
    return worktree && new vscode.FileDecoration('WT', `Linked worktree: ${worktreeLabel(worktree)}`);
  }
}
