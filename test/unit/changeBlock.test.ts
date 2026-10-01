import * as assert from 'assert';
import { changeBlockForLine, splitLines } from '../../src/util/changeBlock';

// `git diff -U0` of a 12-line file where line 3 changed, line 6 was added, and line 10 was deleted.
const DIFF = [
  'diff --git a/f b/f',
  '--- a/f',
  '+++ b/f',
  '@@ -3 +3 @@',
  '-old 3',
  '+new 3',
  '@@ -5,0 +6 @@',
  '+added',
  '@@ -10 +10,0 @@',
  '-gone',
].join('\n');
const NEW_LINES = ['l1', 'l2', 'new 3', 'l4', 'l5', 'added', 'l6', 'l7', 'l8', 'l9', 'l11', 'l12'];

describe('changeBlockForLine', () => {
  it('shows only the block holding the line, with context up to its neighbors', () => {
    assert.strictEqual(
      changeBlockForLine(DIFF, NEW_LINES, 3),
      ['@@ -1,5 +1,5 @@', ' l1', ' l2', '-old 3', '+new 3', ' l4', ' l5'].join('\n'),
    );
  });

  it('stops context at a neighboring deletion', () => {
    assert.strictEqual(
      changeBlockForLine(DIFF, NEW_LINES, 6),
      ['@@ -4,5 +4,6 @@', ' l4', ' l5', '+added', ' l6', ' l7', ' l8'].join('\n'),
    );
  });

  it('is undefined for unchanged lines', () => {
    assert.strictEqual(changeBlockForLine(DIFF, NEW_LINES, 4), undefined);
  });

  it('shows a new file as all added', () => {
    assert.strictEqual(changeBlockForLine('@@ -0,0 +1,2 @@\n+a\n+b', ['a', 'b'], 1), '@@ -0,0 +1,2 @@\n+a\n+b');
  });

  it('truncates long blocks', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `x${i}`);
    const block = changeBlockForLine(`@@ -0,0 +1,40 @@\n${lines.map((l) => `+${l}`).join('\n')}`, lines, 1) ?? '';
    assert.ok(block.endsWith('… (10 more lines)'));
  });

  it('splits text into lines without their endings', () => {
    assert.deepStrictEqual(splitLines('a\r\nb\n'), ['a', 'b']);
    assert.deepStrictEqual(splitLines(''), []);
  });
});
