import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { changeBlockForLine, splitLines } from '../util/changeBlock';
import { GitCliError, runGit } from './gitCli';

export interface LineDiffOptions {
  sha: string;
  /** Path of the file in that commit, relative to the repository root. */
  relativePath: string;
  /** 0-based line number within the commit's OWN version of the file (BlameInfo.originalLine). */
  line: number;
  repoRoot: string;
  signal?: AbortSignal;
}

/**
 * The block of lines a commit changed that holds its 0-based `line`, with the
 * lines around it, from the commit's own version of the file.
 */
export async function getLineDiffHunk(options: LineDiffOptions): Promise<string | undefined> {
  const { sha, relativePath, repoRoot, signal } = options;
  try {
    const [diff, content] = await Promise.all([
      runGit(['show', '--format=', '--no-color', '--no-ext-diff', '-U0', sha, '--', relativePath], {
        cwd: repoRoot,
        signal,
      }),
      runGit(['show', `${sha}:${relativePath}`], { cwd: repoRoot, signal }),
    ]);
    return changeBlockForLine(diff, splitLines(content), options.line + 1);
  } catch (err) {
    if (err instanceof GitCliError) {
      return undefined;
    }
    throw err;
  }
}

/**
 * The block of uncommitted changes holding the 0-based `line` of `content`,
 * the file's current text, unsaved edits included, compared with its last
 * commit. Git computes the diff, from temporary copies of both, so changes
 * line up exactly as they do for committed lines.
 */
export async function getUncommittedHunk(
  repoRoot: string,
  relativePath: string,
  content: string,
  line: number,
): Promise<string | undefined> {
  let committed = '';
  try {
    committed = await runGit(['show', `HEAD:${relativePath}`], { cwd: repoRoot });
  } catch (err) {
    // A file new since the last commit, or a repository without commits: every line is added.
    if (!(err instanceof GitCliError)) {
      throw err;
    }
  }
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gitblamesolo-diff-'));
  try {
    const committedFile = path.join(dir, 'committed');
    const currentFile = path.join(dir, 'current');
    await Promise.all([fs.promises.writeFile(committedFile, committed), fs.promises.writeFile(currentFile, content)]);
    // Run in the repository, so its diff settings apply as they do to committed lines.
    const output = await runGit(
      ['diff', '--no-index', '--no-color', '--no-ext-diff', '-U0', '--', committedFile, currentFile],
      { cwd: repoRoot, successExitCodes: [1] },
    );
    return changeBlockForLine(output, splitLines(content), line + 1);
  } catch (err) {
    if (err instanceof GitCliError) {
      return undefined;
    }
    throw err;
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

const ZERO_CONTEXT_HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Maps a 1-based line of a file's new version to the matching line of its old
 * version, given a zero-context diff (`git diff -U0`) between the two. A line
 * inside a changed block maps to the start of the block it replaced; a line
 * outside every block keeps its position, shifted by the blocks above it.
 */
export function mapLineToParent(diffText: string, newLine: number): number {
  let shift = 0;
  for (const row of diffText.split('\n')) {
    const match = ZERO_CONTEXT_HUNK_RE.exec(row);
    if (!match) {
      continue;
    }
    const oldStart = parseInt(match[1], 10);
    const oldCount = match[2] !== undefined ? parseInt(match[2], 10) : 1;
    const newStart = parseInt(match[3], 10);
    const newCount = match[4] !== undefined ? parseInt(match[4], 10) : 1;

    // With a count of 0, the start is the line *before* the insertion or deletion point.
    const newEnd = newCount === 0 ? newStart : newStart + newCount - 1;
    if (newLine < (newCount === 0 ? newStart + 1 : newStart)) {
      break;
    }
    if (newCount > 0 && newLine <= newEnd) {
      return Math.max(oldCount === 0 ? oldStart + 1 : oldStart, 1);
    }
    shift += oldCount - newCount;
  }
  return Math.max(newLine + shift, 1);
}

export interface ParentLineOptions {
  repoRoot: string;
  sha: string;
  /** Path in `sha`. */
  relativePath: string;
  parentSha: string;
  /** Path in `parentSha`; differs from `relativePath` when the commit renamed the file. */
  parentRelativePath: string;
  /** 0-based line in the file at `sha`. */
  line: number;
}

/** The 0-based line in the file at `parentSha` that corresponds to `line` at `sha`. */
export async function getParentLine(options: ParentLineOptions): Promise<number> {
  try {
    const output = await runGit(
      [
        'diff',
        '--no-color',
        '--no-ext-diff',
        '-U0',
        `${options.parentSha}:${options.parentRelativePath}`,
        `${options.sha}:${options.relativePath}`,
      ],
      { cwd: options.repoRoot },
    );
    return mapLineToParent(output, options.line + 1) - 1;
  } catch (err) {
    if (err instanceof GitCliError) {
      return options.line;
    }
    throw err;
  }
}
