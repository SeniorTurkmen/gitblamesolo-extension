/** The part of a commit the graph needs. */
export interface GraphCommit {
  sha: string;
  parents: string[];
}

/** A line in one row between two lanes, in its top half (row top to dot) or bottom half (dot to row bottom). */
export interface GraphSegment {
  fromLane: number;
  toLane: number;
  half: 'top' | 'bottom';
  color: number;
}

export interface GraphRow {
  /** Lane of this row's commit dot. */
  lane: number;
  color: number;
  segments: GraphSegment[];
  /** Number of lanes this row draws in. */
  width: number;
}

/**
 * Lays out the commit graph one row per commit, newest first, as the rows
 * come from `git log`. Each lane waits for one commit: a commit takes the
 * lane waiting for it (or a free one, for a branch tip), and every other lane
 * waiting for it ends in its dot. The lane then waits for the first parent,
 * taking over from a lane further right that already did, and each further
 * parent of a merge joins the lane already waiting for it or opens a new one.
 * Other lanes keep their position, so lines stay straight.
 */
export function layoutGraph(commits: readonly GraphCommit[]): GraphRow[] {
  const lanes: (string | undefined)[] = [];
  const colors: number[] = [];
  let nextColor = 0;
  const freeLane = (): number => {
    const index = lanes.indexOf(undefined);
    return index === -1 ? lanes.length : index;
  };

  return commits.map((commit) => {
    const before = [...lanes];
    const colorsBefore = [...colors];
    const segments: GraphSegment[] = [];

    let lane = before.indexOf(commit.sha);
    if (lane === -1) {
      lane = freeLane();
      colors[lane] = nextColor++;
    }
    const color = colors[lane];

    for (let i = 0; i < before.length; i++) {
      if (before[i] === undefined) {
        continue;
      }
      const endsHere = before[i] === commit.sha;
      segments.push({ fromLane: i, toLane: endsHere ? lane : i, half: 'top', color: colorsBefore[i] });
      if (endsHere) {
        lanes[i] = undefined;
      }
    }
    lanes[lane] = undefined;

    const [firstParent, ...otherParents] = commit.parents;
    if (firstParent !== undefined) {
      const waiting = lanes.indexOf(firstParent);
      if (waiting === -1 || waiting > lane) {
        // Keep the first parent in this lane; a lane further right waiting for it bends in, so main lines stay left.
        lanes[lane] = firstParent;
        colors[lane] = color;
        segments.push({ fromLane: lane, toLane: lane, half: 'bottom', color });
        if (waiting !== -1) {
          lanes[waiting] = undefined;
          segments.push({ fromLane: waiting, toLane: lane, half: 'bottom', color: colorsBefore[waiting] });
        }
      } else {
        segments.push({ fromLane: lane, toLane: waiting, half: 'bottom', color: colors[waiting] });
      }
    }
    for (const parent of otherParents) {
      let target = lanes.indexOf(parent);
      if (target === -1) {
        target = freeLane();
        lanes[target] = parent;
        colors[target] = nextColor++;
      }
      segments.push({ fromLane: lane, toLane: target, half: 'bottom', color: colors[target] });
    }

    // Lanes waiting for other commits before and after this row pass straight through.
    for (let i = 0; i < before.length; i++) {
      if (before[i] !== undefined && before[i] !== commit.sha && lanes[i] === before[i]) {
        segments.push({ fromLane: i, toLane: i, half: 'bottom', color: colorsBefore[i] });
      }
    }

    while (lanes.length > 0 && lanes[lanes.length - 1] === undefined) {
      lanes.pop();
    }
    const width = Math.max(lane + 1, ...segments.map((s) => Math.max(s.fromLane, s.toLane) + 1));
    return { lane, color, segments, width };
  });
}
