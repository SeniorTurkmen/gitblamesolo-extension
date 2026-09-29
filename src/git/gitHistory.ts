import { GitCliError, runGit } from './gitCli';

const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';
const FORMAT = RECORD_SEP + ['%H', '%P', '%an', '%ae', '%at', '%s', '%D'].join(FIELD_SEP);

export type RefKind = 'head' | 'branch' | 'remote' | 'tag';

/** A branch, remote branch, or tag pointing at a commit, from `git log --decorate`. */
export interface CommitRef {
  kind: RefKind;
  name: string;
}

export interface HistoryEntry {
  sha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorTimestamp: number;
  summary: string;
  refs: CommitRef[];
  /** For a file's history, the file's path in this commit, which differs from the current path before a rename. */
  path?: string;
}

/** Which commits to walk: those reachable from HEAD, from every branch, remote branch, and tag, or from one ref. */
export type HistoryScope = { kind: 'head' } | { kind: 'all' } | { kind: 'ref'; ref: string };

export interface HistoryFilter {
  scope: HistoryScope;
  /** Only commits whose author name or email contains this text, ignoring case. */
  author?: string;
  /** Only commits whose message contains this text, ignoring case. */
  search?: string;
  /** Only commits that changed this file (repository-relative), following renames. */
  path?: string;
}

export interface HistoryPageOptions extends HistoryFilter {
  repoRoot: string;
  skip: number;
  limit: number;
}

export interface HistoryPage {
  entries: HistoryEntry[];
  /** Whether more commits match after this page. */
  hasMore: boolean;
}

/**
 * Parses the `%D` decoration: "HEAD -> main, origin/main, tag: v1.0". A
 * detached HEAD reads as just "HEAD".
 */
export function parseRefs(decoration: string, remoteNames: readonly string[] = ['origin']): CommitRef[] {
  const refs: CommitRef[] = [];
  for (const part of decoration.split(', ')) {
    const name = part.trim();
    if (!name) {
      continue;
    }
    if (name === 'HEAD') {
      refs.push({ kind: 'head', name: 'HEAD' });
    } else if (name.startsWith('HEAD -> ')) {
      refs.push({ kind: 'head', name: 'HEAD' }, { kind: 'branch', name: name.slice('HEAD -> '.length) });
    } else if (name.startsWith('tag: ')) {
      refs.push({ kind: 'tag', name: name.slice('tag: '.length) });
    } else if (name.endsWith('/HEAD')) {
      // "origin/HEAD" only says which branch the remote defaults to.
      continue;
    } else if (remoteNames.some((remote) => name.startsWith(`${remote}/`))) {
      refs.push({ kind: 'remote', name });
    } else {
      refs.push({ kind: 'branch', name });
    }
  }
  return refs;
}

export function parseHistory(output: string, remoteNames?: readonly string[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const record of output.split(RECORD_SEP).slice(1)) {
    const [sha, parents, authorName, authorEmail, authorTime, summary, rest] = record
      .replace(/\n+$/, '')
      .split(FIELD_SEP);
    if (!sha) {
      continue;
    }
    // With --name-only, the file names follow the decoration on lines of their own.
    const [decoration, ...files] = (rest ?? '').split('\n');
    const path = files.filter(Boolean).pop();
    entries.push({
      sha,
      parents: parents ? parents.split(' ') : [],
      authorName: authorName ?? '',
      authorEmail: authorEmail ?? '',
      authorTimestamp: parseInt(authorTime, 10) || 0,
      summary: summary ?? '',
      refs: parseRefs(decoration, remoteNames),
      ...(path ? { path } : {}),
    });
  }
  return entries;
}

export function buildHistoryArgs(options: Omit<HistoryPageOptions, 'repoRoot'>): string[] {
  const args = ['log', `--format=${FORMAT}`, '--decorate=short', '--no-color', '--date-order'];
  if (options.author || options.search) {
    // Match the text as typed rather than as a regular expression.
    args.push('--regexp-ignore-case', '--fixed-strings');
  }
  if (options.author) {
    args.push(`--author=${options.author}`);
  }
  if (options.search) {
    args.push(`--grep=${options.search}`);
  }
  // One extra commit tells whether there is another page.
  args.push(`--skip=${options.skip}`, `--max-count=${options.limit + 1}`);

  if (options.scope.kind === 'all') {
    // Not --all, which would also list stashes.
    args.push('--branches', '--remotes', '--tags', 'HEAD');
  } else if (options.scope.kind === 'ref') {
    args.push(options.scope.ref);
  } else {
    args.push('HEAD');
  }
  if (options.path) {
    // --name-only gives the file's path in each commit, which --follow tracks across renames.
    args.push('--name-only', '--follow', '--', options.path);
  } else {
    // Keeps a ref named like a file from being read as a path.
    args.push('--');
  }
  return args;
}

async function remoteNames(repoRoot: string): Promise<string[]> {
  try {
    return (await runGit(['remote'], { cwd: repoRoot })).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/** One page of commits, newest first. Undefined when git fails, for example in a repository with no commits. */
export async function getHistoryPage(options: HistoryPageOptions): Promise<HistoryPage | undefined> {
  try {
    const [output, remotes] = await Promise.all([
      runGit(buildHistoryArgs(options), { cwd: options.repoRoot, maxBuffer: 64 * 1024 * 1024 }),
      remoteNames(options.repoRoot),
    ]);
    const entries = parseHistory(output, remotes);
    return { entries: entries.slice(0, options.limit), hasMore: entries.length > options.limit };
  } catch (err) {
    if (err instanceof GitCliError) {
      return undefined;
    }
    throw err;
  }
}

export interface BranchList {
  current?: string;
  local: string[];
  remote: string[];
}

/** Local and remote branch names for the branch picker, current branch first. */
export async function getBranches(repoRoot: string): Promise<BranchList> {
  try {
    const output = await runGit(
      ['for-each-ref', '--format=%(HEAD)%(refname)', '--sort=-committerdate', 'refs/heads', 'refs/remotes'],
      { cwd: repoRoot },
    );
    const list: BranchList = { local: [], remote: [] };
    for (const line of output.split('\n')) {
      const isCurrent = line.startsWith('*');
      const refname = line.slice(1).trim();
      if (refname.startsWith('refs/heads/')) {
        const name = refname.slice('refs/heads/'.length);
        list.local.push(name);
        if (isCurrent) {
          list.current = name;
        }
      } else if (refname.startsWith('refs/remotes/') && !refname.endsWith('/HEAD')) {
        list.remote.push(refname.slice('refs/remotes/'.length));
      }
    }
    return list;
  } catch (err) {
    if (err instanceof GitCliError) {
      return { local: [], remote: [] };
    }
    throw err;
  }
}
