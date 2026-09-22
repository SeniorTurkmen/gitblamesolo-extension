export const ZERO_SHA = '0'.repeat(40);

export interface BlameInfo {
  sha: string;
  isUncommitted: boolean;
  authorName: string;
  authorEmail: string;
  authorTimestamp: number;
  summary: string;
  line: number;
}

export type FileChangeStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' | 'X';

export interface CommitFileChange {
  status: FileChangeStatus;
  path: string;
  oldPath?: string;
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
