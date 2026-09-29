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

export interface BlameLine {
  commit: BlameCommit;
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
  filePath: string;
  content: string;
  repoRoot: string;
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
  originalLine: 0,
};

/**
 * Parses `git blame --incremental` output. Each group starts with
 * "<sha> <orig-line> <final-line> <line-count>", carries the commit's metadata
 * only the first time that commit appears, and ends with a "filename" line.
 */
export function parseIncrementalBlame(output: string): FileBlame {
  const commits = new Map<string, BlameCommit>();
  const lines: FileBlame = [];
  let group: { commit: BlameCommit; originalStart: number; finalStart: number; count: number } | undefined;

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
      case 'filename':
        for (let i = 0; i < group.count; i++) {
          lines[group.finalStart + i] = { commit: group.commit, originalLine: group.originalStart + i };
        }
        group = undefined;
        break;
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
  return { ...entry.commit, line, originalLine: entry.originalLine };
}

export function buildBlameArgs(relativePath: string, options: BlameOptions | undefined, ignoreRevsPath?: string): string[] {
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
  args.push('--contents', '-', '--', relativePath);
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
  const relativePath = path.relative(options.repoRoot, options.filePath).split(path.sep).join('/');
  const ignoreRevsPath = await existingIgnoreRevsPath(options.repoRoot, options.options?.ignoreRevsFile);

  try {
    const output = await runGit(buildBlameArgs(relativePath, options.options, ignoreRevsPath), {
      cwd: options.repoRoot,
      input: options.content,
    });
    return parseIncrementalBlame(output);
  } catch (err) {
    if (err instanceof GitCliError) {
      return undefined;
    }
    throw err;
  }
}
