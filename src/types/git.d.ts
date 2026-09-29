// Minimal subset of microsoft/vscode's built-in git extension API,
// vendored from extensions/git/src/api/git.d.ts (trimmed to what this
// extension needs: resolving a repository's root for a given file URI and
// noticing when a repository's HEAD moves).
import { Event, Uri } from 'vscode';

export interface Ref {
  readonly name?: string;
  readonly commit?: string;
}

export interface RepositoryState {
  readonly HEAD: Ref | undefined;
  readonly onDidChange: Event<void>;
}

export interface Repository {
  readonly rootUri: Uri;
  readonly state: RepositoryState;
}

export interface API {
  readonly repositories: Repository[];
  readonly onDidOpenRepository: Event<Repository>;
  readonly onDidCloseRepository: Event<Repository>;
  getRepository(uri: Uri): Repository | null;
}

export interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): API;
}
