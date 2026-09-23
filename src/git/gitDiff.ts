import * as path from 'path';
import { GitCliError, runGit } from './gitCli';

const MAX_HUNK_LINES = 24;

export interface LineDiffOptions {
  sha: string;
  filePath: string;
  line: number;
  repoRoot: string;
  signal?: AbortSignal;
}

export async function getLineDiffHunk(options: LineDiffOptions): Promise<string | undefined> {
  const relativePath = path.relative(options.repoRoot, options.filePath).split(path.sep).join('/');
  const gitLine = options.line + 1;

  try {
    const output = await runGit(
      ['log', '--format=', `-L${gitLine},${gitLine}:${relativePath}`, '-1', options.sha],
      { cwd: options.repoRoot, signal: options.signal },
    );
    return extractHunk(output);
  } catch (err) {
    if (err instanceof GitCliError) {
      return undefined;
    }
    throw err;
  }
}

function extractHunk(diffText: string): string | undefined {
  const lines = diffText.split('\n');
  const startIdx = lines.findIndex((l) => l.startsWith('@@'));
  if (startIdx === -1) {
    return undefined;
  }

  const hunkLines = trimTrailingEmpty(lines.slice(startIdx));
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
