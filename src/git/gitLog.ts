import { GitCliError, runGit } from './gitCli';
import { CommitDetails } from '../types';

const FIELD_SEP = '\x1f';
const FORMAT = ['%H', '%an', '%ae', '%at', '%ct', '%s', '%b'].join(FIELD_SEP);

export function parseCommitDetails(raw: string, sha: string): CommitDetails {
  const trimmed = raw.replace(/\n$/, '');
  const fields = trimmed.split(FIELD_SEP);
  const [rawSha, authorName, authorEmail, authorTime, committerTime, summary, body] = fields;

  return {
    sha: rawSha || sha,
    authorName: authorName ?? '',
    authorEmail: authorEmail ?? '',
    authorTimestamp: parseInt(authorTime, 10) || 0,
    committerTimestamp: parseInt(committerTime, 10) || 0,
    summary: summary ?? '',
    body: (body ?? '').trim(),
  };
}

export async function getCommitDetails(
  sha: string,
  repoRoot: string,
  signal?: AbortSignal,
): Promise<CommitDetails | undefined> {
  try {
    const output = await runGit(['show', '--quiet', `--format=${FORMAT}`, sha], {
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
