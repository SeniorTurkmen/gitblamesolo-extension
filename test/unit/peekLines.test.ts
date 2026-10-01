import * as assert from 'assert';
import { numberHunkLines } from '../../src/util/peekLines';

describe('numberHunkLines', () => {
  it('numbers each line in the old and new versions', () => {
    assert.deepStrictEqual(numberHunkLines('@@ -9,3 +25,3 @@\n }\n-old\n+new\n end'), [
      { kind: 'context', text: '}', oldLine: 9, newLine: 25 },
      { kind: 'del', text: 'old', oldLine: 10 },
      { kind: 'add', text: 'new', newLine: 26 },
      { kind: 'context', text: 'end', oldLine: 11, newLine: 27 },
    ]);
  });

  it('starts an empty side after the line git names', () => {
    assert.deepStrictEqual(numberHunkLines('@@ -0,0 +1 @@\n+a'), [{ kind: 'add', text: 'a', newLine: 1 }]);
  });

  it('keeps the truncation notice without numbers', () => {
    assert.deepStrictEqual(numberHunkLines('@@ -1 +1 @@\n+a\n… (3 more lines)')[1], { kind: 'context', text: '… (3 more lines)' });
  });

  it('is empty without a hunk header', () => {
    assert.deepStrictEqual(numberHunkLines(''), []);
  });
});
