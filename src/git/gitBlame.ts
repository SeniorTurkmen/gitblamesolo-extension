import * as path from 'path';
import { GitCliError, runGit } from './gitCli';
import { BlameInfo, ZERO_SHA } from '../types';

export interface BlameLineOptions {
  filePath: string;
  content: string;
  line: number;
  repoRoot: string;
  signal?: AbortSignal;
}

export function parsePorcelainBlame(porcelain: string, zeroBasedLine: number): BlameInfo {
  const lines = porcelain.split('\n');
  if (lines.length === 0 || lines[0].length === 0) {
    throw new Error('Empty git blame --porcelain output');
  }

  const header = lines[0].split(' ');
  const sha = header[0];

  let authorName = '';
  let authorEmail = '';
  let authorTimestamp = 0;
  let summary = '';

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('\t')) {
      break;
    }
    const spaceIndex = line.indexOf(' ');
    const key = spaceIndex === -1 ? line : line.slice(0, spaceIndex);
    const value = spaceIndex === -1 ? '' : line.slice(spaceIndex + 1);

    switch (key) {
      case 'author':
        authorName = value;
        break;
      case 'author-mail':
        authorEmail = value.replace(/^</, '').replace(/>$/, '');
        break;
      case 'author-time':
        authorTimestamp = parseInt(value, 10) || 0;
        break;
      case 'summary':
        summary = value;
        break;
      default:
        break;
    }
  }

  return {
    sha,
    isUncommitted: sha === ZERO_SHA,
    authorName,
    authorEmail,
    authorTimestamp,
    summary,
    line: zeroBasedLine,
  };
}

export async function blameLine(options: BlameLineOptions): Promise<BlameInfo | undefined> {
  const relativePath = path.relative(options.repoRoot, options.filePath).split(path.sep).join('/');
  const gitLine = options.line + 1;

  try {
    const output = await runGit(
      ['blame', '--porcelain', '--contents', '-', '-L', `${gitLine},${gitLine}`, '--', relativePath],
      { cwd: options.repoRoot, input: options.content, signal: options.signal },
    );
    return parsePorcelainBlame(output, options.line);
  } catch (err) {
    if (err instanceof GitCliError) {
      return undefined;
    }
    throw err;
  }
}
