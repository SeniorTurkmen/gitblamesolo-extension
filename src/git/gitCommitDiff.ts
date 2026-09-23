import { GitCliError, runGit } from './gitCli';
import { DiffLine, FileDiff } from '../types';

const MAX_LINES_PER_FILE = 400;
const FILE_HEADER_RE = /^diff --git a\/(.*) b\/(.*)$/;
const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

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
  let newLineCounter = 0;

  for (const line of raw.split('\n')) {
    const fileMatch = FILE_HEADER_RE.exec(line);
    if (fileMatch) {
      current = finishFile(files, current);
      const [, oldPath, newPath] = fileMatch;
      current = { path: newPath, oldPath: oldPath !== newPath ? oldPath : undefined, lines: [], truncated: false };
      newLineCounter = 0;
      continue;
    }
    if (!current) {
      continue;
    }

    if (current.truncated) {
      continue;
    }

    const hunkMatch = HUNK_HEADER_RE.exec(line);
    if (line.startsWith('Binary files')) {
      current.lines.push({ kind: 'meta', text: 'Binary file (diff not shown)' });
    } else if (hunkMatch) {
      newLineCounter = parseInt(hunkMatch[1], 10);
      current.lines.push({ kind: 'hunk-header', text: line });
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      pushBodyLine(current, { kind: 'add', text: line.slice(1), newLine: newLineCounter });
      newLineCounter++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      pushBodyLine(current, { kind: 'del', text: line.slice(1) });
    } else if (line.startsWith(' ')) {
      pushBodyLine(current, { kind: 'context', text: line.slice(1), newLine: newLineCounter });
      newLineCounter++;
    }
    // Other lines (index/---/+++/mode/rename metadata) are already reflected
    // in the file header and status, so we skip rendering them in the body.
  }
  finishFile(files, current);
  return files;
}

function pushBodyLine(file: FileDiff, line: DiffLine): void {
  if (file.truncated) {
    return;
  }
  if (file.lines.length >= MAX_LINES_PER_FILE) {
    file.truncated = true;
    return;
  }
  file.lines.push(line);
}

function finishFile(files: FileDiff[], current: FileDiff | undefined): undefined {
  if (current) {
    files.push(current);
  }
  return undefined;
}
