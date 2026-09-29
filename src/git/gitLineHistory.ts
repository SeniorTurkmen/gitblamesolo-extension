import { unquoteGitPath } from './gitBlame';
import { GitCliError, runGit } from './gitCli';

const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';
const FORMAT = RECORD_SEP + ['%H', '%an', '%ae', '%at', '%s'].join(FIELD_SEP);
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/** One commit that changed the traced lines. */
export interface LineHistoryEntry {
  sha: string;
  authorName: string;
  authorEmail: string;
  authorTimestamp: number;
  summary: string;
  /** Path of the file in this commit. */
  path: string;
  /** Path of the file in the commit's parent; differs from `path` when the commit renamed it, absent when it added the file. */
  oldPath?: string;
  /** 0-based line where the traced lines start in this commit's version of the file. */
  line: number;
}

export interface LineHistoryOptions {
  repoRoot: string;
  /** Start tracing from this commit, usually the one blame reports for the line. */
  sha: string;
  /** Path of the file in `sha`. */
  relativePath: string;
  /** 0-based line in the file at `sha`. */
  line: number;
  maxCount?: number;
}

/** Strips the "a/" or "b/" prefix from a path on a "---" or "+++" diff line. */
function diffPath(value: string): string | undefined {
  const unquoted = unquoteGitPath(value.trim());
  if (unquoted === '/dev/null') {
    return undefined;
  }
  return unquoted.replace(/^[ab]\//, '');
}

/**
 * Parses `git log -L` output. Each commit starts with a record separator and
 * its fields, followed by a diff limited to the traced lines, which gives the
 * file's path in that commit and where the lines are in it.
 */
export function parseLineHistory(output: string): LineHistoryEntry[] {
  const entries: LineHistoryEntry[] = [];
  for (const record of output.split(RECORD_SEP).slice(1)) {
    const rows = record.split('\n');
    const [sha, authorName, authorEmail, authorTime, summary] = rows[0].split(FIELD_SEP);
    if (!sha) {
      continue;
    }
    let path: string | undefined;
    let oldPath: string | undefined;
    let line: number | undefined;
    // Only the file header precedes the first hunk; after it, a removed "-- x" line would read as "--- x".
    for (const row of rows.slice(1)) {
      const hunk = HUNK_HEADER.exec(row);
      if (hunk) {
        line = Math.max(parseInt(hunk[1], 10) - 1, 0);
        break;
      }
      if (row.startsWith('--- ')) {
        oldPath = diffPath(row.slice(4));
      } else if (row.startsWith('+++ ')) {
        path = diffPath(row.slice(4));
      }
    }
    if (path === undefined) {
      continue;
    }
    entries.push({
      sha,
      authorName: authorName ?? '',
      authorEmail: authorEmail ?? '',
      authorTimestamp: parseInt(authorTime, 10) || 0,
      summary: summary ?? '',
      path,
      oldPath,
      line: line ?? 0,
    });
  }
  return entries;
}

/** The commits that changed a line, newest first, following it across edits and renames. */
export async function getLineHistory(options: LineHistoryOptions): Promise<LineHistoryEntry[] | undefined> {
  const line = options.line + 1;
  try {
    const output = await runGit(
      [
        'log',
        `-L${line},${line}:${options.relativePath}`,
        `--format=${FORMAT}`,
        '--no-color',
        '--no-ext-diff',
        `--max-count=${options.maxCount ?? 100}`,
        options.sha,
      ],
      { cwd: options.repoRoot },
    );
    return parseLineHistory(output);
  } catch (err) {
    if (err instanceof GitCliError) {
      return undefined;
    }
    throw err;
  }
}
