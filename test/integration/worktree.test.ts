import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  addWorktree,
  deleteBranch,
  deleteRemoteBranch,
  getBranchStatuses,
  getDefaultBranch,
  getWorktreeIdentity,
  hasLocalChanges,
  isIgnored,
  listWorktrees,
  removeWorktree,
  samePath,
} from '../../src/git/gitWorktree';
import { removeRepo } from '../fixtures/tempRepo';

// Runs real git on temporary repositories.
describe('git worktrees', () => {
  let parent: string;
  let repoRoot: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });

  before(() => {
    parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gitblamesolo-worktree-')));
    repoRoot = path.join(parent, 'repo');
    fs.mkdirSync(repoRoot);
    git('init', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test User');
    fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'one\n');
    fs.writeFileSync(path.join(repoRoot, '.gitignore'), '.worktrees/\n');
    git('add', '.');
    git('commit', '-m', 'First');
  });

  after(() => {
    removeRepo(parent);
  });

  it('adds, lists, and tells linked worktrees from the main one', async () => {
    const merged = path.join(parent, 'repo.worktrees', 'merged');
    const unmerged = path.join(repoRoot, '.worktrees', 'feature-unmerged');
    await addWorktree(repoRoot, merged, { kind: 'newBranch', branch: 'merged', base: 'main' });
    await addWorktree(repoRoot, unmerged, { kind: 'newBranch', branch: 'feature/unmerged', base: 'main' });

    const worktrees = await listWorktrees(repoRoot);
    assert.deepStrictEqual(
      worktrees.map((w) => [w.branch, w.isMain]),
      [
        ['main', true],
        ['merged', false],
        ['feature/unmerged', false],
      ],
    );
    assert.ok(samePath(worktrees[1].path, merged));

    const mainIdentity = await getWorktreeIdentity(repoRoot);
    const linkedIdentity = await getWorktreeIdentity(unmerged);
    assert.strictEqual(mainIdentity?.isLinked, false);
    assert.strictEqual(linkedIdentity?.isLinked, true);
    assert.strictEqual(linkedIdentity?.commonDir, mainIdentity?.commonDir);
    // Listing from a linked worktree gives the same list.
    assert.strictEqual((await listWorktrees(unmerged)).length, 3);
  });

  it('measures branches against the main branch', async () => {
    const unmerged = path.join(repoRoot, '.worktrees', 'feature-unmerged');
    fs.writeFileSync(path.join(unmerged, 'b.txt'), 'two\n');
    execFileSync('git', ['add', 'b.txt'], { cwd: unmerged });
    execFileSync('git', ['commit', '-m', 'Second'], { cwd: unmerged });

    const base = await getDefaultBranch(repoRoot, 'main');
    assert.strictEqual(base, 'main');
    const statuses = await getBranchStatuses(repoRoot, base, ['merged', 'feature/unmerged']);
    assert.deepStrictEqual(statuses.get('merged'), { merged: true, ahead: 0, upstreamGone: false });
    assert.deepStrictEqual(statuses.get('feature/unmerged'), { merged: false, ahead: 1, upstreamGone: false });
  });

  it('checks .gitignore and local changes', async () => {
    assert.strictEqual(await isIgnored(repoRoot, '.worktrees/'), true);
    assert.strictEqual(await isIgnored(repoRoot, 'a.txt'), false);
    const unmerged = path.join(repoRoot, '.worktrees', 'feature-unmerged');
    assert.strictEqual(await hasLocalChanges(unmerged), false);
    fs.writeFileSync(path.join(unmerged, 'scratch.txt'), 'draft\n');
    assert.strictEqual(await hasLocalChanges(unmerged), true);
  });

  it('removes worktrees, forcing past local changes, and deletes their branches', async () => {
    const unmerged = path.join(repoRoot, '.worktrees', 'feature-unmerged');
    await assert.rejects(removeWorktree(repoRoot, unmerged, false));
    await removeWorktree(repoRoot, unmerged, true);
    await removeWorktree(repoRoot, path.join(parent, 'repo.worktrees', 'merged'), false);
    await deleteBranch(repoRoot, 'feature/unmerged');

    assert.deepStrictEqual(
      (await listWorktrees(repoRoot)).map((w) => w.branch),
      ['main'],
    );
    assert.ok(!fs.existsSync(unmerged));
    assert.deepStrictEqual(git('branch', '--format=%(refname:short)').trim().split('\n'), ['main', 'merged']);
  });

  it('finds the remote branch a branch tracks and deletes it there', async () => {
    const remoteRoot = path.join(parent, 'remote.git');
    execFileSync('git', ['init', '--bare', '-b', 'main', remoteRoot]);
    git('remote', 'add', 'origin', remoteRoot);
    git('push', '-u', 'origin', 'main', 'merged');

    const status = (await getBranchStatuses(repoRoot, 'main', ['merged'])).get('merged');
    assert.deepStrictEqual(status?.remote, { remote: 'origin', ref: 'refs/heads/merged' });

    await deleteRemoteBranch(repoRoot, status!.remote!);
    const remoteBranches = execFileSync('git', ['branch', '--format=%(refname:short)'], { cwd: remoteRoot, encoding: 'utf8' });
    assert.deepStrictEqual(remoteBranches.trim().split('\n'), ['main']);
    // The local branch is untouched, and now has nothing to delete on the remote.
    const after = (await getBranchStatuses(repoRoot, 'main', ['merged'])).get('merged');
    assert.strictEqual(after?.upstreamGone, true);
    assert.strictEqual(after?.remote, undefined);
  });
});
