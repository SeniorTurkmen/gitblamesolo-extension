import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  BranchStatus,
  buildWorktreeAddArgs,
  chooseLayout,
  describeBranchStatus,
  describeLocation,
  detectLayout,
  freeWorktreePath,
  parseUpstreamTracks,
  parseWorktreeList,
  planRemoval,
  resolveWorktreeFolder,
  unmergedBranches,
  Worktree,
  worktreeFolderName,
} from '../../src/git/gitWorktree';

function worktree(fields: Partial<Worktree> & { path: string }): Worktree {
  return { bare: false, isMain: false, locked: false, prunable: false, ...fields };
}

describe('parseWorktreeList', () => {
  it('reads the main worktree and linked ones with their states', () => {
    const output = [
      'worktree /repo',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/main',
      '',
      'worktree /repo.worktrees/feature-login',
      'HEAD 2222222222222222222222222222222222222222',
      'branch refs/heads/feature/login',
      'locked on a USB drive',
      '',
      'worktree /tmp/detached',
      'HEAD 3333333333333333333333333333333333333333',
      'detached',
      'prunable gitdir file points to non-existent location',
      '',
    ].join('\n');
    assert.deepStrictEqual(parseWorktreeList(output), [
      worktree({ path: '/repo', head: '1111111111111111111111111111111111111111', branch: 'main', isMain: true }),
      worktree({
        path: '/repo.worktrees/feature-login',
        head: '2222222222222222222222222222222222222222',
        branch: 'feature/login',
        locked: true,
        lockReason: 'on a USB drive',
      }),
      worktree({ path: '/tmp/detached', head: '3333333333333333333333333333333333333333', prunable: true }),
    ]);
  });

  it('reads a bare main repository, a lock without a reason, and CRLF line ends', () => {
    const output = 'worktree /repo.git\r\nbare\r\n\r\nworktree /wt\r\nHEAD abc\r\nbranch refs/heads/x\r\nlocked\r\n';
    const [main, linked] = parseWorktreeList(output);
    assert.strictEqual(main.bare, true);
    assert.strictEqual(main.isMain, true);
    assert.strictEqual(linked.locked, true);
    assert.strictEqual(linked.lockReason, undefined);
    assert.strictEqual(linked.branch, 'x');
  });

  it('returns nothing for empty output', () => {
    assert.deepStrictEqual(parseWorktreeList(''), []);
  });
});

describe('chooseLayout', () => {
  it('uses the only folder that exists', () => {
    assert.strictEqual(chooseLayout(0, undefined), 'inRepo');
    assert.strictEqual(chooseLayout(undefined, 0), 'sibling');
  });

  it('prefers the folder with more worktrees, and the one inside the repository on a tie', () => {
    assert.strictEqual(chooseLayout(1, 3), 'sibling');
    assert.strictEqual(chooseLayout(3, 1), 'inRepo');
    assert.strictEqual(chooseLayout(2, 2), 'inRepo');
  });

  it('leaves it to the user when neither folder exists', () => {
    assert.strictEqual(chooseLayout(undefined, undefined), undefined);
  });
});

describe('detectLayout and resolveWorktreeFolder', () => {
  let parent: string;
  let mainRoot: string;

  beforeEach(() => {
    parent = fs.mkdtempSync(path.join(os.tmpdir(), 'gitblamesolo-layout-'));
    mainRoot = path.join(parent, 'repo');
    fs.mkdirSync(mainRoot);
  });

  afterEach(() => {
    fs.rmSync(parent, { recursive: true, force: true });
  });

  it('finds the folder holding the most worktrees', () => {
    fs.mkdirSync(path.join(mainRoot, '.worktrees', 'a'), { recursive: true });
    fs.mkdirSync(path.join(parent, 'repo.worktrees', 'b'), { recursive: true });
    fs.mkdirSync(path.join(parent, 'repo.worktrees', 'c'), { recursive: true });
    const worktrees = [
      worktree({ path: mainRoot, isMain: true }),
      worktree({ path: path.join(mainRoot, '.worktrees', 'a') }),
      worktree({ path: path.join(parent, 'repo.worktrees', 'b') }),
      worktree({ path: path.join(parent, 'repo.worktrees', 'c') }),
    ];
    assert.strictEqual(detectLayout(mainRoot, worktrees), 'sibling');
  });

  it('finds an empty .worktrees folder, and nothing without one', () => {
    assert.strictEqual(detectLayout(mainRoot, []), undefined);
    assert.strictEqual(resolveWorktreeFolder('', mainRoot, []), undefined);
    fs.mkdirSync(path.join(mainRoot, '.worktrees'));
    assert.strictEqual(detectLayout(mainRoot, []), 'inRepo');
    assert.deepStrictEqual(resolveWorktreeFolder('', mainRoot, []), {
      folder: path.join(mainRoot, '.worktrees'),
      layout: 'inRepo',
    });
  });

  it('uses the setting, relative to the main worktree, over any folder found', () => {
    fs.mkdirSync(path.join(mainRoot, '.worktrees'));
    assert.deepStrictEqual(resolveWorktreeFolder(' ../trees ', mainRoot, []), { folder: path.join(parent, 'trees') });
  });
});

describe('describeLocation', () => {
  const mainRoot = path.join(path.sep, 'src', 'repo');

  it('names worktrees by their layout folder', () => {
    assert.strictEqual(describeLocation(mainRoot, path.join(mainRoot, '.worktrees', 'x')), path.join('.worktrees', 'x'));
    assert.strictEqual(
      describeLocation(mainRoot, path.join(path.sep, 'src', 'repo.worktrees', 'y')),
      path.join('repo.worktrees', 'y'),
    );
  });

  it('shows the full path elsewhere', () => {
    const elsewhere = path.join(path.sep, 'tmp', 'z');
    assert.strictEqual(describeLocation(mainRoot, elsewhere), elsewhere);
  });
});

describe('worktree folder names', () => {
  it('flattens branch names to one folder', () => {
    assert.strictEqual(worktreeFolderName('feature/login/form'), 'feature-login-form');
    assert.strictEqual(worktreeFolderName('main'), 'main');
    assert.strictEqual(worktreeFolderName('.hidden'), 'hidden');
  });

  it('picks a path no file uses yet', () => {
    const taken = new Set([path.join('/f', 'feature-x'), path.join('/f', 'feature-x-2')]);
    assert.strictEqual(freeWorktreePath('/f', 'feature/x', (p) => taken.has(p)), path.join('/f', 'feature-x-3'));
    assert.strictEqual(freeWorktreePath('/f', 'other', (p) => taken.has(p)), path.join('/f', 'other'));
  });
});

describe('buildWorktreeAddArgs', () => {
  it('creates, checks out, or tracks a branch', () => {
    assert.deepStrictEqual(buildWorktreeAddArgs('/wt', { kind: 'newBranch', branch: 'x', base: 'origin/main' }), [
      'worktree',
      'add',
      '-b',
      'x',
      '/wt',
      'origin/main',
    ]);
    assert.deepStrictEqual(buildWorktreeAddArgs('/wt', { kind: 'branch', branch: 'x' }), ['worktree', 'add', '/wt', 'x']);
    assert.deepStrictEqual(buildWorktreeAddArgs('/wt', { kind: 'remoteBranch', branch: 'x', remoteBranch: 'origin/x' }), [
      'worktree',
      'add',
      '--track',
      '-b',
      'x',
      '/wt',
      'origin/x',
    ]);
  });
});

describe('branch status', () => {
  it('reads which branches lost their upstream, and the remote branch of the others', () => {
    const tracks = parseUpstreamTracks(
      [
        'main\t\t\t',
        'feature/a\t[gone]\torigin\trefs/heads/feature/a',
        'feature/b\t[ahead 2]\torigin\trefs/heads/feature/b',
        'feature/c\t\t.\trefs/heads/main\r',
        '',
      ].join('\n'),
    );
    assert.deepStrictEqual([...tracks], [
      ['main', { gone: false }],
      ['feature/a', { gone: true }],
      ['feature/b', { gone: false, remote: { remote: 'origin', ref: 'refs/heads/feature/b' } }],
      ['feature/c', { gone: false }],
    ]);
  });

  it('describes merged and unmerged branches', () => {
    assert.strictEqual(describeBranchStatus({ merged: true, ahead: 0, upstreamGone: true }, 'origin/main'), 'merged into origin/main · upstream gone');
    assert.strictEqual(describeBranchStatus({ merged: false, ahead: 1, upstreamGone: false }), 'not merged · 1 commit ahead');
    assert.strictEqual(describeBranchStatus({ merged: false, ahead: 4, upstreamGone: false }), 'not merged · 4 commits ahead');
    assert.strictEqual(
      describeBranchStatus({ merged: true, ahead: 0, upstreamGone: false, remote: { remote: 'origin', ref: 'refs/heads/x' } }),
      'merged · on origin/x',
    );
    assert.strictEqual(describeBranchStatus(undefined), '');
  });

  it('finds the picked branches that aren\'t merged', () => {
    const statuses = new Map<string, BranchStatus>([
      ['a', { merged: true, ahead: 0, upstreamGone: false }],
      ['b', { merged: false, ahead: 2, upstreamGone: false }],
    ]);
    // A branch with unknown status counts as unmerged, so the user is warned.
    assert.deepStrictEqual(unmergedBranches(['a', 'b', 'c'], statuses), ['b', 'c']);
  });
});

describe('planRemoval', () => {
  it('keeps the main worktree, the one open here, and locked ones', () => {
    const main = worktree({ path: '/repo', isMain: true });
    const open = worktree({ path: '/wt/open' });
    const locked = worktree({ path: '/wt/locked', locked: true });
    const dirty = worktree({ path: '/wt/dirty' });
    const plan = planRemoval([main, open, locked, dirty], (w) => w.path === '/wt/open');
    assert.deepStrictEqual(plan.remove, [dirty]);
    assert.deepStrictEqual(plan.skip, [
      { worktree: main, reason: 'main' },
      { worktree: open, reason: 'current' },
      { worktree: locked, reason: 'locked' },
    ]);
  });
});
