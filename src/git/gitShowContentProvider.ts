import * as vscode from 'vscode';
import { GitCliError, runGit } from './gitCli';

export const GIT_SHOW_SCHEME = 'gitBlameSoloShow';

interface GitShowUriPayload {
  sha: string;
  repoRoot: string;
}

/**
 * Builds a virtual document URI that resolves (via GitShowContentProvider) to
 * `git show <sha>:<relativePath>` — used as one side of a native `vscode.diff`
 * comparison so the diff opens in VS Code's real diff editor.
 */
export function buildGitShowUri(sha: string, repoRoot: string, relativePath: string): vscode.Uri {
  const payload: GitShowUriPayload = { sha, repoRoot };
  return vscode.Uri.from({
    scheme: GIT_SHOW_SCHEME,
    path: `/${relativePath}`,
    query: encodeURIComponent(JSON.stringify(payload)),
  });
}

/** Reads back what buildGitShowUri encoded; undefined for any other URI. */
export function parseGitShowUri(uri: vscode.Uri): { sha: string; repoRoot: string; relativePath: string } | undefined {
  if (uri.scheme !== GIT_SHOW_SCHEME) {
    return undefined;
  }
  try {
    const { sha, repoRoot } = JSON.parse(decodeURIComponent(uri.query)) as GitShowUriPayload;
    return { sha, repoRoot, relativePath: uri.path.replace(/^\//, '') };
  } catch {
    return undefined;
  }
}

export class GitShowContentProvider implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const parsed = parseGitShowUri(uri);
    if (!parsed) {
      return '';
    }
    const { sha, repoRoot, relativePath } = parsed;
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
}
