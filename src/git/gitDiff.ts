import * as path from 'path';
import { GitCliError, runGit } from './gitCli';

const MAX_HUNK_LINES = 30;
const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

export interface LineDiffOptions {
  sha: string;
  filePath: string;
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
  const relativePath = path.relative(options.repoRoot, options.filePath).split(path.sep).join('/');

  try {
    const output = await runGit(['show', '--format=', '--no-color', options.sha, '--', relativePath], {
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
