import * as assert from 'assert';
import { BlameLine, FileBlame, UNCOMMITTED_LINE } from '../../src/git/gitBlame';
import { commitLineRuns } from '../../src/util/commitLines';

function line(sha: string): BlameLine {
  return { ...UNCOMMITTED_LINE, commit: { ...UNCOMMITTED_LINE.commit, sha, isUncommitted: false } };
}

describe('commitLineRuns', () => {
  it('groups consecutive lines from the commit into runs', () => {
    const blame: FileBlame = [line('a'), line('a'), line('b'), line('a'), UNCOMMITTED_LINE, line('a'), line('a')];
    assert.deepStrictEqual(commitLineRuns(blame, 'a'), [
      { start: 0, end: 1 },
      { start: 3, end: 3 },
      { start: 5, end: 6 },
    ]);
  });

  it('finds nothing for a commit that changed no line', () => {
    assert.deepStrictEqual(commitLineRuns([line('a')], 'b'), []);
    assert.deepStrictEqual(commitLineRuns([], 'a'), []);
  });
});
