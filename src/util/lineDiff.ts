/** Lines of unchanged text shown around a change, as `git diff` does. */
const CONTEXT_LINES = 3;
const MAX_HUNK_LINES = 30;
/** Past this many edits the texts are treated as one replaced block, so a rewritten file can't stall the hover. */
const MAX_EDITS = 2000;

type Op = { kind: ' ' | '-' | '+'; text: string; oldIndex: number; newIndex: number };

function splitLines(text: string): string[] {
  if (text === '') {
    return [];
  }
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/** Myers' shortest edit script between two line arrays, or undefined past `MAX_EDITS`. */
function myers(a: readonly string[], b: readonly string[]): Array<' ' | '-' | '+'> | undefined {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_EDITS);
  const offset = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      next[offset + k] = x;
      if (x >= n && y >= m) {
        return backtrack(trace, offset, n, m, d);
      }
    }
    v = next;
  }
  return undefined;
}

function backtrack(
  trace: Int32Array[],
  offset: number,
  n: number,
  m: number,
  depth: number,
): Array<' ' | '-' | '+'> {
  const ops: Array<' ' | '-' | '+'> = [];
  let x = n;
  let y = m;
  for (let d = depth; d > 0; d--) {
    const v = trace[d];
    const k = x - y;
    const down = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]);
    const prevK = down ? k + 1 : k - 1;
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push(' ');
      x--;
      y--;
    }
    ops.push(down ? '+' : '-');
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    ops.push(' ');
    x--;
    y--;
  }
  return ops.reverse();
}

function editScript(oldLines: readonly string[], newLines: readonly string[]): Op[] {
  // Trimming the unchanged start and end keeps the search to the part that changed.
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start++;
  }
  let end = 0;
  while (
    end < oldLines.length - start &&
    end < newLines.length - start &&
    oldLines[oldLines.length - 1 - end] === newLines[newLines.length - 1 - end]
  ) {
    end++;
  }
  const oldMiddle = oldLines.slice(start, oldLines.length - end);
  const newMiddle = newLines.slice(start, newLines.length - end);
  const middle =
    myers(oldMiddle, newMiddle) ??
    [...oldMiddle.map(() => '-' as const), ...newMiddle.map(() => '+' as const)];

  const ops: Op[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  const push = (kind: ' ' | '-' | '+') => {
    const text = kind === '+' ? newLines[newIndex] : oldLines[oldIndex];
    ops.push({ kind, text, oldIndex, newIndex });
    if (kind !== '+') {
      oldIndex++;
    }
    if (kind !== '-') {
      newIndex++;
    }
  };
  for (let i = 0; i < start; i++) {
    push(' ');
  }
  middle.forEach(push);
  for (let i = 0; i < end; i++) {
    push(' ');
  }
  return ops;
}

/**
 * The unified diff hunk, with `git diff`'s context, holding the change that
 * turned `oldText` into `newText` at the 0-based `line` of `newText`; undefined
 * when that line is unchanged.
 */
export function diffHunkForLine(oldText: string, newText: string, line: number): string | undefined {
  const ops = editScript(splitLines(oldText), splitLines(newText));
  const target = ops.findIndex((op) => op.kind === '+' && op.newIndex === line);
  if (target === -1) {
    return undefined;
  }

  // Grow the hunk while another change sits within twice the context, as git merges those into one hunk.
  let first = target;
  let last = target;
  for (let i = target - 1; i >= 0 && first - i <= 2 * CONTEXT_LINES + 1; i--) {
    if (ops[i].kind !== ' ') {
      first = i;
    }
  }
  for (let i = target + 1; i < ops.length && i - last <= 2 * CONTEXT_LINES + 1; i++) {
    if (ops[i].kind !== ' ') {
      last = i;
    }
  }
  const from = Math.max(0, first - CONTEXT_LINES);
  const to = Math.min(ops.length - 1, last + CONTEXT_LINES);
  const slice = ops.slice(from, to + 1);

  const oldCount = slice.filter((op) => op.kind !== '+').length;
  const newCount = slice.filter((op) => op.kind !== '-').length;
  const oldStart = oldCount === 0 ? slice[0].oldIndex : slice[0].oldIndex + 1;
  const newStart = newCount === 0 ? slice[0].newIndex : slice[0].newIndex + 1;
  const body = slice.map((op) => `${op.kind}${op.text}`);
  const header = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;

  if (body.length > MAX_HUNK_LINES) {
    return [header, ...body.slice(0, MAX_HUNK_LINES), `… (${body.length - MAX_HUNK_LINES} more lines)`].join('\n');
  }
  return [header, ...body].join('\n');
}
