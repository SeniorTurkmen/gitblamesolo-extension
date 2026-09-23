import * as assert from 'assert';
import { countDiffStats } from '../../src/util/diffStats';

describe('countDiffStats', () => {
  it('counts added and removed lines, ignoring the hunk header', () => {
    const hunk = ['@@ -1,2 +1,3 @@', ' line one', '-line two', '+line two changed', '+line three'].join('\n');
    assert.deepStrictEqual(countDiffStats(hunk), { added: 2, removed: 1 });
  });

  it('returns zeros for a context-only hunk', () => {
    const hunk = ['@@ -1,1 +1,1 @@', ' unchanged line'].join('\n');
    assert.deepStrictEqual(countDiffStats(hunk), { added: 0, removed: 0 });
  });

  it('does not count the truncation notice as a change', () => {
    const hunk = ['@@ -1,1 +1,1 @@', '+added', '… (3 more lines)'].join('\n');
    assert.deepStrictEqual(countDiffStats(hunk), { added: 1, removed: 0 });
  });
});
