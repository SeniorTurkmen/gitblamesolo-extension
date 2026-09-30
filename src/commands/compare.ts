import * as path from 'path';
import * as vscode from 'vscode';
import { getChangedFiles, getTags, resolveCommit } from '../git/gitCompare';
import { getBranches } from '../git/gitHistory';
import { buildGitShowUri } from '../git/gitShowContentProvider';
import { CommitFileChange } from '../types';
import { pickRepository } from './history';
import { activeRepoFile, pickRevision } from './revision';

/** One side of a comparison: a commit, by the name the user picked it by, or the working copy. */
export interface CompareSide {
  label: string;
  sha?: string;
}

const WORKING_COPY: CompareSide = { label: 'Working Copy' };

interface RefItem extends vscode.QuickPickItem {
  ref?: string;
  workingCopy?: boolean;
  enterRef?: boolean;
}

/** Lets the user pick a branch, tag, or any commit; the working copy too when `allowWorkingCopy`. */
async function pickRef(repoRoot: string, title: string, allowWorkingCopy: boolean): Promise<CompareSide | undefined> {
  const [branches, tags] = await Promise.all([getBranches(repoRoot), getTags(repoRoot)]);
  const separator = (label: string): RefItem => ({ label, kind: vscode.QuickPickItemKind.Separator });
  const refItems = (refs: string[], icon: string): RefItem[] =>
    refs.map((ref) => ({
      label: `$(${icon}) ${ref}`,
      description: ref === branches.current ? 'current branch' : undefined,
      ref,
    }));
  const items: RefItem[] = [
    ...(allowWorkingCopy ? [{ label: '$(file) Working Copy', description: 'your files on disk', workingCopy: true }] : []),
    { label: '$(edit) Enter a commit hash or ref…', enterRef: true },
    ...(branches.local.length ? [separator('Branches'), ...refItems(branches.local, 'git-branch')] : []),
    ...(branches.remote.length ? [separator('Remote branches'), ...refItems(branches.remote, 'cloud')] : []),
    ...(tags.length ? [separator('Tags'), ...refItems(tags, 'tag')] : []),
  ];
  const picked = await vscode.window.showQuickPick(items, { title, placeHolder: 'Pick a branch, tag, or commit' });
  if (!picked) {
    return undefined;
  }
  if (picked.workingCopy) {
    return WORKING_COPY;
  }
  const ref = picked.enterRef
    ? await vscode.window.showInputBox({
        title,
        prompt: 'A commit hash, branch, tag, or expression such as HEAD~3',
        validateInput: async (value) =>
          (await resolveCommit(repoRoot, value.trim())) ? undefined : 'No commit by that name in this repository.',
      })
    : picked.ref;
  const sha = ref && (await resolveCommit(repoRoot, ref.trim()));
  return sha ? { label: ref.trim(), sha } : undefined;
}

function sideLabel(side: CompareSide): string {
  // A hash reads better shortened; a branch or tag name stays as typed.
  return side.sha && side.label === side.sha ? side.sha.slice(0, 7) : side.label;
}

function sideUri(repoRoot: string, side: CompareSide, relativePath: string): vscode.Uri {
  return side.sha
    ? buildGitShowUri(side.sha, repoRoot, relativePath)
    : vscode.Uri.file(path.join(repoRoot, ...relativePath.split('/')));
}

/** The resources of the multi-diff editor for the files that differ; a side the file is missing from is left out. */
export function changeResources(
  repoRoot: string,
  left: CompareSide,
  right: CompareSide,
  files: CommitFileChange[],
): [vscode.Uri, vscode.Uri | undefined, vscode.Uri | undefined][] {
  return files.map((file) => [
    vscode.Uri.file(path.join(repoRoot, ...file.path.split('/'))),
    file.status === 'A' ? undefined : sideUri(repoRoot, left, file.oldPath ?? file.path),
    file.status === 'D' ? undefined : sideUri(repoRoot, right, file.path),
  ]);
}

/** Opens every file that differs between two sides in one multi-diff editor. */
export async function compareSides(repoRoot: string, left: CompareSide, right: CompareSide): Promise<void> {
  if (!left.sha) {
    return;
  }
  const files = await getChangedFiles(repoRoot, left.sha, right.sha);
  const title = `${sideLabel(left)} ↔ ${sideLabel(right)}`;
  if (!files) {
    void vscode.window.showWarningMessage(`Git Blame Solo: could not compare ${title}.`);
    return;
  }
  if (files.length === 0) {
    void vscode.window.showInformationMessage(`Git Blame Solo: no files differ between ${title}.`);
    return;
  }
  await vscode.commands.executeCommand('vscode.changes', title, changeResources(repoRoot, left, right, files));
}

/**
 * Compares two branches, tags, or commits, or one with the working copy.
 * `baseArg` skips the first pick, as when comparing from a commit in the git log.
 */
export async function compareRefs(repoRootArg?: unknown, baseArg?: string): Promise<void> {
  const repoRoot = typeof repoRootArg === 'string' ? repoRootArg : await pickRepository(repoRootArg);
  if (!repoRoot) {
    return;
  }
  const baseSha = baseArg && (await resolveCommit(repoRoot, baseArg));
  const left = baseSha
    ? { label: baseArg, sha: baseSha }
    : await pickRef(repoRoot, 'Compare: pick the base (left side)', false);
  if (!left) {
    return;
  }
  const right = await pickRef(repoRoot, `Compare ${sideLabel(left)} with…`, true);
  if (right) {
    await compareSides(repoRoot, left, right);
  }
}

/** Compares one file between two of the commits that changed it. */
export async function compareFileRevisions(arg?: unknown): Promise<void> {
  const file = await activeRepoFile(arg);
  const older = file && (await pickRevision(file, 'Pick the first commit (left side)'));
  if (!file || !older) {
    return;
  }
  const newer = await pickRevision(file, `Pick a commit to compare with ${older.sha.slice(0, 7)}`);
  if (!newer) {
    return;
  }
  const olderPath = older.path ?? file.relativePath;
  const newerPath = newer.path ?? file.relativePath;
  const title = `${path.posix.basename(newerPath)} (${older.sha.slice(0, 7)} ↔ ${newer.sha.slice(0, 7)})`;
  await vscode.commands.executeCommand(
    'vscode.diff',
    buildGitShowUri(older.sha, file.repoRoot, olderPath),
    buildGitShowUri(newer.sha, file.repoRoot, newerPath),
    title,
    { preview: true },
  );
}
