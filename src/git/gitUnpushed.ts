import { GitCliError, runGit } from './gitCli';

/** Past this many, older unpushed commits go unmarked rather than slowing every lookup. */
const MAX_UNPUSHED = 1000;

/**
 * The commits on the current branch that no remote branch contains yet. Undefined
 * when the repository has no remote branches, as then nothing has ever been pushed
 * and marking every commit would say nothing.
 */
export async function getUnpushedCommits(repoRoot: string): Promise<Set<string> | undefined> {
  try {
    const remotes = await runGit(['for-each-ref', '--count=1', '--format=%(refname)', 'refs/remotes'], { cwd: repoRoot });
    if (!remotes.trim()) {
      return undefined;
    }
    const output = await runGit(['rev-list', `--max-count=${MAX_UNPUSHED}`, 'HEAD', '--not', '--remotes'], {
      cwd: repoRoot,
    });
    return new Set(output.split('\n').filter(Boolean));
  } catch (err) {
    // An unborn HEAD, or not a repository.
    if (err instanceof GitCliError) {
      return undefined;
    }
    throw err;
  }
}

/** Remembers each repository's unpushed commits until a branch moves. */
export class UnpushedCache {
  private readonly byRepo = new Map<string, Promise<Set<string> | undefined>>();

  get(repoRoot: string): Promise<Set<string> | undefined> {
    let pending = this.byRepo.get(repoRoot);
    if (!pending) {
      pending = getUnpushedCommits(repoRoot);
      this.byRepo.set(repoRoot, pending);
    }
    return pending;
  }

  async isUnpushed(repoRoot: string, sha: string): Promise<boolean> {
    return (await this.get(repoRoot))?.has(sha) ?? false;
  }

  clear(): void {
    this.byRepo.clear();
  }
}
