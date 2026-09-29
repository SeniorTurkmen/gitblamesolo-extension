import * as assert from 'assert';
import { GraphRow, layoutGraph } from '../../src/util/historyGraph';

/** Commits as "sha:parent1,parent2", newest first. */
function graph(...commits: string[]): GraphRow[] {
  return layoutGraph(
    commits.map((spec) => {
      const [sha, parents = ''] = spec.split(':');
      return { sha, parents: parents ? parents.split(',') : [] };
    }),
  );
}

/** Segments of one row as "from>to" per half, ignoring colors. */
function lines(row: GraphRow, half: 'top' | 'bottom'): string[] {
  return row.segments
    .filter((s) => s.half === half)
    .map((s) => `${s.fromLane}>${s.toLane}`)
    .sort();
}

describe('layoutGraph', () => {
  it('draws a straight line through a linear history', () => {
    const rows = graph('c:b', 'b:a', 'a');
    assert.deepStrictEqual(
      rows.map((r) => r.lane),
      [0, 0, 0],
    );
    assert.deepStrictEqual(lines(rows[0], 'top'), []);
    assert.deepStrictEqual(lines(rows[0], 'bottom'), ['0>0']);
    assert.deepStrictEqual(lines(rows[1], 'top'), ['0>0']);
    assert.deepStrictEqual(lines(rows[2], 'bottom'), []);
    assert.ok(rows.every((r) => r.color === rows[0].color));
  });

  it('opens a lane for the second parent of a merge and closes it where the branches meet', () => {
    // m merges f into main; f and b both come from a.
    const rows = graph('m:b,f', 'f:a', 'b:a', 'a');
    assert.deepStrictEqual(
      rows.map((r) => r.lane),
      [0, 1, 0, 0],
    );
    assert.deepStrictEqual(lines(rows[0], 'bottom'), ['0>0', '0>1']);
    // f's row: main passes through lane 0; f's first parent a opens its own wait in lane 1.
    assert.deepStrictEqual(lines(rows[1], 'top'), ['0>0', '1>1']);
    assert.deepStrictEqual(lines(rows[1], 'bottom'), ['0>0', '1>1']);
    // b's row: lane 1 also waits for a, so it bends into lane 0, which keeps main on the left.
    assert.deepStrictEqual(lines(rows[2], 'bottom'), ['0>0', '1>0']);
    assert.deepStrictEqual(lines(rows[3], 'top'), ['0>0']);
    assert.strictEqual(rows[3].width, 1);
    assert.notStrictEqual(rows[0].segments.find((s) => s.toLane === 1)!.color, rows[0].color);
  });

  it('ends every lane waiting for a commit in its dot', () => {
    // Two branch tips x and y both come from base.
    const rows = graph('x:base', 'y:base', 'base');
    assert.deepStrictEqual(
      rows.map((r) => r.lane),
      [0, 1, 0],
    );
    assert.deepStrictEqual(lines(rows[1], 'top'), ['0>0']);
    assert.deepStrictEqual(lines(rows[1], 'bottom'), ['0>0', '1>0']);
    assert.deepStrictEqual(lines(rows[2], 'top'), ['0>0']);
  });

  it('gives an unrelated branch tip its own lane and reuses freed lanes', () => {
    const rows = graph('a2:a1', 'b1', 'a1', 'c1');
    assert.deepStrictEqual(
      rows.map((r) => r.lane),
      [0, 1, 0, 0],
    );
    assert.deepStrictEqual(lines(rows[1], 'top'), ['0>0']);
    assert.deepStrictEqual(lines(rows[1], 'bottom'), ['0>0']);
    assert.strictEqual(rows[1].width, 2);
    assert.strictEqual(rows[3].width, 1);
  });

  it('joins a merge parent into the lane already waiting for it', () => {
    // m3 merges t, whose parent m1 is already awaited by main's lane.
    const rows = graph('m3:m2,t', 'm2:m1', 't:m1', 'm1');
    assert.deepStrictEqual(lines(rows[0], 'bottom'), ['0>0', '0>1']);
    assert.deepStrictEqual(lines(rows[2], 'bottom'), ['0>0', '1>0']);
    assert.strictEqual(rows[3].lane, 0);
  });

  it('bends a merge parent into an existing lane to its left', () => {
    // x waits for p in lane 0; y is a merge in lane 1 whose second parent is p.
    const rows = graph('x:p', 'y:q,p', 'q', 'p');
    assert.deepStrictEqual(lines(rows[1], 'bottom'), ['0>0', '1>0', '1>1']);
  });
});
