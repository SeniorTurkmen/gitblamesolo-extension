import { GitCliError, runGit } from './gitCli';

const MAX_HUNK_LINES = 30;
const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

export interface LineDiffOptions {
  sha: string;
  /** Path of the file in that commit, relative to the repository root. */
  relativePath: string;
  /** 0-based line number within the commit's OWN version of the file (BlameInfo.originalLine). */
  line: number;
  repoRoot: string;
  signal?: AbortSignal;
}

interface HunkHeader {
  newStart: number;
  newCount: number;
  lineIndex: number;
}

export async function getLineDiffHunk(options: LineDiffOptions): Promise<string | undefined> {
  try {
    const output = await runGit(['show', '--format=', '--no-color', options.sha, '--', options.relativePath], {
      cwd: options.repoRoot,
      signal: options.signal,
    });
    return extractHunkForLine(output, options.line + 1);
  } catch (err) {
    if (err instanceof GitCliError) {
      return undefined;
    }
    throw err;
  }
}

/**
 * A commit's diff is a sequence of hunks; we want the whole contiguous
 * block that contains our target line, not just that one line, so a
 * "this block was replaced with that block" change reads naturally.
 */
function extractHunkForLine(diffText: string, targetLine: number): string | undefined {
  const lines = diffText.split('\n');
  const headers: HunkHeader[] = [];

  lines.forEach((line, index) => {
    const match = HUNK_HEADER_RE.exec(line);
    if (match) {
      headers.push({
        newStart: parseInt(match[1], 10),
        newCount: match[2] !== undefined ? parseInt(match[2], 10) : 1,
        lineIndex: index,
      });
    }
  });

  const matching = headers.find(
    (h) => targetLine >= h.newStart && targetLine < h.newStart + Math.max(h.newCount, 1),
  );
  if (!matching) {
    return undefined;
  }

  const nextHeader = headers.find((h) => h.lineIndex > matching.lineIndex);
  const endIndex = nextHeader ? nextHeader.lineIndex : lines.length;
  const hunkLines = trimTrailingEmpty(lines.slice(matching.lineIndex, endIndex));
  if (hunkLines.length === 0) {
    return undefined;
  }

  if (hunkLines.length > MAX_HUNK_LINES) {
    const truncated = hunkLines.slice(0, MAX_HUNK_LINES);
    truncated.push(`… (${hunkLines.length - MAX_HUNK_LINES} more lines)`);
    return truncated.join('\n');
  }
  return hunkLines.join('\n');
}

function trimTrailingEmpty(lines: string[]): string[] {
  const copy = [...lines];
  while (copy.length && copy[copy.length - 1].trim() === '') {
    copy.pop();
  }
  return copy;
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
