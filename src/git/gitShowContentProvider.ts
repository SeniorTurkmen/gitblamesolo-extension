import * as path from 'path';
import * as vscode from 'vscode';
import { GitCliError, runGit } from './gitCli';

export const GIT_SHOW_SCHEME = 'gitBlameSoloShow';

interface GitShowUriPayload {
  sha: string;
  repoRoot: string;
  relativePath?: string;
}

/**
 * Builds a virtual document URI that resolves (via GitShowContentProvider) to
 * `git show <sha>:<relativePath>` — used as one side of a native `vscode.diff`
 * comparison so the diff opens in VS Code's real diff editor. Its path is the
 * file's path on disk, so VS Code matches it with the working file and doesn't
 * present the pair as a rename.
 */
export function buildGitShowUri(sha: string, repoRoot: string, relativePath: string): vscode.Uri {
  const payload: GitShowUriPayload = { sha, repoRoot, relativePath };
  return vscode.Uri.file(path.join(repoRoot, ...relativePath.split('/'))).with({
    scheme: GIT_SHOW_SCHEME,
    query: encodeURIComponent(JSON.stringify(payload)),
  });
}

/** Reads back what buildGitShowUri encoded; undefined for any other URI. */
export function parseGitShowUri(uri: vscode.Uri): { sha: string; repoRoot: string; relativePath: string } | undefined {
  if (uri.scheme !== GIT_SHOW_SCHEME) {
    return undefined;
  }
  try {
    const { sha, repoRoot, relativePath } = JSON.parse(decodeURIComponent(uri.query)) as GitShowUriPayload;
    // Earlier versions kept the repository-relative path as the URI's path; editors restored from then still have it.
    return { sha, repoRoot, relativePath: relativePath ?? uri.path.replace(/^\//, '') };
  } catch {
    return undefined;
  }
}

/** A file's content at a revision; empty when the file didn't exist there. */
export async function getFileAtRevision(sha: string, repoRoot: string, relativePath: string): Promise<string> {
  try {
    return await runGit(['show', `${sha}:${relativePath}`], { cwd: repoRoot });
  } catch (err) {
    if (err instanceof GitCliError) {
      // The file didn't exist at this revision (new file, or before the root commit) —
      // an empty document is the correct "not present" side of the diff.
      return '';
    }
    throw err;
  }
}

export class GitShowContentProvider implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const parsed = parseGitShowUri(uri);
    return parsed ? getFileAtRevision(parsed.sha, parsed.repoRoot, parsed.relativePath) : '';
  }
}
