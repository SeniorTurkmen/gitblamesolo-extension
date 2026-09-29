import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyPatchReverse } from '../../src/git/gitApply';
import { blameFile, toBlameInfo } from '../../src/git/gitBlame';
import { buildHunkPatch, getCommitDiff, isRevertibleHunk } from '../../src/git/gitCommitDiff';
import { getLineDiffHunk, getParentLine } from '../../src/git/gitDiff';
import { getLineHistory } from '../../src/git/gitLineHistory';
import { repositoryGitConfigPath } from '../../src/git/gitConfigFiles';
import { getCommitDetails } from '../../src/git/gitLog';
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
