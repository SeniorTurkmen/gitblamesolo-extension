/** Unchanged lines shown around a change, as `git diff` does. */
const CONTEXT_LINES = 3;
const MAX_BLOCK_LINES = 30;
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

function parseHunks(zeroContextDiff: string): Hunk[] {
  const hunks: Hunk[] = [];
  for (const row of zeroContextDiff.split('\n')) {
    const match = HUNK_HEADER_RE.exec(row);
    if (match) {
      hunks.push({
        oldStart: parseInt(match[1], 10),
        oldCount: match[2] !== undefined ? parseInt(match[2], 10) : 1,
        newStart: parseInt(match[3], 10),
        newCount: match[4] !== undefined ? parseInt(match[4], 10) : 1,
        lines: [],
      });
    } else if (hunks.length > 0 && (row.startsWith('+') || row.startsWith('-'))) {
      hunks[hunks.length - 1].lines.push(row);
    }
  }
  return hunks;
}

/**
 * The contiguous block of changed lines holding the 1-based `targetLine` of the
 * new file, as a unified hunk with up to three unchanged lines around it.
 * `zeroContextDiff` is a `git diff -U0` of the file, where every block is its
 * own hunk; `newLines` is the new file's text, which the context comes from.
 * Context stops short of neighboring changes, so each block reads on its own
 * instead of merged with changes a few lines away, as `git diff` merges them.
 */
export function changeBlockForLine(
  zeroContextDiff: string,
  newLines: readonly string[],
  targetLine: number,
): string | undefined {
  const hunks = parseHunks(zeroContextDiff);
  const block = hunks.find(
    (h) => h.newCount > 0 && targetLine >= h.newStart && targetLine < h.newStart + h.newCount,
  );
  if (!block) {
    return undefined;
  }

  // A neighbor's changed lines, or the gap where it deleted lines, end the context.
  const others = hunks.filter((h) => h !== block);
  const isChanged = (line: number) =>
    others.some((h) => h.newCount > 0 && line >= h.newStart && line < h.newStart + h.newCount);
  // With a count of 0, git gives the line *after which* the lines were deleted.
  const deletedAfter = (line: number) => others.some((h) => h.newCount === 0 && h.newStart === line);

  const before: string[] = [];
  for (let line = block.newStart - 1; line >= 1 && before.length < CONTEXT_LINES; line--) {
    if (isChanged(line) || deletedAfter(line)) {
      break;
    }
    before.unshift(` ${newLines[line - 1] ?? ''}`);
  }
  const after: string[] = [];
  const end = block.newStart + block.newCount - 1;
  for (let line = end + 1; line <= newLines.length && after.length < CONTEXT_LINES; line++) {
    if (isChanged(line) || deletedAfter(line - 1)) {
      break;
    }
    after.push(` ${newLines[line - 1]}`);
  }

  const oldStart = (block.oldCount === 0 ? block.oldStart + 1 : block.oldStart) - before.length;
  const oldCount = block.oldCount + before.length + after.length;
  const newStart = block.newStart - before.length;
  const newCount = block.newCount + before.length + after.length;
  const header = `@@ -${oldCount === 0 ? 0 : oldStart},${oldCount} +${newStart},${newCount} @@`;

  const body = [...before, ...block.lines, ...after];
  if (body.length > MAX_BLOCK_LINES) {
    return [header, ...body.slice(0, MAX_BLOCK_LINES), `… (${body.length - MAX_BLOCK_LINES} more lines)`].join('\n');
  }
  return [header, ...body].join('\n');
}

/** A file's text as lines, without their line endings. */
export function splitLines(text: string): string[] {
  const lines = text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}
