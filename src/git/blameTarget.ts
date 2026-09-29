import * as path from 'path';
import * as vscode from 'vscode';
import { BlameOptions, blameFile, FileBlame } from './gitBlame';
import { resolveRepository } from './gitRepository';
import { GIT_SHOW_SCHEME, parseGitShowUri } from './gitShowContentProvider';

/** The URI schemes blame works for: files on disk and file revisions this extension opened. */
export const BLAMEABLE_SCHEMES = ['file', GIT_SHOW_SCHEME];

/** What to blame for a document: a working-tree file, or a file at a past revision. */
export interface BlameTarget {
  repoRoot: string;
  /** Path relative to the repository root, with forward slashes. */
  relativePath: string;
  /** Set for a document showing a past revision; its content is blamed at that revision. */
  revision?: string;
}

export async function resolveBlameTarget(uri: vscode.Uri): Promise<BlameTarget | undefined> {
  const revision = parseGitShowUri(uri);
  if (revision) {
    return { repoRoot: revision.repoRoot, relativePath: revision.relativePath, revision: revision.sha };
  }
  if (uri.scheme !== 'file') {
    return undefined;
  }
  const repo = await resolveRepository(uri);
  if (!repo) {
    return undefined;
  }
  return {
    repoRoot: repo.rootFsPath,
    relativePath: path.relative(repo.rootFsPath, uri.fsPath).split(path.sep).join('/'),
  };
}

export function blameTarget(
  target: BlameTarget,
  document: vscode.TextDocument,
  options: BlameOptions,
): Promise<FileBlame | undefined> {
  return blameFile({
    repoRoot: target.repoRoot,
    relativePath: target.relativePath,
    revision: target.revision,
    content: target.revision ? undefined : document.getText(),
    options,
  });
}
