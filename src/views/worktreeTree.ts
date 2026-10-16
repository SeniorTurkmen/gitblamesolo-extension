import * as path from 'path';
import * as vscode from 'vscode';
import { listRepositories } from '../git/gitRepository';
import {
  BranchStatus,
  describeBranchStatus,
  describeLocation,
  getBranchStatuses,
  getDefaultBranch,
  getWorktreeIdentity,
  listWorktrees,
  samePath,
  Worktree,
} from '../git/gitWorktree';

/** How long to wait for git to settle before reading the worktrees again after a change. */
const REFRESH_DELAY_MS = 300;

/** A repository and its worktrees, the main one first. */
export interface RepositoryWorktrees {
  /** The main worktree's folder, or the repository's folder when it is bare. */
  mainRoot: string;
  worktrees: Worktree[];
  /** The branch merge status is measured against, such as `origin/main`. */
  defaultBranch?: string;
  /** Merge status of each linked worktree's branch. */
  statuses: Map<string, BranchStatus>;
}

export type WorktreeNode =
  | { kind: 'repository'; repository: RepositoryWorktrees }
  | { kind: 'worktree'; repository: RepositoryWorktrees; worktree: Worktree };

/** Whether this window has the worktree open as a workspace folder. */
export function isOpenInWindow(worktree: Worktree): boolean {
  return (vscode.workspace.workspaceFolders ?? []).some((folder) => samePath(folder.uri.fsPath, worktree.path));
}

export function worktreeLabel(worktree: Worktree): string {
  return worktree.branch ?? (worktree.head ? worktree.head.slice(0, 7) : path.basename(worktree.path));
}

/** Reads the repositories open in the window, keeping those that have linked worktrees. */
async function loadRepositories(): Promise<{ all: RepositoryWorktrees[]; withLinked: RepositoryWorktrees[] }> {
  const seen = new Set<string>();
  const all: RepositoryWorktrees[] = [];
  for (const repo of await listRepositories()) {
    // Each worktree of a repository opens as a repository of its own; show the repository once.
    const identity = await getWorktreeIdentity(repo.rootFsPath);
    const key = identity?.commonDir ?? repo.rootFsPath;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const worktrees = await listWorktrees(repo.rootFsPath);
    if (worktrees.length === 0) {
      continue;
    }
    const main = worktrees[0];
    const linkedBranches = worktrees.filter((w) => !w.isMain && w.branch).map((w) => w.branch!);
    const defaultBranch = await getDefaultBranch(repo.rootFsPath, main.branch);
    const statuses = await getBranchStatuses(repo.rootFsPath, defaultBranch, linkedBranches);
    all.push({ mainRoot: main.path, worktrees, defaultBranch, statuses });
  }
  all.sort((a, b) => a.mainRoot.localeCompare(b.mainRoot));
  return { all, withLinked: all.filter((repo) => repo.worktrees.length > 1) };
}

/** The Worktrees view: every worktree of the open repositories, grouped by repository when there are several. */
export class WorktreeTreeProvider implements vscode.TreeDataProvider<WorktreeNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<WorktreeNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly modelEmitter = new vscode.EventEmitter<void>();
  /** Fires after the worktrees were read again. */
  readonly onDidChangeModel = this.modelEmitter.event;

  private repositories: RepositoryWorktrees[] = [];
  private allRepositories: RepositoryWorktrees[] = [];
  private loading: Promise<void> | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor() {
    this.loading = this.load();
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.changeEmitter.dispose();
    this.modelEmitter.dispose();
  }

  /** Reads the worktrees again soon, once a burst of changes is over. */
  scheduleRefresh(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), REFRESH_DELAY_MS);
  }

  async refresh(): Promise<void> {
    clearTimeout(this.timer);
    this.loading = this.load();
    await this.loading;
  }

  private async load(): Promise<void> {
    try {
      const { all, withLinked } = await loadRepositories();
      this.allRepositories = all;
      this.repositories = withLinked;
    } catch {
      this.allRepositories = [];
      this.repositories = [];
    }
    this.changeEmitter.fire(undefined);
    this.modelEmitter.fire();
  }

  /** Every open repository, with or without linked worktrees. */
  async getAllRepositories(): Promise<RepositoryWorktrees[]> {
    await this.loading;
    return this.allRepositories;
  }

  /** The repositories the view lists: those with linked worktrees. */
  getRepositories(): readonly RepositoryWorktrees[] {
    return this.repositories;
  }

  getChildren(node?: WorktreeNode): WorktreeNode[] {
    if (!node) {
      if (this.repositories.length === 1) {
        return this.worktreeNodes(this.repositories[0]);
      }
      return this.repositories.map((repository) => ({ kind: 'repository', repository }));
    }
    return node.kind === 'repository' ? this.worktreeNodes(node.repository) : [];
  }

  private worktreeNodes(repository: RepositoryWorktrees): WorktreeNode[] {
    return repository.worktrees.map((worktree) => ({ kind: 'worktree', repository, worktree }));
  }

  getTreeItem(node: WorktreeNode): vscode.TreeItem {
    if (node.kind === 'repository') {
      const item = new vscode.TreeItem(path.basename(node.repository.mainRoot), vscode.TreeItemCollapsibleState.Expanded);
      item.description = node.repository.mainRoot;
      item.iconPath = new vscode.ThemeIcon('repo');
      item.contextValue = 'worktreeRepository';
      return item;
    }
    const { worktree, repository } = node;
    const current = isOpenInWindow(worktree);
    const item = new vscode.TreeItem(worktreeLabel(worktree), vscode.TreeItemCollapsibleState.None);
    const status = worktree.branch && !worktree.isMain ? repository.statuses.get(worktree.branch) : undefined;
    const location = worktree.isMain ? 'main worktree' : describeLocation(repository.mainRoot, worktree.path);
    item.description = [
      current ? 'this window' : undefined,
      location,
      worktree.branch ? undefined : 'detached',
      status ? describeBranchStatus(status) : undefined,
      worktree.locked ? 'locked' : undefined,
      worktree.prunable ? 'folder missing' : undefined,
    ]
      .filter(Boolean)
      .join(' · ');
    item.iconPath = new vscode.ThemeIcon(
      worktree.prunable ? 'warning' : worktree.locked ? 'lock' : current ? 'window' : worktree.isMain ? 'repo' : 'list-tree',
    );
    item.tooltip = this.tooltip(node, current, status);
    item.contextValue = `worktree.${worktree.isMain ? 'main' : 'linked'}${current ? '.current' : ''}`;
    return item;
  }

  private tooltip(node: WorktreeNode & { kind: 'worktree' }, current: boolean, status: BranchStatus | undefined): vscode.MarkdownString {
    const { worktree, repository } = node;
    const lines = [`**${worktreeLabel(worktree)}**${worktree.isMain ? ' (main worktree)' : ''}`, '', worktree.path];
    if (worktree.head) {
      lines.push('', `HEAD ${worktree.head.slice(0, 7)}${worktree.branch ? '' : ' (detached)'}`);
    }
    if (status) {
      lines.push('', describeBranchStatus(status, repository.defaultBranch));
    }
    if (worktree.locked) {
      lines.push('', `Locked${worktree.lockReason ? `: ${worktree.lockReason}` : ''}`);
    }
    if (worktree.prunable) {
      lines.push('', 'Its folder is missing; deleting it prunes it.');
    }
    if (current) {
      lines.push('', 'Open in this window');
    }
    const markdown = new vscode.MarkdownString(lines.join('\n'));
    markdown.supportHtml = false;
    return markdown;
  }
}
