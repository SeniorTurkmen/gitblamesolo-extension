import * as fs from 'fs';
import * as path from 'path';
import { GitCliError, runGit } from './gitCli';
import { BlameInfo, ZERO_SHA } from '../types';

/** Commit metadata shared by every line that commit is blamed for. */
export interface BlameCommit {
  sha: string;
  isUncommitted: boolean;
  authorName: string;
  authorEmail: string;
  authorTimestamp: number;
  summary: string;
}

/** Where a group of lines came from within its commit; shared by the lines of that group. */
export interface BlameOrigin {
  /** Path of the file in the blamed commit (differs from the current path after a rename). */
  filename: string;
  /** The commit and path the lines had before this commit changed them; absent for lines the commit created from nothing. */
  previous?: { sha: string; filename: string };
}

export interface BlameLine {
  commit: BlameCommit;
  origin: BlameOrigin;
  /** 0-based line number within the blamed commit's own version of the file. */
  originalLine: number;
}

/** Blame for every line of a file, indexed by 0-based line in the blamed contents. */
export type FileBlame = BlameLine[];

export type MovedLinesDetection = 'off' | 'withinFile' | 'acrossFiles';

export interface BlameOptions {
  ignoreWhitespace: boolean;
  detectMovedLines: MovedLinesDetection;
  /** Path relative to the repository root; skipped when empty or missing. */
  ignoreRevsFile: string;
}

export interface BlameFileOptions {
  repoRoot: string;
  /** Path relative to the repository root, with forward slashes. */
  relativePath: string;
  /** Blame the file as it is at this revision. Without one, `content` is blamed as the working-tree version. */
  revision?: string;
  content?: string;
  options?: BlameOptions;
}

const HEADER_PATTERN = /^([0-9a-f]{40,64}) (\d+) (\d+) (\d+)$/;

export const UNCOMMITTED_LINE: BlameLine = {
  commit: {
    sha: ZERO_SHA,
    isUncommitted: true,
    authorName: '',
    authorEmail: '',
    authorTimestamp: 0,
    summary: '',
  },
  origin: { filename: '' },
  originalLine: 0,
};

/**
 * Undoes git's C-style path quoting: paths with special or non-ASCII
 * characters are written as "dosya \303\274.txt", octal escapes being UTF-8 bytes.
 */
export function unquoteGitPath(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"') || value.length < 2) {
    return value;
  }
  const escapes: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };
  const bytes: number[] = [];
  const body = value.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf8'));
      continue;
    }
    const next = body[i + 1];
    if (/[0-7]/.test(next ?? '')) {
      bytes.push(parseInt(body.slice(i + 1, i + 4), 8));
      i += 3;
    } else if (next !== undefined && next in escapes) {
      bytes.push(escapes[next]);
      i += 1;
    } else {
      bytes.push(92);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/**
 * Parses `git blame --incremental` output. Each group starts with
 * "<sha> <orig-line> <final-line> <line-count>", carries the commit's metadata
 * only the first time that commit appears, and ends with a "filename" line.
 */
export function parseIncrementalBlame(output: string): FileBlame {
  const commits = new Map<string, BlameCommit>();
  const lines: FileBlame = [];
  let group:
    | { commit: BlameCommit; originalStart: number; finalStart: number; count: number; previous?: BlameOrigin['previous'] }
    | undefined;

  for (const row of output.split('\n')) {
    if (!group) {
      const match = HEADER_PATTERN.exec(row);
      if (!match) {
        continue;
      }
      const sha = match[1];
      let commit = commits.get(sha);
      if (!commit) {
        commit = {
          sha,
          isUncommitted: /^0+$/.test(sha),
          authorName: '',
          authorEmail: '',
          authorTimestamp: 0,
          summary: '',
        };
        commits.set(sha, commit);
      }
      group = {
        commit,
        originalStart: parseInt(match[2], 10) - 1,
        finalStart: parseInt(match[3], 10) - 1,
        count: parseInt(match[4], 10),
      };
      continue;
    }

    const spaceIndex = row.indexOf(' ');
    const key = spaceIndex === -1 ? row : row.slice(0, spaceIndex);
    const value = spaceIndex === -1 ? '' : row.slice(spaceIndex + 1);

    switch (key) {
      case 'author':
        group.commit.authorName = value;
        break;
      case 'author-mail':
        group.commit.authorEmail = value.replace(/^</, '').replace(/>$/, '');
        break;
      case 'author-time':
        group.commit.authorTimestamp = parseInt(value, 10) || 0;
        break;
      case 'summary':
        group.commit.summary = value;
        break;
      case 'previous': {
        const separator = value.indexOf(' ');
        if (separator !== -1) {
          group.previous = { sha: value.slice(0, separator), filename: unquoteGitPath(value.slice(separator + 1)) };
        }
        break;
      }
      case 'filename': {
        // Ends the group. Unlike the commit metadata, "previous" and "filename" are written for every group.
        const origin: BlameOrigin = { filename: unquoteGitPath(value), previous: group.previous };
        for (let i = 0; i < group.count; i++) {
          lines[group.finalStart + i] = { commit: group.commit, origin, originalLine: group.originalStart + i };
        }
        group = undefined;
        break;
      }
      default:
        break;
    }
  }

  return lines;
}

export function toBlameInfo(fileBlame: FileBlame | undefined, line: number): BlameInfo | undefined {
  const entry = fileBlame?.[line];
  if (!entry) {
    return undefined;
  }
  return {
    ...entry.commit,
    line,
    originalLine: entry.originalLine,
    filename: entry.origin.filename,
    previous: entry.origin.previous,
  };
}

export function buildBlameArgs(
  relativePath: string,
  options: BlameOptions | undefined,
  ignoreRevsPath?: string,
  revision?: string,
): string[] {
  const args = ['blame', '--incremental'];
  if (options?.ignoreWhitespace) {
    args.push('-w');
  }
  if (options?.detectMovedLines === 'withinFile') {
    args.push('-M');
  } else if (options?.detectMovedLines === 'acrossFiles') {
    args.push('-M', '-C');
  }
  if (ignoreRevsPath) {
    args.push('--ignore-revs-file', ignoreRevsPath);
  }
  if (revision) {
    args.push(revision, '--', relativePath);
  } else {
    args.push('--contents', '-', '--', relativePath);
  }
  return args;
}

async function existingIgnoreRevsPath(repoRoot: string, file: string | undefined): Promise<string | undefined> {
  if (!file) {
    return undefined;
  }
  const absolute = path.resolve(repoRoot, file);
  try {
    return (await fs.promises.stat(absolute)).isFile() ? absolute : undefined;
  } catch {
    return undefined;
  }
}

export async function blameFile(options: BlameFileOptions): Promise<FileBlame | undefined> {
  const ignoreRevsPath = await existingIgnoreRevsPath(options.repoRoot, options.options?.ignoreRevsFile);
  const args = buildBlameArgs(options.relativePath, options.options, ignoreRevsPath, options.revision);

  try {
    const output = await runGit(args, {
      cwd: options.repoRoot,
      input: options.revision ? undefined : (options.content ?? ''),
    });
    return parseIncrementalBlame(output);
  } catch (err) {
    if (err instanceof GitCliError) {
      return undefined;
    }
    throw err;
  }
}
