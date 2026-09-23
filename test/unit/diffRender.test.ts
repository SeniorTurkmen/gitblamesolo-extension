import * as assert from 'assert';
import { countDiffStats, parseDiffHunkLines } from '../../src/util/diffRender';

describe('parseDiffHunkLines', () => {
  it('classifies add/del/context lines and drops the hunk header', () => {
    const hunk = ['@@ -1,2 +1,3 @@', ' line one', '-line two', '+line two changed', '+line three'].join('\n');
    assert.deepStrictEqual(parseDiffHunkLines(hunk), [
      { kind: 'context', text: 'line one' },
      { kind: 'del', text: 'line two' },
      { kind: 'add', text: 'line two changed' },
      { kind: 'add', text: 'line three' },
    ]);
  });

  it('preserves a genuinely blank context line (a lone space prefix)', () => {
    const hunk = ['@@ -1,1 +1,1 @@', ' '].join('\n');
    assert.deepStrictEqual(parseDiffHunkLines(hunk), [{ kind: 'context', text: '' }]);
  });

  it('keeps the truncation notice as a context-styled line', () => {
    const hunk = ['@@ -1,1 +1,1 @@', '+added', '… (3 more lines)'].join('\n');
    assert.deepStrictEqual(parseDiffHunkLines(hunk), [
      { kind: 'add', text: 'added' },
      { kind: 'context', text: '… (3 more lines)' },
    ]);
  });
});

describe('countDiffStats', () => {
  it('counts added and removed lines, ignoring context', () => {
    const lines = parseDiffHunkLines(
      ['@@ -1,2 +1,3 @@', ' line one', '-line two', '+line two changed', '+line three'].join('\n'),
    );
    assert.deepStrictEqual(countDiffStats(lines), { added: 2, removed: 1 });
  });

  it('returns zeros for a context-only hunk', () => {
    const lines = parseDiffHunkLines(['@@ -1,1 +1,1 @@', ' unchanged line'].join('\n'));
    assert.deepStrictEqual(countDiffStats(lines), { added: 0, removed: 0 });
  });

  it('does not count the truncation notice as a change', () => {
    const lines = parseDiffHunkLines(['@@ -1,1 +1,1 @@', '+added', '… (3 more lines)'].join('\n'));
    assert.deepStrictEqual(countDiffStats(lines), { added: 1, removed: 0 });
  });
});
