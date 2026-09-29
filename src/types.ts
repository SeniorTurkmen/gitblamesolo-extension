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
  /** Path of the file in the blamed commit, relative to the repository root. */
  filename: string;
  /** The commit and path the line had before this commit changed it; absent when the commit created it. */
  previous?: { sha: string; filename: string };
}

export type FileChangeStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' | 'X';

export interface CommitFileChange {
  status: FileChangeStatus;
  path: string;
  oldPath?: string;
}

export type DiffLineKind = 'add' | 'del' | 'context' | 'meta';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  /** 1-based line number in the post-commit version of the file; only set for 'add'/'context' lines. */
  newLine?: number;
}

export interface DiffHunk {
  /** The raw "@@ -oldStart,oldCount +newStart,newCount @@" header line. */
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  hunks: DiffHunk[];
  truncated: boolean;
}

export interface CommitDetails {
  sha: string;
  authorName: string;
  authorEmail: string;
  authorTimestamp: number;
  committerTimestamp: number;
  summary: string;
  /** The message body without its "Co-authored-by" trailers. */
  body: string;
  /** People credited with "Co-authored-by" trailers, other than the author. */
  coAuthors: { name: string; email: string }[];
  files: CommitFileChange[];
}

/** Where the "Show Commit Details" panel was opened from, so it can mark and jump back to it. */
export interface SourceLocation {
  /** The document the commit was opened from: a file on disk or a past revision of one. */
  uri: string;
  /** Path of the file in the commit, relative to the repository root; differs from the current path after a rename. */
  commitPath: string;
  /** 0-based line in the CURRENT buffer; used as the jump-back target. */
  line: number;
  /** 1-based line number in the commit's own version of the file; used to find the matching diff row. */
  commitLine: number;
}
