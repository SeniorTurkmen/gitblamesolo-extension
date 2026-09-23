export const ZERO_SHA = '0'.repeat(40);

export interface BlameInfo {
  sha: string;
  isUncommitted: boolean;
  authorName: string;
  authorEmail: string;
  authorTimestamp: number;
  summary: string;
  line: number;
  /** 0-based line number within the blamed commit's own version of the file. */
  originalLine: number;
}

export type FileChangeStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' | 'X';

export interface CommitFileChange {
  status: FileChangeStatus;
  path: string;
  oldPath?: string;
}

export type DiffLineKind = 'add' | 'del' | 'context' | 'hunk-header' | 'meta';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  lines: DiffLine[];
  truncated: boolean;
}

export interface CommitDetails {
  sha: string;
  authorName: string;
  authorEmail: string;
  authorTimestamp: number;
  committerTimestamp: number;
  summary: string;
  body: string;
  files: CommitFileChange[];
}
