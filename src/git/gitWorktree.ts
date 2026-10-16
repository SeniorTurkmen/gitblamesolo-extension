import * as fs from 'fs';
import * as path from 'path';
import { GitCliError, runGit } from './gitCli';

/** A working tree of a repository, from `git worktree list --porcelain`. */
export interface Worktree {
  path: string;
  /** The checked-out commit; missing for a bare repository. */
  head?: string;
  /** The checked-out branch's short name; missing when HEAD is detached. */
  branch?: string;
  bare: boolean;
  /** The repository's own working tree, listed first, which can't be removed. */
  isMain: boolean;
  locked: boolean;
  lockReason?: string;
  /** Git can prune it, usually because its folder was deleted. */
  prunable: boolean;
}

/** Where new worktrees go: `.worktrees/` inside the main worktree, or `<repo>.worktrees/` next to it. */
export type WorktreeLayout = 'inRepo' | 'sibling';

export function parseWorktreeList(output: string): Worktree[] {
  const worktrees: Worktree[] = [];
  for (const block of output.replace(/\r\n/g, '\n').split(/\n\n+/)) {
    let current: Worktree | undefined;
    for (const line of block.split('\n')) {
      const space = line.indexOf(' ');
      const key = space < 0 ? line : line.slice(0, space);
      const value = space < 0 ? '' : line.slice(space + 1);
      if (key === 'worktree') {
        current = { path: value, bare: false, isMain: worktrees.length === 0, locked: false, prunable: false };
      } else if (!current) {
        continue;
      } else if (key === 'HEAD') {
        current.head = value;
      } else if (key === 'branch') {
        current.branch = value.replace(/^refs\/heads\//, '');
      } else if (key === 'bare') {
        current.bare = true;
      } else if (key === 'locked') {
        current.locked = true;
        current.lockReason = value || undefined;
      } else if (key === 'prunable') {
        current.prunable = true;
      }
    }
    if (current) {
      worktrees.push(current);
    }
  }
  return worktrees;
}

/** The worktrees of the repository `repoRoot` belongs to, main worktree first, then the linked ones by path. Empty when git fails. */
export async function listWorktrees(repoRoot: string): Promise<Worktree[]> {
  try {
    const [main, ...linked] = parseWorktreeList(await runGit(['worktree', 'list', '--porcelain'], { cwd: repoRoot }));
    // Git lists linked worktrees in the order the file system gives, which differs between systems.
    return main ? [main, ...linked.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))] : [];
  } catch (err) {
    if (err instanceof GitCliError) {
      return [];
    }
    throw err;
  }
}

function realpath(filePath: string): string {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

/** Compares two paths the way the file system does: through symlinks, and ignoring case on Windows and macOS. */
export function samePath(a: string, b: string): boolean {
  const left = realpath(a);
  const right = realpath(b);
  return process.platform === 'linux' ? left === right : left.toLowerCase() === right.toLowerCase();
}

export interface WorktreeIdentity {
  /** Whether this folder is a linked worktree rather than the repository's own working tree. */
  isLinked: boolean;
  /** The repository's shared git directory, the same for all its worktrees. */
  commonDir: string;
}

/** Tells a linked worktree, whose git directory differs from the repository's common one, from the main one. */
export async function getWorktreeIdentity(repoRoot: string): Promise<WorktreeIdentity | undefined> {
  try {
    const [gitDir, commonDir] = (await runGit(['rev-parse', '--git-dir', '--git-common-dir'], { cwd: repoRoot }))
      .split('\n')
      .map((line) => path.resolve(repoRoot, line.trim()));
    if (!gitDir || !commonDir) {
      return undefined;
    }
    return { isLinked: !samePath(gitDir, commonDir), commonDir: realpath(commonDir) };
  } catch (err) {
    if (err instanceof GitCliError) {
      return undefined;
    }
    throw err;
  }
}

/** The folder a layout keeps worktrees in, for the repository whose main worktree is `mainRoot`. */
export function layoutFolder(mainRoot: string, layout: WorktreeLayout): string {
  return layout === 'inRepo'
    ? path.join(mainRoot, '.worktrees')
    : path.join(path.dirname(mainRoot), `${path.basename(mainRoot)}.worktrees`);
}

function isInside(folder: string, filePath: string): boolean {
  const relative = path.relative(folder, filePath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Picks the layout the repository already uses, from how many worktrees each
 * folder holds (undefined when the folder doesn't exist). The folder with more
 * worktrees wins, the one inside the repository on a tie; with neither folder,
 * the user is asked.
 */
export function chooseLayout(inRepo: number | undefined, sibling: number | undefined): WorktreeLayout | undefined {
  if (inRepo === undefined && sibling === undefined) {
    return undefined;
  }
  if (sibling === undefined) {
    return 'inRepo';
  }
  if (inRepo === undefined) {
    return 'sibling';
  }
  return sibling > inRepo ? 'sibling' : 'inRepo';
}

/** The layout of an existing `.worktrees/` or `<repo>.worktrees/` folder, if there is one. */
export function detectLayout(mainRoot: string, worktrees: readonly Worktree[]): WorktreeLayout | undefined {
  const count = (layout: WorktreeLayout): number | undefined => {
    const folder = layoutFolder(mainRoot, layout);
    if (!fs.existsSync(folder)) {
      return undefined;
    }
    return worktrees.filter((worktree) => isInside(realpath(folder), realpath(worktree.path))).length;
  };
  return chooseLayout(count('inRepo'), count('sibling'));
}

/** How the panel names a worktree's location: relative to a layout's folder when it is in one. */
export function describeLocation(mainRoot: string, worktreePath: string): string {
  for (const layout of ['inRepo', 'sibling'] as const) {
    const folder = layoutFolder(mainRoot, layout);
    if (isInside(folder, worktreePath)) {
      return path.join(path.basename(folder), path.relative(folder, worktreePath));
    }
  }
  return worktreePath;
}

/** A folder name for a branch: one level, so `feature/login` becomes `feature-login`. */
export function worktreeFolderName(branch: string): string {
  return branch.replace(/[\\/]+/g, '-').replace(/^\.+/, '') || 'worktree';
}

/** A path in `folder` for the branch that no file or folder uses yet. */
export function freeWorktreePath(folder: string, branch: string, exists: (p: string) => boolean = fs.existsSync): string {
  const base = path.join(folder, worktreeFolderName(branch));
  let candidate = base;
  for (let n = 2; exists(candidate); n++) {
    candidate = `${base}-${n}`;
  }
  return candidate;
}

export type WorktreeSource =
  | { kind: 'newBranch'; branch: string; base: string }
  | { kind: 'branch'; branch: string }
  /** A remote branch, checked out as a new local branch that tracks it. */
  | { kind: 'remoteBranch'; branch: string; remoteBranch: string };

export function buildWorktreeAddArgs(worktreePath: string, source: WorktreeSource): string[] {
  switch (source.kind) {
    case 'newBranch':
      return ['worktree', 'add', '-b', source.branch, worktreePath, source.base];
    case 'branch':
      return ['worktree', 'add', worktreePath, source.branch];
    case 'remoteBranch':
      return ['worktree', 'add', '--track', '-b', source.branch, worktreePath, source.remoteBranch];
  }
}

export async function addWorktree(repoRoot: string, worktreePath: string, source: WorktreeSource): Promise<void> {
  await fs.promises.mkdir(path.dirname(worktreePath), { recursive: true });
  await runGit(buildWorktreeAddArgs(worktreePath, source), { cwd: repoRoot });
}

export async function removeWorktree(repoRoot: string, worktreePath: string, force: boolean): Promise<void> {
  await runGit(['worktree', 'remove', ...(force ? ['--force'] : []), worktreePath], { cwd: repoRoot });
}

export async function pruneWorktrees(repoRoot: string): Promise<void> {
  await runGit(['worktree', 'prune'], { cwd: repoRoot });
}

/** Whether the worktree has changes or untracked files that `git worktree remove` would refuse to delete. */
export async function hasLocalChanges(worktreePath: string): Promise<boolean> {
  try {
    return (await runGit(['status', '--porcelain'], { cwd: worktreePath })).trim().length > 0;
  } catch (err) {
    if (err instanceof GitCliError) {
      return false;
    }
    throw err;
  }
}

/** Whether git ignores `relativePath` in the repository at `repoRoot`. */
export async function isIgnored(repoRoot: string, relativePath: string): Promise<boolean> {
  // check-ignore exits with 1 when the path isn't ignored.
  const output = await runGit(['check-ignore', relativePath], { cwd: repoRoot, successExitCodes: [1] });
  return output.trim().length > 0;
}

/** Adds a line to the repository's .gitignore, on a line of its own. */
export async function appendToGitignore(mainRoot: string, line: string): Promise<void> {
  const file = path.join(mainRoot, '.gitignore');
  const existing = fs.existsSync(file) ? await fs.promises.readFile(file, 'utf8') : '';
  const separator = existing && !existing.endsWith('\n') ? '\n' : '';
  await fs.promises.writeFile(file, `${existing}${separator}${line}\n`, 'utf8');
}

export async function deleteBranch(repoRoot: string, branch: string): Promise<void> {
  // The panel already showed whether it is merged and the user chose to delete it, so -d's own check isn't needed.
  await runGit(['branch', '-D', branch], { cwd: repoRoot });
}

/** A branch on a remote, such as `refs/heads/feature/x` on `origin`. */
export interface RemoteBranch {
  remote: string;
  /** The full ref on the remote, as `refs/heads/feature/x`. */
  ref: string;
}

/** The branch's name on the remote, as `origin/feature/x`. */
export function remoteBranchLabel(remote: RemoteBranch): string {
  return `${remote.remote}/${remote.ref.replace(/^refs\/heads\//, '')}`;
}

export async function deleteRemoteBranch(repoRoot: string, remote: RemoteBranch): Promise<void> {
  await runGit(['push', remote.remote, '--delete', remote.ref], { cwd: repoRoot });
}

/** How a branch stands against the repository's default branch. */
export interface BranchStatus {
  /** Every commit of the branch is in the default branch (local or remote). */
  merged: boolean;
  /** Commits on the branch that the default branch doesn't have. */
  ahead: number;
  /** The branch tracked a remote branch that no longer exists, as after a merged pull request's branch is deleted. */
  upstreamGone: boolean;
  /** The remote branch it tracks, when that still exists. */
  remote?: RemoteBranch;
}

/** What a branch's upstream says about it. */
export interface UpstreamTrack {
  gone: boolean;
  remote?: RemoteBranch;
}

/** The `for-each-ref` format {@link parseUpstreamTracks} reads. */
const UPSTREAM_FORMAT = '%(refname:short)\t%(upstream:track)\t%(upstream:remotename)\t%(upstream:remoteref)';

/**
 * `%(refname:short) %(upstream:track) %(upstream:remotename) %(upstream:remoteref)`
 * lines, tab separated, into branch → its upstream. A branch tracking another
 * local branch (remote `.`) or a gone one has no remote branch.
 */
export function parseUpstreamTracks(output: string): Map<string, UpstreamTrack> {
  const result = new Map<string, UpstreamTrack>();
  for (const line of output.split('\n')) {
    const [name, track = '', remote = '', ref = ''] = line.replace(/\r$/, '').split('\t');
    if (!name) {
      continue;
    }
    const gone = track.includes('gone');
    result.set(name, gone || !remote || remote === '.' || !ref ? { gone } : { gone, remote: { remote, ref } });
  }
  return result;
}

/**
 * The branch the others are measured against: the remote's default branch
 * (`origin/HEAD`), else the main worktree's branch.
 */
export async function getDefaultBranch(repoRoot: string, mainBranch: string | undefined): Promise<string | undefined> {
  try {
    const remoteHead = (
      await runGit(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { cwd: repoRoot })
    ).trim();
    if (remoteHead) {
      return remoteHead;
    }
  } catch (err) {
    if (!(err instanceof GitCliError)) {
      throw err;
    }
  }
  return mainBranch;
}

async function revParses(repoRoot: string, ref: string): Promise<boolean> {
  try {
    await runGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether each branch is merged into the default branch, how far ahead it is,
 * and whether its upstream is gone. A branch merged into either the remote
 * default branch or its local copy counts as merged.
 */
export async function getBranchStatuses(
  repoRoot: string,
  defaultBranch: string | undefined,
  branches: readonly string[],
): Promise<Map<string, BranchStatus>> {
  const statuses = new Map<string, BranchStatus>();
  if (branches.length === 0) {
    return statuses;
  }
  const tracks = parseUpstreamTracks(
    await runGit(['for-each-ref', `--format=${UPSTREAM_FORMAT}`, 'refs/heads'], { cwd: repoRoot }).catch(
      () => '',
    ),
  );
  // origin/main and its local main: a branch merged locally but not yet pushed is merged too.
  const bases: string[] = [];
  if (defaultBranch) {
    bases.push(defaultBranch);
    const local = defaultBranch.replace(/^[^/]+\//, '');
    if (local !== defaultBranch && (await revParses(repoRoot, `refs/heads/${local}`))) {
      bases.push(local);
    }
  }
  const upstream = (branch: string) => {
    const track = tracks.get(branch);
    return track?.remote ? { upstreamGone: track.gone, remote: track.remote } : { upstreamGone: track?.gone ?? false };
  };
  await Promise.all(
    branches.map(async (branch) => {
      let ahead = 0;
      if (bases.length > 0) {
        const counts = await Promise.all(
          bases.map((base) =>
            runGit(['rev-list', '--count', `${base}..refs/heads/${branch}`], { cwd: repoRoot }).then(
              (out) => parseInt(out.trim(), 10) || 0,
              () => Number.NaN,
            ),
          ),
        );
        const known = counts.filter((count) => !Number.isNaN(count));
        ahead = known.length > 0 ? Math.min(...known) : 0;
        statuses.set(branch, { merged: known.length > 0 && ahead === 0, ahead, ...upstream(branch) });
      } else {
        statuses.set(branch, { merged: false, ahead, ...upstream(branch) });
      }
    }),
  );
  return statuses;
}

/** A short label for a branch's status: `merged`, `not merged · 3 commits ahead`, `upstream gone`, `on origin/x`. */
export function describeBranchStatus(status: BranchStatus | undefined, defaultBranch?: string): string {
  if (!status) {
    return '';
  }
  const parts: string[] = [];
  if (status.merged) {
    parts.push(defaultBranch ? `merged into ${defaultBranch}` : 'merged');
  } else {
    parts.push(`not merged · ${status.ahead} ${status.ahead === 1 ? 'commit' : 'commits'} ahead`);
  }
  if (status.upstreamGone) {
    parts.push('upstream gone');
  } else if (status.remote) {
    parts.push(`on ${remoteBranchLabel(status.remote)}`);
  }
  return parts.join(' · ');
}

/**
 * The folder new worktrees go in: the `worktrees.folder` setting (relative to
 * the main worktree) when set, else the layout the repository already uses.
 * Undefined when neither tells, so the user is asked.
 */
export function resolveWorktreeFolder(
  setting: string,
  mainRoot: string,
  worktrees: readonly Worktree[],
): { folder: string; layout?: WorktreeLayout } | undefined {
  if (setting.trim()) {
    return { folder: path.resolve(mainRoot, setting.trim()) };
  }
  const layout = detectLayout(mainRoot, worktrees);
  return layout && { folder: layoutFolder(mainRoot, layout), layout };
}

export type RemovalSkipReason = 'main' | 'current' | 'locked';

export interface RemovalPlan {
  remove: Worktree[];
  skip: { worktree: Worktree; reason: RemovalSkipReason }[];
}

/** Splits the worktrees to delete into those that can go and those that stay, with why. */
export function planRemoval(worktrees: readonly Worktree[], isOpenHere: (worktree: Worktree) => boolean): RemovalPlan {
  const plan: RemovalPlan = { remove: [], skip: [] };
  for (const worktree of worktrees) {
    const reason: RemovalSkipReason | undefined = worktree.isMain
      ? 'main'
      : isOpenHere(worktree)
        ? 'current'
        : worktree.locked
          ? 'locked'
          : undefined;
    if (reason) {
      plan.skip.push({ worktree, reason });
    } else {
      plan.remove.push(worktree);
    }
  }
  return plan;
}

/** The branches the user picked that aren't merged into the default branch, which deleting would lose. */
export function unmergedBranches(branches: readonly string[], statuses: ReadonlyMap<string, BranchStatus>): string[] {
  return branches.filter((branch) => !statuses.get(branch)?.merged);
}
