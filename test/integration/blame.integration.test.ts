import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyPatchReverse } from '../../src/git/gitApply';
import { blameLine } from '../../src/git/gitBlame';
import { buildHunkPatch, getCommitDiff, isRevertibleHunk } from '../../src/git/gitCommitDiff';
import { getLineDiffHunk } from '../../src/git/gitDiff';
import { getCommitDetails } from '../../src/git/gitLog';

function git(repoRoot: string, args: string[]): void {
  execFileSync('git', args, { cwd: repoRoot });
}

describe('git blame integration', () => {
  let repoRoot: string;
  let filePath: string;

  before(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitblamesolo-'));
    git(repoRoot, ['init', '--initial-branch=main']);
    git(repoRoot, ['config', 'user.email', 'test@example.com']);
    git(repoRoot, ['config', 'user.name', 'Test User']);

    filePath = path.join(repoRoot, 'file.txt');
    fs.writeFileSync(filePath, 'line one\nline two\n');
    git(repoRoot, ['add', 'file.txt']);
    git(repoRoot, ['commit', '-m', 'First commit']);

    fs.writeFileSync(filePath, 'line one\nline two changed\nline three\n');
    git(repoRoot, ['add', 'file.txt']);
    git(repoRoot, ['commit', '-m', 'Second commit']);
  });

  after(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
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

    const hunk = await getLineDiffHunk({ sha: blame!.sha, filePath, line: blame!.originalLine, repoRoot });
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
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitblamesolo-block-'));
    git(repoRoot, ['init', '--initial-branch=main']);
    git(repoRoot, ['config', 'user.email', 'test@example.com']);
    git(repoRoot, ['config', 'user.name', 'Test User']);

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
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns the full replaced block when blaming any line inside it, not just the probed line', async () => {
    const content = fs.readFileSync(filePath, 'utf8');
    // "Y" is at line index 5 (0-based) in the current buffer.
    const blame = await blameLine({ filePath, content, line: 5, repoRoot });

    assert.ok(blame);
    assert.strictEqual(blame!.sha, secondSha);

    const hunk = await getLineDiffHunk({ sha: blame!.sha, filePath, line: blame!.originalLine, repoRoot });
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
