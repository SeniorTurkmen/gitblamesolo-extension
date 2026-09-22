import { GitCliError, runGit } from './gitCli';
import { CommitDetails, CommitFileChange, FileChangeStatus } from '../types';

const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';
const FORMAT = ['%H', '%an', '%ae', '%at', '%ct', '%s', '%b'].join(FIELD_SEP) + RECORD_SEP;

function parseNameStatus(text: string): CommitFileChange[] {
  const files: CommitFileChange[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    const parts = line.split('\t');
    const rawStatus = parts[0];
    const status = rawStatus.charAt(0) as FileChangeStatus;

    if (parts.length >= 3) {
      // Rename/copy: "R100\told\tnew"
      files.push({ status, path: parts[2], oldPath: parts[1] });
    } else if (parts.length === 2) {
      files.push({ status, path: parts[1] });
    }
  }
  return files;
}

export function parseCommitDetails(raw: string, sha: string): CommitDetails {
  const recordSepIndex = raw.indexOf(RECORD_SEP);
  const headerPart = recordSepIndex === -1 ? raw : raw.slice(0, recordSepIndex);
  const filesPart = recordSepIndex === -1 ? '' : raw.slice(recordSepIndex + 1);

  const fields = headerPart.split(FIELD_SEP);
  const [rawSha, authorName, authorEmail, authorTime, committerTime, summary, body] = fields;

  return {
    sha: rawSha || sha,
    authorName: authorName ?? '',
    authorEmail: authorEmail ?? '',
    authorTimestamp: parseInt(authorTime, 10) || 0,
    committerTimestamp: parseInt(committerTime, 10) || 0,
    summary: summary ?? '',
    body: (body ?? '').trim(),
    files: parseNameStatus(filesPart),
  };
}

export async function getCommitDetails(
  sha: string,
  repoRoot: string,
  signal?: AbortSignal,
): Promise<CommitDetails | undefined> {
  try {
    const output = await runGit(['show', `--format=${FORMAT}`, '--name-status', sha], {
      cwd: repoRoot,
      signal,
    });
    return parseCommitDetails(output, sha);
  } catch (err) {
    if (err instanceof GitCliError) {
      return undefined;
    }
    throw err;
  }
}
