import * as assert from 'assert';
import { parseCommitDiff } from '../../src/git/gitCommitDiff';

describe('parseCommitDiff', () => {
  it('parses added, removed, and context lines for a single modified file', () => {
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
    assert.deepStrictEqual(files[0].lines, [
      { kind: 'hunk-header', text: '@@ -1,2 +1,3 @@' },
      { kind: 'context', text: 'line one', newLine: 1 },
      { kind: 'del', text: 'line two' },
      { kind: 'add', text: 'line two changed', newLine: 2 },
      { kind: 'add', text: 'line three', newLine: 3 },
    ]);
  });

  it('tracks post-commit line numbers across multiple hunks in one file', () => {
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
    assert.deepStrictEqual(
      files[0].lines.filter((l) => l.newLine !== undefined).map((l) => [l.text, l.newLine]),
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
    assert.deepStrictEqual(files[0].lines, []);
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
    assert.deepStrictEqual(files[0].lines, [{ kind: 'meta', text: 'Binary file (diff not shown)' }]);
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
