import * as assert from 'assert';
import { diffHunkForLine } from '../../src/util/lineDiff';

const lines = (count: number) => Array.from({ length: count }, (_, i) => `line ${i + 1}`);
const text = (rows: string[]) => rows.map((row) => `${row}\n`).join('');

describe('diffHunkForLine', () => {
  it('shows a changed line with three lines of context', () => {
    const before = lines(10);
    const after = [...before];
    after[4] = 'changed';
    assert.strictEqual(
      diffHunkForLine(text(before), text(after), 4),
      ['@@ -2,7 +2,7 @@', ' line 2', ' line 3', ' line 4', '-line 5', '+changed', ' line 6', ' line 7', ' line 8'].join('\n'),
    );
  });

  it('shows added lines', () => {
    const before = lines(3);
    const after = ['line 1', 'new a', 'new b', 'line 2', 'line 3'];
    assert.strictEqual(
      diffHunkForLine(text(before), text(after), 2),
      ['@@ -1,3 +1,5 @@', ' line 1', '+new a', '+new b', ' line 2', ' line 3'].join('\n'),
    );
  });

  it('keeps changes far apart in separate hunks', () => {
    const before = lines(30);
    const after = [...before];
    after[2] = 'first';
    after[25] = 'second';
    const hunk = diffHunkForLine(text(before), text(after), 25) ?? '';
    assert.ok(hunk.includes('+second'));
    assert.ok(!hunk.includes('first'));
    assert.ok(hunk.startsWith('@@ -23,7 +23,7 @@'));
  });

  it('shows a new file as all added', () => {
    assert.strictEqual(diffHunkForLine('', 'a\nb\n', 1), '@@ -0,0 +1,2 @@\n+a\n+b');
  });

  it('ignores line endings and unchanged lines', () => {
    assert.strictEqual(diffHunkForLine('a\r\nb\r\n', 'a\nb\n', 0), undefined);
    assert.strictEqual(diffHunkForLine('a\nb\n', 'a\nc\n', 0), undefined);
  });

  it('truncates long blocks', () => {
    const hunk = diffHunkForLine('', text(lines(50)), 0) ?? '';
    assert.ok(hunk.endsWith('… (20 more lines)'));
  });
});
