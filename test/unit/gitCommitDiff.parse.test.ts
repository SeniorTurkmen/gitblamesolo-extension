import * as assert from 'assert';
import { buildHunkPatch, isRevertibleHunk, parseCommitDiff } from '../../src/git/gitCommitDiff';

describe('parseCommitDiff', () => {
  it('parses added, removed, and context lines into a single hunk', () => {
    const raw = [
      'diff --git a/file.txt b/file.txt',
      'index e5c5c55..614162c 100644',
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -1,2 +1,3 @@',
      ' line one',
      '-line two',
      '+line two changed',
      '+line three',
      '',
    ].join('\n');

    const files = parseCommitDiff(raw);
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].path, 'file.txt');
    assert.strictEqual(files[0].oldPath, undefined);
    assert.strictEqual(files[0].hunks.length, 1);

    const hunk = files[0].hunks[0];
    assert.strictEqual(hunk.header, '@@ -1,2 +1,3 @@');
    assert.deepStrictEqual(hunk, {
      header: '@@ -1,2 +1,3 @@',
      oldStart: 1,
      oldCount: 2,
      newStart: 1,
      newCount: 3,
      lines: [
        { kind: 'context', text: 'line one', newLine: 1 },
        { kind: 'del', text: 'line two' },
        { kind: 'add', text: 'line two changed', newLine: 2 },
        { kind: 'add', text: 'line three', newLine: 3 },
      ],
    });
  });

  it('tracks post-commit line numbers and separate hunks across multiple hunks in one file', () => {
    const raw = [
      'diff --git a/file.txt b/file.txt',
      'index 111..222 100644',
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -10,1 +10,1 @@',
      '-old at 10',
      '+new at 10',
      '@@ -50,2 +50,3 @@',
      ' context at 50',
      '+added at 51',
      ' context at 52',
      '',
    ].join('\n');

    const files = parseCommitDiff(raw);
    assert.strictEqual(files[0].hunks.length, 2);
    assert.deepStrictEqual(
      files[0].hunks.flatMap((h) => h.lines).filter((l) => l.newLine !== undefined).map((l) => [l.text, l.newLine]),
      [
        ['new at 10', 10],
        ['context at 50', 50],
        ['added at 51', 51],
        ['context at 52', 52],
      ],
    );
  });

  it('detects a rename and captures the old path', () => {
    const raw = [
      'diff --git a/old/path.ts b/new/path.ts',
      'similarity index 100%',
      'rename from old/path.ts',
      'rename to new/path.ts',
      '',
    ].join('\n');

    const files = parseCommitDiff(raw);
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].path, 'new/path.ts');
    assert.strictEqual(files[0].oldPath, 'old/path.ts');
    assert.deepStrictEqual(files[0].hunks, []);
  });

  it('flags binary files instead of rendering their content', () => {
    const raw = [
      'diff --git a/image.png b/image.png',
      'index 111..222 100644',
      'Binary files a/image.png and b/image.png differ',
      '',
    ].join('\n');

    const files = parseCommitDiff(raw);
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].hunks.length, 1);
    assert.deepStrictEqual(files[0].hunks[0].lines, [{ kind: 'meta', text: 'Binary file (diff not shown)' }]);
    assert.strictEqual(isRevertibleHunk(files[0].hunks[0]), false);
  });

  it('splits multiple files in the same commit into separate entries', () => {
    const raw = [
      'diff --git a/a.txt b/a.txt',
      'index 111..222 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1,1 +1,1 @@',
      '-old a',
      '+new a',
      'diff --git a/b.txt b/b.txt',
      'index 333..444 100644',
      '--- a/b.txt',
      '+++ b/b.txt',
      '@@ -1,1 +1,1 @@',
      '-old b',
      '+new b',
      '',
    ].join('\n');

    const files = parseCommitDiff(raw);
    assert.strictEqual(files.length, 2);
    assert.strictEqual(files[0].path, 'a.txt');
    assert.strictEqual(files[1].path, 'b.txt');
  });
});

describe('isRevertibleHunk', () => {
  it('is true for a hunk with real content changes', () => {
    const files = parseCommitDiff(
      ['diff --git a/f.txt b/f.txt', '--- a/f.txt', '+++ b/f.txt', '@@ -1,1 +1,1 @@', '-old', '+new', ''].join('\n'),
    );
    assert.strictEqual(isRevertibleHunk(files[0].hunks[0]), true);
  });
});

describe('buildHunkPatch', () => {
  it('builds an applyable unified-diff patch for a single hunk', () => {
    const files = parseCommitDiff(
      [
        'diff --git a/file.txt b/file.txt',
        '--- a/file.txt',
        '+++ b/file.txt',
        '@@ -1,2 +1,3 @@',
        ' line one',
        '-line two',
        '+line two changed',
        '+line three',
        '',
      ].join('\n'),
    );

    const patch = buildHunkPatch('file.txt', files[0].hunks[0]);
    assert.strictEqual(
      patch,
      [
        'diff --git a/file.txt b/file.txt',
        '--- a/file.txt',
        '+++ b/file.txt',
        '@@ -1,2 +1,3 @@',
        ' line one',
        '-line two',
        '+line two changed',
        '+line three',
        '',
      ].join('\n'),
    );
  });
});
