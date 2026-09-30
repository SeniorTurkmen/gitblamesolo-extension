import * as path from 'path';
import * as vscode from 'vscode';
import { GitCliError, runGit } from './gitCli';
import type { GitExtension } from '../types/git';

export interface GitRepositoryContext {
  rootUri: vscode.Uri;
  rootFsPath: string;
}

const cache = new Map<string, GitRepositoryContext | undefined>();

function getBuiltinGitApi() {
  const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!ext) {
    return undefined;
  }
  try {
    return ext.isActive ? ext.exports.getAPI(1) : undefined;
  } catch {
    return undefined;
  }
}

export async function resolveRepository(uri: vscode.Uri): Promise<GitRepositoryContext | undefined> {
  const folder = path.dirname(uri.fsPath);
  if (cache.has(folder)) {
    return cache.get(folder);
  }

  const result = await resolveUncached(uri);
  cache.set(folder, result);
  return result;
}

export function invalidateRepositoryCache(): void {
  cache.clear();
}

async function resolveUncached(uri: vscode.Uri): Promise<GitRepositoryContext | undefined> {
  const api = getBuiltinGitApi();
  if (api) {
    const repo = api.getRepository(uri);
    if (repo) {
      return { rootUri: repo.rootUri, rootFsPath: repo.rootUri.fsPath };
    }
  }

  try {
    const stdout = await runGit(['rev-parse', '--show-toplevel'], { cwd: path.dirname(uri.fsPath) });
    const rootFsPath = stdout.trim();
    if (!rootFsPath) {
      return undefined;
    }
    return { rootUri: vscode.Uri.file(rootFsPath), rootFsPath };
  } catch (err) {
    if (err instanceof GitCliError) {
      return undefined;
    }
    throw err;
  }
}

/** The repositories open in the window: the git extension's list, or the workspace folders inside a repository. */
export async function listRepositories(): Promise<GitRepositoryContext[]> {
  const api = getBuiltinGitApi();
  if (api && api.repositories.length > 0) {
    return api.repositories.map((repo) => ({ rootUri: repo.rootUri, rootFsPath: repo.rootUri.fsPath }));
  }
  const found = new Map<string, GitRepositoryContext>();
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    // resolveRepository looks up the directory a file is in, so ask about a (possibly missing) file in the folder.
    const repo = await resolveRepository(vscode.Uri.joinPath(folder.uri, 'file'));
    if (repo) {
      found.set(repo.rootFsPath, repo);
    }
  }
  return [...found.values()];
}
