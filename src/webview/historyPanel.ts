import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getBranches, getHistoryPage, HistoryEntry, HistoryFilter, HistoryScope } from '../git/gitHistory';
import { compareWithWorkingFile, openFileAtRevision } from '../commands/revision';
import { getCurrentUserEmail } from '../git/gitRemote';
import { DateStyle } from '../util/dateFormat';
import { layoutGraph } from '../util/historyGraph';
import { renderHistoryRows, renderHistoryShell } from './historyHtml';

const PAGE_SIZE = 200;

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'filter'; scope: string; search: string; author: string; path: string }
  | { type: 'more' }
  | { type: 'openCommit'; sha: string; path?: string }
  | { type: 'copySha'; sha: string }
  | { type: 'openFileAtCommit'; sha: string; path?: string }
  | { type: 'compareWithWorkingFile'; sha: string; path?: string }
  | { type: 'compareFrom'; sha: string };

export interface HistoryPanelSettings {
  dateStyle: DateStyle;
  currentUserLabel: string;
}

function parseScope(value: string): HistoryScope {
  if (value === 'all') {
    return { kind: 'all' };
  }
  if (value.startsWith('ref:')) {
    return { kind: 'ref', ref: value.slice('ref:'.length) };
  }
  return { kind: 'head' };
}

function realpath(filePath: string): string {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return filePath;
  }
}

/** Lists a repository's commits with their graph, one panel per repository. */
export class HistoryPanel {
  private static readonly panels = new Map<string, HistoryPanel>();

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private filter: HistoryFilter;
  private entries: HistoryEntry[] = [];
  /** Bumped on every reload, so a slow earlier page never lands after a newer one. */
  private generation = 0;

  static show(repoRoot: string, filter: HistoryFilter, getSettings: () => HistoryPanelSettings): void {
    // The git extension and git itself can name one repository by different paths through a symlink.
    const key = realpath(repoRoot);
    const existing = HistoryPanel.panels.get(key);
    if (existing) {
      existing.panel.reveal();
      void existing.setFilter(filter);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'gitBlameSoloHistory',
      HistoryPanel.title(repoRoot, filter),
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    HistoryPanel.panels.set(key, new HistoryPanel(panel, key, repoRoot, filter, getSettings));
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly key: string,
    private readonly repoRoot: string,
    filter: HistoryFilter,
    private readonly getSettings: () => HistoryPanelSettings,
  ) {
    this.panel = panel;
    this.filter = filter;
    this.panel.iconPath = new vscode.ThemeIcon('history');
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((message: WebviewMessage) => this.handleMessage(message), null, this.disposables);
    void this.setFilter(filter);
  }

  /** Renders the page for a filter; the page asks for the first commits once it has loaded. */
  private async setFilter(filter: HistoryFilter): Promise<void> {
    this.filter = filter;
    this.generation++;
    this.updateTitle();
    const branches = await getBranches(this.repoRoot);
    const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    this.panel.webview.html = renderHistoryShell({ filter, branches }, nonce);
  }

  private static title(repoRoot: string, filter: HistoryFilter): string {
    return filter.path ? `History: ${path.posix.basename(filter.path)}` : `Git Log: ${path.basename(repoRoot)}`;
  }

  private updateTitle(): void {
    this.panel.title = HistoryPanel.title(this.repoRoot, this.filter);
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.load(false);
        break;
      case 'filter':
        this.filter = {
          scope: parseScope(message.scope),
          search: message.search.trim() || undefined,
          author: message.author.trim() || undefined,
          path: message.path || undefined,
        };
        this.updateTitle();
        await this.load(false);
        break;
      case 'more':
        await this.load(true);
        break;
      case 'openCommit':
        // For a file's history, the commit details mark that file, by its path in the commit.
        await vscode.commands.executeCommand(
          'gitBlameSolo.showCommitDetails',
          message.sha,
          this.repoRoot,
          undefined,
          undefined,
          undefined,
          undefined,
          this.filter.path ? (message.path ?? this.filter.path) : undefined,
        );
        break;
      case 'openFileAtCommit':
        if (this.filter.path) {
          await openFileAtRevision(this.repoRoot, message.sha, message.path ?? this.filter.path);
        }
        break;
      case 'compareWithWorkingFile':
        if (this.filter.path) {
          // The file's path in the commit differs from its working copy's after a rename.
          await compareWithWorkingFile(this.repoRoot, message.sha, message.path ?? this.filter.path, this.filter.path);
        }
        break;
      case 'compareFrom':
        await vscode.commands.executeCommand('gitBlameSolo.compareRefs', this.repoRoot, message.sha);
        break;
      case 'copySha':
        await vscode.commands.executeCommand('gitBlameSolo.copyCommitHash', message.sha);
        break;
    }
  }

  private async load(append: boolean): Promise<void> {
    const generation = ++this.generation;
    const settings = this.getSettings();
    const [page, currentUserEmail] = await Promise.all([
      getHistoryPage({
        repoRoot: this.repoRoot,
        ...this.filter,
        skip: append ? this.entries.length : 0,
        limit: PAGE_SIZE,
      }),
      settings.currentUserLabel ? getCurrentUserEmail(this.repoRoot) : Promise.resolve(undefined),
    ]);
    if (generation !== this.generation) {
      return;
    }

    const previousCount = append ? this.entries.length : 0;
    this.entries = [...(append ? this.entries : []), ...(page?.entries ?? [])];
    // Filtering by author, message, or file drops commits in between, so the lines would connect the wrong commits.
    const showGraph = !this.filter.author && !this.filter.search && !this.filter.path;
    const graph = showGraph ? layoutGraph(this.entries) : undefined;
    const html = renderHistoryRows(this.entries.slice(previousCount), graph?.slice(previousCount), {
      dateStyle: settings.dateStyle,
      currentUserLabel: settings.currentUserLabel,
      currentUserEmail,
      fileActions: Boolean(this.filter.path),
    });

    const count = this.entries.length;
    const status = page
      ? `${count} ${count === 1 ? 'commit' : 'commits'}${page.hasMore ? ', more available' : ''}`
      : 'Could not read the history.';
    void this.panel.webview.postMessage({
      type: 'rows',
      html,
      append,
      hasMore: page?.hasMore ?? false,
      graphLanes: graph ? Math.max(0, ...graph.map((row) => row.width)) : 0,
      status,
      emptyText: page ? 'No commits match.' : 'Could not read the history of this repository.',
    });
  }

  private dispose(): void {
    HistoryPanel.panels.delete(this.key);
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}
