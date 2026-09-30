import { CommitFileChange } from '../types';
import { GitCliError, runGit } from './gitCli';
import { parseNameStatus } from './gitLog';

async function gitOrUndefined(args: string[], repoRoot: string): Promise<string | undefined> {
  try {
    return await runGit(args, { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    if (err instanceof GitCliError) {
      return undefined;
    }
    throw err;
  }
}

/**
 * The files that differ between two revisions, with renames detected; without
 * `right`, between `left` and the working copy. Undefined when git fails.
 */
export async function getChangedFiles(
  repoRoot: string,
  left: string,
  right?: string,
): Promise<CommitFileChange[] | undefined> {
  const revisions = right ? [left, right] : [left];
  const output = await gitOrUndefined(['diff', '--name-status', '-M', '--no-color', ...revisions, '--'], repoRoot);
  return output === undefined ? undefined : parseNameStatus(output);
}

/** The commit two revisions last had in common, or undefined for unrelated histories. */
export async function getMergeBase(repoRoot: string, a: string, b: string): Promise<string | undefined> {
  return (await gitOrUndefined(['merge-base', a, b], repoRoot))?.trim() || undefined;
}

/** Tag names, newest first. */
export async function getTags(repoRoot: string): Promise<string[]> {
  const output = await gitOrUndefined(['tag', '--sort=-creatordate'], repoRoot);
  return output ? output.split('\n').filter(Boolean) : [];
}

/** The commit a ref names, or undefined when it names none. */
export async function resolveCommit(repoRoot: string, ref: string): Promise<string | undefined> {
  if (!ref || ref.startsWith('-')) {
    return undefined;
  }
  return (await gitOrUndefined(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], repoRoot))?.trim() || undefined;
}
