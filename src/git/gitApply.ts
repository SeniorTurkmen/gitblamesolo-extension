import { runGit } from './gitCli';

/**
 * Reverses a single hunk's patch against the current working tree file.
 * Throws GitCliError (from gitCli) if the patch no longer applies cleanly
 * (e.g. the region was edited again since this commit) — the working tree
 * file is left untouched in that case.
 */
export async function applyPatchReverse(patch: string, repoRoot: string): Promise<void> {
  await runGit(['apply', '--reverse', '--whitespace=nowarn', '-'], { cwd: repoRoot, input: patch });
}
