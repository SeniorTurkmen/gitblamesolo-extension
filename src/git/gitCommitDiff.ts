import { GitCliError, runGit } from './gitCli';
import { DiffHunk, DiffLine, FileDiff } from '../types';

const MAX_LINES_PER_FILE = 400;
const FILE_HEADER_RE = /^diff --git a\/(.*) b\/(.*)$/;
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export async function getCommitDiff(sha: string, repoRoot: string, signal?: AbortSignal): Promise<FileDiff[]> {
  try {
    const output = await runGit(['show', '--format=', '--no-color', sha], { cwd: repoRoot, signal });
    return parseCommitDiff(output);
  } catch (err) {
    if (err instanceof GitCliError) {
      return [];
    }
    throw err;
  }
}

export function parseCommitDiff(raw: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | undefined;
  let currentHunk: DiffHunk | undefined;
  let newLineCounter = 0;
  let bodyLineCount = 0;

  const finishFile = () => {
    if (current) {
      files.push(current);
    }
    current = undefined;
    currentHunk = undefined;
    bodyLineCount = 0;
  };

  for (const line of raw.split('\n')) {
    const fileMatch = FILE_HEADER_RE.exec(line);
    if (fileMatch) {
      finishFile();
      const [, oldPath, newPath] = fileMatch;
      current = { path: newPath, oldPath: oldPath !== newPath ? oldPath : undefined, hunks: [], truncated: false };
      continue;
    }
    if (!current || current.truncated) {
      continue;
    }

    const hunkMatch = HUNK_HEADER_RE.exec(line);
    if (line.startsWith('Binary files')) {
      current.hunks.push({
        header: line,
        oldStart: 0,
        oldCount: 0,
        newStart: 0,
        newCount: 0,
        lines: [{ kind: 'meta', text: 'Binary file (diff not shown)' }],
      });
      currentHunk = undefined;
    } else if (hunkMatch) {
      const [, oldStart, oldCount, newStart, newCount] = hunkMatch;
      currentHunk = {
        header: line,
        oldStart: parseInt(oldStart, 10),
        oldCount: oldCount !== undefined ? parseInt(oldCount, 10) : 1,
        newStart: parseInt(newStart, 10),
        newCount: newCount !== undefined ? parseInt(newCount, 10) : 1,
        lines: [],
      };
      newLineCounter = currentHunk.newStart;
      current.hunks.push(currentHunk);
    } else if (currentHunk) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        currentHunk.lines.push({ kind: 'add', text: line.slice(1), newLine: newLineCounter });
        newLineCounter++;
        bodyLineCount++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        currentHunk.lines.push({ kind: 'del', text: line.slice(1) });
        bodyLineCount++;
      } else if (line.startsWith(' ')) {
        currentHunk.lines.push({ kind: 'context', text: line.slice(1), newLine: newLineCounter });
        newLineCounter++;
        bodyLineCount++;
      }
    }
    // Other lines (index/---/+++/mode/rename metadata) are already reflected
    // in the file header and status, so we skip rendering them in the body.

    if (bodyLineCount >= MAX_LINES_PER_FILE) {
      current.truncated = true;
    }
  }
  finishFile();
  return files;
}

/** A hunk with real content changes that can be reversed with `git apply --reverse`. */
export function isRevertibleHunk(hunk: DiffHunk): boolean {
  return hunk.oldCount + hunk.newCount > 0 && hunk.lines.some((l) => l.kind === 'add' || l.kind === 'del');
}

/** Builds a minimal unified-diff patch for a single hunk, suitable for `git apply --reverse`. */
export function buildHunkPatch(filePath: string, hunk: DiffHunk): string {
  const body = hunk.lines
    .filter((l): l is DiffLine & { kind: 'add' | 'del' | 'context' } => l.kind !== 'meta')
    .map((l) => `${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}${l.text}`)
    .join('\n');

  return [
    `diff --git a/${filePath} b/${filePath}`,
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`,
    body,
    '',
  ].join('\n');
}
