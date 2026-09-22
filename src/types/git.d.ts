// Minimal subset of microsoft/vscode's built-in git extension API,
// vendored from extensions/git/src/api/git.d.ts (trimmed to what this
// extension needs: resolving a repository's root for a given file URI).
import { Uri } from 'vscode';

export interface Repository {
  readonly rootUri: Uri;
}

export interface API {
  readonly repositories: Repository[];
  getRepository(uri: Uri): Repository | null;
}

export interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): API;
}
