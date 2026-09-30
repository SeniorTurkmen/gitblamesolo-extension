import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyPatchReverse } from '../../src/git/gitApply';
import { blameFile, toBlameInfo } from '../../src/git/gitBlame';
import { buildHunkPatch, getCommitDiff, isRevertibleHunk } from '../../src/git/gitCommitDiff';
import { getChangedFiles, getMergeBase, getTags, resolveCommit } from '../../src/git/gitCompare';
import { getLineDiffHunk, getParentLine, getUncommittedHunk } from '../../src/git/gitDiff';
import { getBranches, getHistoryPage } from '../../src/git/gitHistory';
import { getLineHistory } from '../../src/git/gitLineHistory';
import { repositoryGitConfigPath } from '../../src/git/gitConfigFiles';
import { getCommitDetails, getCommitMessage } from '../../src/git/gitLog';
import { getUnpushedCommits } from '../../src/git/gitUnpushed';
import { repoRelativePath } from '../../src/git/repoRelativePath';
import { removeRepo } from '../fixtures/tempRepo';
import { clearRemoteCaches, getCommitLink, getCurrentUserEmail } from '../../src/git/gitRemote';

function git(repoRoot: string, args: string[]): void {
  execFileSync('git', args, { cwd: repoRoot });
}

/** A fresh repository with a fixed identity and no line-ending conversion, so results match on every OS. */
function initRepo(prefix: string): string {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(repoRoot, ['init', '--initial-branch=main']);
  git(repoRoot, ['config', 'user.email', 'test@example.com']);
  git(repoRoot, ['config', 'user.name', 'Test User']);
  git(repoRoot, ['config', 'core.autocrlf', 'false']);
  return repoRoot;
}

function relativeTo(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

async function blameLine(options: { filePath: string; content: string; line: number; repoRoot: string }) {
  const relativePath = relativeTo(options.repoRoot, options.filePath);
  return toBlameInfo(await blameFile({ ...options, relativePath }), options.line);
}

describe('git blame integration', () => {
  let repoRoot: string;
  let filePath: string;

  before(() => {
    repoRoot = initRepo('gitblamesolo-');

    filePath = path.join(repoRoot, 'file.txt');
    fs.writeFileSync(filePath, 'line one\nline two\n');
    git(repoRoot, ['add', 'file.txt']);
    git(repoRoot, ['commit', '-m', 'First commit']);

    fs.writeFileSync(filePath, 'line one\nline two changed\nline three\n');
    git(repoRoot, ['add', 'file.txt']);
    git(repoRoot, ['commit', '-m', 'Second commit']);
  });

  after(() => {
    removeRepo(repoRoot);
  });

  it('resolves a committed line to its commit', async () => {
    const content = fs.readFileSync(filePath, 'utf8');
    const blame = await blameLine({ filePath, content, line: 0, repoRoot });

    assert.ok(blame);
    assert.strictEqual(blame!.isUncommitted, false);
    assert.strictEqual(blame!.summary, 'First commit');
  });

  it('resolves a line modified by the latest commit', async () => {
    const content = fs.readFileSync(filePath, 'utf8');
    const blame = await blameLine({ filePath, content, line: 1, repoRoot });

    assert.ok(blame);
    assert.strictEqual(blame!.summary, 'Second commit');
  });

  it('marks an unsaved buffer edit as uncommitted', async () => {
    const dirtyContent = 'line one\nline two changed\nline three EDITED\n';
    const blame = await blameLine({ filePath, content: dirtyContent, line: 2, repoRoot });

    assert.ok(blame);
    assert.strictEqual(blame!.isUncommitted, true);
  });

  it('blames unsaved text that matches the committed text to its commit, even after lines moved', async () => {
    // What the re-blame after an edit relies on: a line edited back to its committed text is no longer uncommitted.
    const dirtyContent = 'new first line\nline one\nline two changed\nline three\n';
    const blame = await blameLine({ filePath, content: dirtyContent, line: 2, repoRoot });

    assert.ok(blame);
    assert.strictEqual(blame!.isUncommitted, false);
    assert.strictEqual(blame!.summary, 'Second commit');
    assert.strictEqual(blame!.originalLine, 1);
  });

  it('fetches full commit details by sha', async () => {
    const content = fs.readFileSync(filePath, 'utf8');
    const blame = await blameLine({ filePath, content, line: 1, repoRoot });
    assert.ok(blame);

    const details = await getCommitDetails(blame!.sha, repoRoot);
    assert.ok(details);
    assert.strictEqual(details!.summary, 'Second commit');
    assert.strictEqual(details!.authorEmail, 'test@example.com');
    assert.deepStrictEqual(details!.files, [{ status: 'M', path: 'file.txt' }]);
  });

  it('shows the whole changed block, not just the single line', async () => {
    const content = fs.readFileSync(filePath, 'utf8');
    const blame = await blameLine({ filePath, content, line: 1, repoRoot });
    assert.ok(blame);

    const hunk = await getLineDiffHunk({ sha: blame!.sha, relativePath: blame!.filename, line: blame!.originalLine, repoRoot });
    assert.ok(hunk);
    assert.ok(hunk!.startsWith('@@'));
    assert.ok(hunk!.includes('-line two'));
    assert.ok(hunk!.includes('+line two changed'));
    assert.ok(hunk!.includes('+line three'));
  });

  it('produces a full commit diff with the file changes classified by line kind', async () => {
    const content = fs.readFileSync(filePath, 'utf8');
    const blame = await blameLine({ filePath, content, line: 1, repoRoot });
    assert.ok(blame);

    const diffs = await getCommitDiff(blame!.sha, repoRoot);
    assert.strictEqual(diffs.length, 1);
    assert.strictEqual(diffs[0].path, 'file.txt');
    const allLines = diffs[0].hunks.flatMap((h) => h.lines);
    assert.ok(allLines.some((l) => l.kind === 'del' && l.text === 'line two'));
    assert.ok(allLines.some((l) => l.kind === 'add' && l.text === 'line two changed'));
    assert.ok(allLines.some((l) => l.kind === 'add' && l.text === 'line three'));
  });

  it('reverts a hunk against the working tree with git apply --reverse', async () => {
    const content = fs.readFileSync(filePath, 'utf8');
    const blame = await blameLine({ filePath, content, line: 1, repoRoot });
    assert.ok(blame);

    const diffs = await getCommitDiff(blame!.sha, repoRoot);
    const hunk = diffs[0].hunks[0];
    assert.ok(isRevertibleHunk(hunk));

    const patch = buildHunkPatch('file.txt', hunk);
    await applyPatchReverse(patch, repoRoot);

    const afterRevert = fs.readFileSync(filePath, 'utf8');
    assert.strictEqual(afterRevert, 'line one\nline two\n');

    // `git blame --contents -` only diffs against HEAD, so a working-tree line that
    // happens to match an older ancestor still reads as uncommitted relative to HEAD.
    // Restore the tracked version so later tests see a clean, HEAD-matching file.
    git(repoRoot, ['checkout', '--', 'file.txt']);
  });

  it('fails without touching the file when the hunk no longer applies cleanly', async () => {
    const content = fs.readFileSync(filePath, 'utf8');
    const blame = await blameLine({ filePath, content, line: 1, repoRoot });
    assert.ok(blame);
    assert.strictEqual(blame!.isUncommitted, false);

    const diffs = await getCommitDiff(blame!.sha, repoRoot);
    const hunk = diffs[0].hunks[0];

    // Drift the working tree away from what the hunk expects.
    fs.writeFileSync(filePath, 'line one\nline two changed AGAIN\nline three\n');
    const patch = buildHunkPatch('file.txt', hunk);

    await assert.rejects(() => applyPatchReverse(patch, repoRoot));
    assert.strictEqual(fs.readFileSync(filePath, 'utf8'), 'line one\nline two changed AGAIN\nline three\n');

    // Restore the tracked version for isolation from any later tests.
    git(repoRoot, ['checkout', '--', 'file.txt']);
  });
});

describe('git line-diff block replacement', () => {
  let repoRoot: string;
  let filePath: string;
  let secondSha: string;

  before(() => {
    repoRoot = initRepo('gitblamesolo-block-');

    const original = ['pad1', 'pad2', 'pad3', 'pad4', 'b', 'c', 'd', 'pad5', 'pad6', 'pad7', 'pad8'];
    filePath = path.join(repoRoot, 'block.txt');
    fs.writeFileSync(filePath, original.join('\n') + '\n');
    git(repoRoot, ['add', 'block.txt']);
    git(repoRoot, ['commit', '-m', 'First commit']);

    const updated = ['pad1', 'pad2', 'pad3', 'pad4', 'X', 'Y', 'Z', 'pad5', 'pad6', 'pad7', 'pad8'];
    fs.writeFileSync(filePath, updated.join('\n') + '\n');
    git(repoRoot, ['add', 'block.txt']);
    git(repoRoot, ['commit', '-m', 'Replace block b,c,d with X,Y,Z']);
    secondSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  });

  after(() => {
    removeRepo(repoRoot);
  });

  it('returns the full replaced block when blaming any line inside it, not just the probed line', async () => {
    const content = fs.readFileSync(filePath, 'utf8');
    // "Y" is at line index 5 (0-based) in the current buffer.
    const blame = await blameLine({ filePath, content, line: 5, repoRoot });

    assert.ok(blame);
    assert.strictEqual(blame!.sha, secondSha);

    const hunk = await getLineDiffHunk({ sha: blame!.sha, relativePath: blame!.filename, line: blame!.originalLine, repoRoot });
    assert.ok(hunk);
    assert.ok(hunk!.includes('-b'));
    assert.ok(hunk!.includes('-c'));
    assert.ok(hunk!.includes('-d'));
    assert.ok(hunk!.includes('+X'));
    assert.ok(hunk!.includes('+Y'));
    assert.ok(hunk!.includes('+Z'));
    // git appends a "section heading" hint to the "@@ ... @@" header line itself (the
    // nearest preceding context line), so we only assert pad1 is absent as an actual
    // content line, not merely absent from the whole string.
    const contentLines = hunk!.split('\n').slice(1);
    assert.ok(
      !contentLines.includes(' pad1'),
      'padding far from the change should be outside the hunk body',
    );
  });
});

describe('git blame options', () => {
  let repoRoot: string;
  let filePath: string;
  let firstSha: string;
  let reformatSha: string;

  before(() => {
    repoRoot = initRepo('gitblamesolo-options-');

    filePath = path.join(repoRoot, 'code.txt');
    fs.writeFileSync(filePath, 'alpha\nbeta\n');
    git(repoRoot, ['add', 'code.txt']);
    git(repoRoot, ['commit', '-m', 'Write code']);
    firstSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();

    fs.writeFileSync(filePath, '  alpha\n  beta\n');
    git(repoRoot, ['commit', '-am', 'Reindent']);
    reformatSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  });

  after(() => {
    removeRepo(repoRoot);
  });

  const defaults = { ignoreWhitespace: false, detectMovedLines: 'off' as const, ignoreRevsFile: '' };

  it('attributes a reindented line to the reformat commit by default', async () => {
    const content = fs.readFileSync(filePath, 'utf8');
    const blame = toBlameInfo(await blameFile({ relativePath: 'code.txt', content, repoRoot, options: defaults }), 0);
    assert.strictEqual(blame!.sha, reformatSha);
  });

  it('looks through whitespace-only changes with ignoreWhitespace', async () => {
    const content = fs.readFileSync(filePath, 'utf8');
    const options = { ...defaults, ignoreWhitespace: true };
    const blame = toBlameInfo(await blameFile({ relativePath: 'code.txt', content, repoRoot, options }), 0);
    assert.strictEqual(blame!.sha, firstSha);
  });

  it('skips commits listed in the ignore-revs file, and ignores a missing file', async () => {
    fs.writeFileSync(path.join(repoRoot, '.git-blame-ignore-revs'), `${reformatSha}\n`);
    const content = fs.readFileSync(filePath, 'utf8');

    const skipped = toBlameInfo(
      await blameFile({ relativePath: 'code.txt', content, repoRoot, options: { ...defaults, ignoreRevsFile: '.git-blame-ignore-revs' } }),
      0,
    );
    assert.strictEqual(skipped!.sha, firstSha);

    const missing = toBlameInfo(
      await blameFile({ relativePath: 'code.txt', content, repoRoot, options: { ...defaults, ignoreRevsFile: 'no-such-file' } }),
      0,
    );
    assert.strictEqual(missing!.sha, reformatSha);
  });

  it('reads the default remote and the current user email', async () => {
    clearRemoteCaches();
    assert.strictEqual(await getCommitLink(repoRoot, firstSha), undefined);

    git(repoRoot, ['remote', 'add', 'origin', 'git@github.com:owner/repo.git']);
    clearRemoteCaches();
    assert.strictEqual((await getCommitLink(repoRoot, firstSha))!.url, `https://github.com/owner/repo/commit/${firstSha}`);
    assert.strictEqual(await getCurrentUserEmail(repoRoot), 'test@example.com');
  });
});

describe('blame previous revision', () => {
  let repoRoot: string;
  let firstSha: string;
  let renameSha: string;
  let editSha: string;

  function head(): string {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  }

  before(() => {
    repoRoot = initRepo('gitblamesolo-previous-');

    fs.writeFileSync(path.join(repoRoot, 'old.txt'), 'one\ntwo\nthree\nfour\n');
    git(repoRoot, ['add', 'old.txt']);
    git(repoRoot, ['commit', '-m', 'Add file']);
    firstSha = head();

    git(repoRoot, ['mv', 'old.txt', 'new.txt']);
    git(repoRoot, ['commit', '-m', 'Rename file']);
    renameSha = head();

    fs.writeFileSync(path.join(repoRoot, 'new.txt'), 'zero\none\ntwo\nTHREE\nfour\n');
    git(repoRoot, ['commit', '-am', 'Edit file']);
    editSha = head();
  });

  after(() => {
    removeRepo(repoRoot);
  });

  it('reports the commit and path a line had before its commit, across a rename', async () => {
    const content = fs.readFileSync(path.join(repoRoot, 'new.txt'), 'utf8');
    const blame = toBlameInfo(await blameFile({ repoRoot, relativePath: 'new.txt', content }), 3);

    assert.strictEqual(blame!.sha, editSha);
    assert.strictEqual(blame!.filename, 'new.txt');
    assert.deepStrictEqual(blame!.previous, { sha: renameSha, filename: 'new.txt' });

    // Blame follows the rename: the untouched line comes from the commit that wrote it under the old name.
    const untouched = toBlameInfo(await blameFile({ repoRoot, relativePath: 'new.txt', content }), 1);
    assert.strictEqual(untouched!.sha, firstSha);
    assert.strictEqual(untouched!.filename, 'old.txt');
    assert.strictEqual(untouched!.previous, undefined);
  });

  it('blames a file at a past revision without reading a buffer', async () => {
    const blame = toBlameInfo(await blameFile({ repoRoot, relativePath: 'new.txt', revision: renameSha }), 2);

    assert.strictEqual(blame!.sha, firstSha);
    assert.strictEqual(blame!.isUncommitted, false);
    assert.strictEqual(blame!.filename, 'old.txt');
  });

  it('maps a line to its position in the parent revision', async () => {
    // "THREE" (line 3 at editSha) replaced "three" (line 2 at renameSha); "four" moved down by one.
    const options = { repoRoot, sha: editSha, relativePath: 'new.txt', parentSha: renameSha, parentRelativePath: 'new.txt' };
    assert.strictEqual(await getParentLine({ ...options, line: 3 }), 2);
    assert.strictEqual(await getParentLine({ ...options, line: 4 }), 3);
    assert.strictEqual(await getParentLine({ ...options, line: 0 }), 0);
  });

  it('lists every commit that changed a line, following the rename', async () => {
    const history = await getLineHistory({ repoRoot, sha: editSha, relativePath: 'new.txt', line: 3 });

    assert.deepStrictEqual(
      history!.map((entry) => [entry.sha, entry.path, entry.line]),
      [
        [editSha, 'new.txt', 3],
        [firstSha, 'old.txt', 2],
      ],
    );
    assert.strictEqual(history![1].oldPath, undefined);
  });

  it('returns undefined when the line history cannot be read', async () => {
    assert.strictEqual(
      await getLineHistory({ repoRoot, sha: editSha, relativePath: 'missing.txt', line: 0 }),
      undefined,
    );
  });

  it('keeps the line when the diff cannot be computed', async () => {
    const line = await getParentLine({
      repoRoot,
      sha: editSha,
      relativePath: 'new.txt',
      parentSha: renameSha,
      parentRelativePath: 'missing.txt',
      line: 3,
    });
    assert.strictEqual(line, 3);
  });
});

describe('repository config file', () => {
  let repoRoot: string;
  let worktree: string;

  before(() => {
    repoRoot = initRepo('gitblamesolo-config-');
    fs.writeFileSync(path.join(repoRoot, 'file.txt'), 'line\n');
    git(repoRoot, ['add', 'file.txt']);
    git(repoRoot, ['commit', '-m', 'Add file']);
    worktree = `${repoRoot}-worktree`;
    git(repoRoot, ['worktree', 'add', '-b', 'other', worktree]);
  });

  after(() => {
    removeRepo(worktree);
    removeRepo(repoRoot);
  });

  it('is .git/config for a repository', async () => {
    const configPath = await repositoryGitConfigPath(repoRoot);
    assert.strictEqual(fs.realpathSync.native(configPath!), fs.realpathSync.native(path.join(repoRoot, '.git', 'config')));
  });

  it('is the main repository\'s config for a linked worktree', async () => {
    const configPath = await repositoryGitConfigPath(worktree);
    assert.strictEqual(fs.realpathSync.native(configPath!), fs.realpathSync.native(path.join(repoRoot, '.git', 'config')));
  });

  it('is undefined outside a repository', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gitblamesolo-norepo-'));
    try {
      assert.strictEqual(await repositoryGitConfigPath(outside), undefined);
    } finally {
      removeRepo(outside);
    }
  });
});

describe('repository-relative path', () => {
  let repoRoot: string;
  let link: string;

  before(() => {
    repoRoot = initRepo('gitblamesolo-relative-');
    fs.mkdirSync(path.join(repoRoot, 'src'));
    link = `${repoRoot}-link`;
    // A junction needs no special rights on Windows; the type is ignored elsewhere.
    fs.symlinkSync(repoRoot, link, 'junction');
  });

  after(() => {
    fs.unlinkSync(link);
    removeRepo(repoRoot);
  });

  it('is the path below the root, with forward slashes', async () => {
    assert.strictEqual(await repoRelativePath(repoRoot, path.join(repoRoot, 'src', 'a.ts')), 'src/a.ts');
  });

  it('follows a symlink to the repository, as git reports the root with symlinks resolved', async () => {
    const realRoot = fs.realpathSync.native(repoRoot);
    assert.strictEqual(await repoRelativePath(realRoot, path.join(link, 'src', 'a.ts')), 'src/a.ts');
    assert.strictEqual(await repoRelativePath(link, path.join(realRoot, 'src', 'new-file.ts')), 'src/new-file.ts');
  });

  it('is undefined outside the repository', async () => {
    assert.strictEqual(await repoRelativePath(repoRoot, path.join(os.tmpdir(), 'elsewhere.ts')), undefined);
    assert.strictEqual(await repoRelativePath(repoRoot, repoRoot), undefined);
  });
});

describe('git history', () => {
  let repoRoot: string;

  /** Commits with a fixed date so --date-order is deterministic. */
  function commit(message: string, time: number, author = 'Test User <test@example.com>'): void {
    const date = `@${1700000000 + time} +0000`;
    execFileSync('git', ['commit', '--allow-empty', '-m', message, `--author=${author}`], {
      cwd: repoRoot,
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
  }

  before(() => {
    repoRoot = initRepo('gitblamesolo-history-');
    fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'one\n');
    git(repoRoot, ['add', 'a.txt']);
    commit('Add a', 1000);
    git(repoRoot, ['switch', '-q', '-c', 'feature']);
    commit('Feature work', 2000, 'Grace Hopper <grace@example.com>');
    git(repoRoot, ['switch', '-q', 'main']);
    fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'two\n');
    git(repoRoot, ['add', 'a.txt']);
    commit('Change a', 3000);
    git(repoRoot, ['tag', 'v1']);
    git(repoRoot, ['switch', '-q', '-c', 'side']);
    commit('Side work', 4000);
    git(repoRoot, ['switch', '-q', 'main']);
    git(repoRoot, ['mv', 'a.txt', 'b.txt']);
    commit('Rename a to b', 5000);
  });

  after(() => removeRepo(repoRoot));

  it('lists the current branch newest first, with refs', async () => {
    const page = await getHistoryPage({ repoRoot, scope: { kind: 'head' }, skip: 0, limit: 10 });
    assert.ok(page);
    assert.deepStrictEqual(
      page.entries.map((e) => e.summary),
      ['Rename a to b', 'Change a', 'Add a'],
    );
    assert.strictEqual(page.hasMore, false);
    assert.deepStrictEqual(page.entries[1].refs, [
      { kind: 'tag', name: 'v1' },
    ]);
    assert.deepStrictEqual(page.entries[0].refs, [
      { kind: 'head', name: 'HEAD' },
      { kind: 'branch', name: 'main' },
    ]);
    assert.deepStrictEqual(page.entries[1].parents, [page.entries[2].sha]);
  });

  it('lists every branch and pages through them', async () => {
    const first = await getHistoryPage({ repoRoot, scope: { kind: 'all' }, skip: 0, limit: 2 });
    assert.ok(first);
    assert.deepStrictEqual(
      first.entries.map((e) => e.summary),
      ['Rename a to b', 'Side work'],
    );
    assert.strictEqual(first.hasMore, true);
    const second = await getHistoryPage({ repoRoot, scope: { kind: 'all' }, skip: 2, limit: 3 });
    assert.deepStrictEqual(
      second?.entries.map((e) => e.summary),
      ['Change a', 'Feature work', 'Add a'],
    );
    assert.strictEqual(second?.hasMore, false);
  });

  it('lists one branch', async () => {
    const page = await getHistoryPage({ repoRoot, scope: { kind: 'ref', ref: 'feature' }, skip: 0, limit: 10 });
    assert.deepStrictEqual(
      page?.entries.map((e) => e.summary),
      ['Feature work', 'Add a'],
    );
  });

  it('filters by author, message, and file', async () => {
    const all = { kind: 'all' } as const;
    const byAuthor = await getHistoryPage({ repoRoot, scope: all, author: 'GRACE', skip: 0, limit: 10 });
    assert.deepStrictEqual(
      byAuthor?.entries.map((e) => e.summary),
      ['Feature work'],
    );
    const bySearch = await getHistoryPage({ repoRoot, scope: all, search: 'work', skip: 0, limit: 10 });
    assert.deepStrictEqual(
      bySearch?.entries.map((e) => e.summary),
      ['Side work', 'Feature work'],
    );
    const byPath = await getHistoryPage({ repoRoot, scope: { kind: 'head' }, path: 'b.txt', skip: 0, limit: 10 });
    assert.deepStrictEqual(
      byPath?.entries.map((e) => [e.summary, e.path]),
      [
        ['Rename a to b', 'b.txt'],
        ['Change a', 'a.txt'],
        ['Add a', 'a.txt'],
      ],
    );
  });

  it('is undefined for a ref that does not exist', async () => {
    assert.strictEqual(
      await getHistoryPage({ repoRoot, scope: { kind: 'ref', ref: 'no-such-branch' }, skip: 0, limit: 10 }),
      undefined,
    );
  });

  it('lists the branches with the current one marked', async () => {
    const branches = await getBranches(repoRoot);
    assert.strictEqual(branches.current, 'main');
    assert.deepStrictEqual([...branches.local].sort(), ['feature', 'main', 'side']);
    assert.deepStrictEqual(branches.remote, []);
  });

  it('lists the files that differ between two refs, with renames', async () => {
    assert.deepStrictEqual(await getChangedFiles(repoRoot, 'v1', 'main'), [{ status: 'R', path: 'b.txt', oldPath: 'a.txt' }]);
    assert.deepStrictEqual(await getChangedFiles(repoRoot, 'feature', 'v1'), [{ status: 'M', path: 'a.txt' }]);
    assert.deepStrictEqual(await getChangedFiles(repoRoot, 'main', 'main'), []);
    assert.strictEqual(await getChangedFiles(repoRoot, 'no-such-ref', 'main'), undefined);
  });

  it('lists the files that differ from the working copy', async () => {
    fs.writeFileSync(path.join(repoRoot, 'b.txt'), 'three\n');
    try {
      assert.deepStrictEqual(await getChangedFiles(repoRoot, 'main'), [{ status: 'M', path: 'b.txt' }]);
    } finally {
      git(repoRoot, ['checkout', '--', 'b.txt']);
    }
  });

  it('resolves refs to commits and finds merge bases and tags', async () => {
    const v1 = execFileSync('git', ['rev-parse', 'v1'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    assert.strictEqual(await resolveCommit(repoRoot, 'v1'), v1);
    assert.strictEqual(await resolveCommit(repoRoot, 'no-such-ref'), undefined);
    assert.strictEqual(await resolveCommit(repoRoot, '--all'), undefined);
    const addA = execFileSync('git', ['rev-parse', 'feature~1'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    assert.strictEqual(await getMergeBase(repoRoot, 'feature', 'main'), addA);
    assert.deepStrictEqual(await getTags(repoRoot), ['v1']);
  });
});

describe('unpushed commits and commit messages', () => {
  let repoRoot: string;
  let remote: string;

  before(() => {
    remote = fs.mkdtempSync(path.join(os.tmpdir(), 'gitblamesolo-remote-'));
    git(remote, ['init', '--bare', '--initial-branch=main']);
    repoRoot = initRepo('gitblamesolo-unpushed-');
    fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'one\n');
    git(repoRoot, ['add', 'a.txt']);
    git(repoRoot, ['commit', '-m', ':sparkles: Add a', '-m', 'With a body.']);
  });

  after(() => {
    removeRepo(repoRoot);
    removeRepo(remote);
  });

  function head(): string {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  }

  it('reads the full commit message', async () => {
    assert.strictEqual(await getCommitMessage(head(), repoRoot), ':sparkles: Add a\n\nWith a body.');
    assert.strictEqual(await getCommitMessage('0'.repeat(40), repoRoot), undefined);
  });

  it('marks nothing before the repository has any remote branch', async () => {
    assert.strictEqual(await getUnpushedCommits(repoRoot), undefined);
  });

  it('lists the commits no remote branch contains', async () => {
    git(repoRoot, ['remote', 'add', 'origin', remote]);
    git(repoRoot, ['push', '-q', 'origin', 'main']);
    const pushed = head();
    fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'two\n');
    git(repoRoot, ['commit', '-qam', 'Change a']);
    const unpushed = await getUnpushedCommits(repoRoot);
    assert.deepStrictEqual([...(unpushed ?? [])], [head()]);
    assert.ok(!unpushed?.has(pushed));
  });
});

describe('uncommitted hunk', () => {
  let repoRoot: string;
  const lines = (rows: string[]) => rows.map((row) => `${row}\n`).join('');

  before(() => {
    repoRoot = initRepo('gitblamesolo-uncommitted-');
    fs.writeFileSync(path.join(repoRoot, 'a.txt'), lines(['c', 'b', 'b', 'c', 'c', 'b', 'b', 'c', 'c', 'a']));
    git(repoRoot, ['add', 'a.txt']);
    git(repoRoot, ['commit', '-m', 'Add a']);
  });

  after(() => removeRepo(repoRoot));

  it('pairs a changed line with the line it replaced, among repeated lines', async () => {
    const current = lines(['c', 'b', 'b', 'cX', 'c', 'b', 'b', 'c', 'c', 'bX', 'a']);
    const hunk = await getUncommittedHunk(repoRoot, 'a.txt', current, 3);
    assert.ok(hunk?.includes(' b\n-c\n+cX\n c\n'), hunk);
  });

  it('keeps changes far apart in separate hunks', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    fs.writeFileSync(path.join(repoRoot, 'b.txt'), lines(rows));
    git(repoRoot, ['add', 'b.txt']);
    git(repoRoot, ['commit', '-m', 'Add b']);
    const current = [...rows];
    current[2] = 'first';
    current[25] = 'second';
    const hunk = await getUncommittedHunk(repoRoot, 'b.txt', lines(current), 25);
    assert.ok(hunk?.startsWith('@@ -23,7 +23,7 @@'), hunk);
    assert.ok(hunk?.includes('-line 26\n+second') && !hunk.includes('first'), hunk);
  });

  it('shows every line of a new file as added', async () => {
    assert.strictEqual(await getUncommittedHunk(repoRoot, 'new.txt', 'x\ny\n', 1), '@@ -0,0 +1,2 @@\n+x\n+y');
  });
});
