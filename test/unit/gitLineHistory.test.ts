import * as assert from 'assert';
import { parseLineHistory } from '../../src/git/gitLineHistory';

const RS = '\x1e';
const FS = '\x1f';

function record(sha: string, summary: string, diff: string[]): string {
  return `${RS}${[sha, 'Ada', 'ada@example.com', '1700000000', summary].join(FS)}\n\n${diff.join('\n')}\n`;
}

describe('parseLineHistory', () => {
  const edit = 'a'.repeat(40);
  const rename = 'b'.repeat(40);
  const create = 'c'.repeat(40);
  const output =
    record(edit, 'Edit the line', [
      'diff --git a/new.txt b/new.txt',
      '--- a/new.txt',
      '+++ b/new.txt',
      '@@ -4,1 +5,1 @@',
      '-- old comment',
      '+-- new comment',
    ]) +
    record(rename, 'Rename and edit', [
      'diff --git a/old.txt b/new.txt',
      '--- a/old.txt',
      '+++ b/new.txt',
      '@@ -4,1 +4,1 @@',
      '-x',
      '+- old comment',
    ]) +
    record(create, 'Create', ['diff --git a/old.txt b/old.txt', '--- /dev/null', '+++ b/old.txt', '@@ -0,0 +1,1 @@', '+x']);

  const entries = parseLineHistory(output);

  it('lists every commit newest first with its metadata', () => {
    assert.deepStrictEqual(
      entries.map((e) => [e.sha, e.summary]),
      [
        [edit, 'Edit the line'],
        [rename, 'Rename and edit'],
        [create, 'Create'],
      ],
    );
    assert.strictEqual(entries[0].authorName, 'Ada');
    assert.strictEqual(entries[0].authorEmail, 'ada@example.com');
    assert.strictEqual(entries[0].authorTimestamp, 1700000000);
  });

  it('reads the path in each commit and in its parent', () => {
    assert.deepStrictEqual(
      entries.map((e) => [e.path, e.oldPath]),
      [
        ['new.txt', 'new.txt'],
        ['new.txt', 'old.txt'],
        ['old.txt', undefined],
      ],
    );
  });

  it('reads where the line starts in each commit, 0-based', () => {
    assert.deepStrictEqual(
      entries.map((e) => e.line),
      [4, 3, 0],
    );
  });

  it('does not mistake a removed "-- " line for a file header', () => {
    assert.strictEqual(entries[0].oldPath, 'new.txt');
  });

  it('unquotes paths with special characters', () => {
    const quoted = record(edit, 'Quoted', [
      '--- "a/n\\303\\244me.txt"',
      '+++ "b/n\\303\\244me.txt"',
      '@@ -1 +1 @@',
    ]);
    assert.strictEqual(parseLineHistory(quoted)[0].path, 'näme.txt');
  });

  it('returns nothing for empty output', () => {
    assert.deepStrictEqual(parseLineHistory(''), []);
  });
});
