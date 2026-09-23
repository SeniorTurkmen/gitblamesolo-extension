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
  /** 1-based line number in the post-commit version of the file; only set for 'add'/'context' lines. */
  newLine?: number;
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

/** Where the "Show Commit Details" panel was opened from, so it can mark and jump back to it. */
export interface SourceLocation {
  filePath: string;
  /** 0-based line in the CURRENT buffer; used as the jump-back target. */
  line: number;
  /** 1-based line number in the commit's own version of the file; used to find the matching diff row. */
  commitLine: number;
}
