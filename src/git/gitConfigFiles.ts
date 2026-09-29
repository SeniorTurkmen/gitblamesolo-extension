import * as os from 'os';
import * as path from 'path';
import { GitCliError, runGit } from './gitCli';

/**
 * The global config files git reads, which is where `user.email` usually
 * lives: $GIT_CONFIG_GLOBAL when set, otherwise the XDG file and ~/.gitconfig.
 */
export function globalGitConfigPaths(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string[] {
  if (env.GIT_CONFIG_GLOBAL) {
    return [path.resolve(env.GIT_CONFIG_GLOBAL)];
  }
  const xdgConfigHome = env.XDG_CONFIG_HOME || path.join(home, '.config');
  return [path.join(xdgConfigHome, 'git', 'config'), path.join(home, '.gitconfig')];
}

/** The repository's own config file, shared by all of its worktrees. */
export async function repositoryGitConfigPath(repoRoot: string): Promise<string | undefined> {
  try {
    const commonDir = (await runGit(['rev-parse', '--git-common-dir'], { cwd: repoRoot })).trim();
    return commonDir ? path.join(path.resolve(repoRoot, commonDir), 'config') : undefined;
  } catch (err) {
    if (err instanceof GitCliError) {
      return undefined;
    }
    throw err;
  }
}
