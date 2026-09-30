import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getConfig } from '../config';
import { resolveBlameTarget } from '../git/blameTarget';
import { getHistoryPage, HistoryEntry } from '../git/gitHistory';
import { buildGitShowUri } from '../git/gitShowContentProvider';
import { formatDate } from '../util/dateFormat';
import { emojify } from '../util/emoji';

/** A file in a repository, by its path relative to the root. */
export interface RepoFile {
  repoRoot: string;
  relativePath: string;
}

/** Opens a file as it was in a commit, read-only. Blame and the hover work there too. */
export async function openFileAtRevision(repoRoot: string, sha: string, relativePath: string): Promise<void> {
  const uri = buildGitShowUri(sha, repoRoot, relativePath);
  try {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: true });
  } catch {
    void vscode.window.showWarningMessage(`Git Blame Solo: could not open ${relativePath} at ${sha.slice(0, 7)}.`);
  }
}

/**
 * Compares a file as it was in a commit with its working copy on disk. The
 * paths differ when the file was renamed since the commit.
 */
export async function compareWithWorkingFile(
  repoRoot: string,
  sha: string,
  revisionPath: string,
  workingPath: string,
): Promise<void> {
  const workingFile = path.join(repoRoot, ...workingPath.split('/'));
  if (!fs.existsSync(workingFile)) {
    void vscode.window.showInformationMessage(`Git Blame Solo: ${workingPath} no longer exists in your working copy.`);
    return;
  }
  const title = `${path.posix.basename(workingPath)} (${sha.slice(0, 7)} ↔ Working Copy)`;
  await vscode.commands.executeCommand(
    'vscode.diff',
    buildGitShowUri(sha, repoRoot, revisionPath),
    vscode.Uri.file(workingFile),
    title,
    { preview: true },
  );
}

/** The file of the active editor, or of a URI passed by a menu; a past revision counts as its file. */
export async function activeRepoFile(arg?: unknown): Promise<RepoFile | undefined> {
  const uri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
  const target = uri ? await resolveBlameTarget(uri) : undefined;
  if (!target) {
    void vscode.window.showInformationMessage('Git Blame Solo: this file is not inside a git repository.');
    return undefined;
  }
  return { repoRoot: target.repoRoot, relativePath: target.relativePath };
}

interface RevisionItem extends vscode.QuickPickItem {
  entry: HistoryEntry;
}

const PICK_LIMIT = 200;

/** Lets the user pick one of the commits that changed a file, newest first. */
export async function pickRevision(file: RepoFile, placeHolder: string): Promise<HistoryEntry | undefined> {
  const picker = vscode.window.createQuickPick<RevisionItem>();
  picker.title = `Commits that changed ${file.relativePath}`;
  picker.placeholder = placeHolder;
  picker.matchOnDescription = true;
  picker.busy = true;
  picker.show();

  const { dateStyle } = getConfig();
  void getHistoryPage({ ...file, scope: { kind: 'head' }, path: file.relativePath, skip: 0, limit: PICK_LIMIT }).then(
    (page) => {
      picker.busy = false;
      if (!page || page.entries.length === 0) {
        picker.placeholder = 'No commits changed this file.';
        return;
      }
      picker.items = page.entries.map((entry) => ({
        label: emojify(entry.summary),
        description: `${entry.sha.slice(0, 7)} · ${entry.authorName} · ${formatDate(entry.authorTimestamp, dateStyle)}`,
        detail: entry.path && entry.path !== file.relativePath ? `as ${entry.path}` : undefined,
        entry,
      }));
    },
  );

  return new Promise((resolve) => {
    picker.onDidAccept(() => {
      resolve(picker.selectedItems[0]?.entry);
      picker.hide();
    });
    picker.onDidHide(() => {
      resolve(undefined);
      picker.dispose();
    });
  });
}
