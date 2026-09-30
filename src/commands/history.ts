import * as path from 'path';
import * as vscode from 'vscode';
import { getConfig } from '../config';
import { resolveBlameTarget } from '../git/blameTarget';
import { HistoryFilter } from '../git/gitHistory';
import { GitRepositoryContext, listRepositories, resolveRepository } from '../git/gitRepository';
import { HistoryPanel } from '../webview/historyPanel';

function settings() {
  const config = getConfig();
  return { dateStyle: config.dateStyle, currentUserLabel: config.currentUserLabel };
}

/** A URI passed by a menu: the Source Control view passes a repository or a changed file, other menus a URI. */
function uriFromMenuArg(arg: unknown): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri) {
    return arg;
  }
  if (arg && typeof arg === 'object') {
    const { rootUri, resourceUri } = arg as { rootUri?: unknown; resourceUri?: unknown };
    if (resourceUri instanceof vscode.Uri) {
      return resourceUri;
    }
    if (rootUri instanceof vscode.Uri) {
      return rootUri;
    }
  }
  return undefined;
}

/** The repository to show: the one passed by a menu, the active file's, or one the user picks. */
export async function pickRepository(arg: unknown): Promise<string | undefined> {
  const argUri = uriFromMenuArg(arg);
  if (argUri) {
    // resolveRepository looks up the directory a file is in, so for a directory ask about a file inside it.
    const isDirectory = await vscode.workspace.fs.stat(argUri).then(
      (stat) => (stat.type & vscode.FileType.Directory) !== 0,
      () => false,
    );
    const repo = await resolveRepository(isDirectory ? vscode.Uri.joinPath(argUri, 'file') : argUri);
    if (repo) {
      return repo.rootFsPath;
    }
  }
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active) {
    const target = await resolveBlameTarget(active);
    if (target) {
      return target.repoRoot;
    }
  }
  const repos = await listRepositories();
  if (repos.length <= 1) {
    if (repos.length === 0) {
      void vscode.window.showInformationMessage('Git Blame Solo: no git repository is open.');
    }
    return repos[0]?.rootFsPath;
  }
  const picked = await vscode.window.showQuickPick(
    repos.map((repo: GitRepositoryContext) => ({
      label: path.basename(repo.rootFsPath),
      description: repo.rootFsPath,
      root: repo.rootFsPath,
    })),
    { placeHolder: 'Pick a repository to show the git log of' },
  );
  return picked?.root;
}

/** Opens the git log of a repository, with the graph, for the current branch. */
export async function showHistory(arg?: unknown): Promise<void> {
  const repoRoot = await pickRepository(arg);
  if (repoRoot) {
    HistoryPanel.show(repoRoot, { scope: { kind: 'head' } }, settings);
  }
}

/** Opens the git log filtered to the commits that changed one file. */
export async function showFileHistory(arg?: unknown): Promise<void> {
  const uri = uriFromMenuArg(arg) ?? vscode.window.activeTextEditor?.document.uri;
  const target = uri ? await resolveBlameTarget(uri) : undefined;
  if (!target) {
    void vscode.window.showInformationMessage('Git Blame Solo: this file is not inside a git repository.');
    return;
  }
  // A past revision of the file shows the history from that revision back.
  const filter: HistoryFilter = {
    scope: target.revision ? { kind: 'ref', ref: target.revision } : { kind: 'head' },
    path: target.relativePath,
  };
  HistoryPanel.show(target.repoRoot, filter, settings);
}

/** Opens the git log of every branch, filtered to one author's commits. */
export function showAuthorHistory(repoRoot: string, author: string): void {
  HistoryPanel.show(repoRoot, { scope: { kind: 'all' }, author }, settings);
}
