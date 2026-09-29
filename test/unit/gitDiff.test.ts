import * as assert from 'assert';
import { mapLineToParent } from '../../src/git/gitDiff';

describe('mapLineToParent', () => {
  // Old: a b c d e f     New: a X Y d e f g
  // Lines b-c were replaced by X-Y, g was appended.
  const diff = ['diff --git a/f b/f', '--- a/f', '+++ b/f', '@@ -2,2 +2,2 @@', '-b', '-c', '+X', '+Y', '@@ -6,0 +7 @@', '+g', ''].join(
    '\n',
  );

  it('keeps lines above every change in place', () => {
    assert.strictEqual(mapLineToParent(diff, 1), 1);
  });

  it('maps a line inside a changed block to the start of the block it replaced', () => {
    assert.strictEqual(mapLineToParent(diff, 2), 2);
    assert.strictEqual(mapLineToParent(diff, 3), 2);
  });

  it('maps an added line to the line after the insertion point', () => {
    assert.strictEqual(mapLineToParent(diff, 7), 7);
  });

  it('shifts lines below a change by the lines it added or removed', () => {
    const insertion = ['@@ -1,0 +2,3 @@', '+x', '+y', '+z', ''].join('\n');
    assert.strictEqual(mapLineToParent(insertion, 6), 3);

    const deletion = ['@@ -2,2 +1,0 @@', '-b', '-c', ''].join('\n');
    assert.strictEqual(mapLineToParent(deletion, 2), 4);
  });

  it('returns the same line when nothing changed', () => {
    assert.strictEqual(mapLineToParent('', 4), 4);
  });
});
