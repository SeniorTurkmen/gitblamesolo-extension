import * as vscode from 'vscode';
import { runGit } from './gitCli';
import { getBuiltinGitApi } from './gitRepository';

/**
 * Fetches every remote of the repository, so the git log shows commits pushed
 * elsewhere. Goes through VS Code's git extension when it knows the repository,
 * which asks for credentials the way the Source Control view does; otherwise
 * runs git, which fails rather than waiting on a password prompt nobody sees.
 */
export async function fetchAllRemotes(repoRoot: string): Promise<void> {
  const repository = getBuiltinGitApi()?.getRepository(vscode.Uri.file(repoRoot));
  if (repository) {
    await repository.fetch({ all: true });
    return;
  }
  await runGit(['fetch', '--all'], { cwd: repoRoot, env: { GIT_TERMINAL_PROMPT: '0' } });
}
