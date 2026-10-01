const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export interface PeekLine {
  kind: 'add' | 'del' | 'context';
  text: string;
  /** 1-based line in the old version; unset for added lines and the truncation notice. */
  oldLine?: number;
  /** 1-based line in the new version; unset for removed lines and the truncation notice. */
  newLine?: number;
}

/** A hunk's lines with each one's old and new line numbers, as a side-by-side gutter shows them. */
export function numberHunkLines(hunk: string): PeekLine[] {
  const rows = hunk.split('\n');
  const header = HUNK_HEADER_RE.exec(rows[0] ?? '');
  if (!header) {
    return [];
  }
  const oldCount = header[2] !== undefined ? parseInt(header[2], 10) : 1;
  const newCount = header[4] !== undefined ? parseInt(header[4], 10) : 1;
  // A count of 0 gives the line before the (empty) range, so the next line is one past it.
  let oldLine = parseInt(header[1], 10) + (oldCount === 0 ? 1 : 0);
  let newLine = parseInt(header[3], 10) + (newCount === 0 ? 1 : 0);

  const lines: PeekLine[] = [];
  for (const row of rows.slice(1)) {
    if (row.startsWith('+')) {
      lines.push({ kind: 'add', text: row.slice(1), newLine: newLine++ });
    } else if (row.startsWith('-')) {
      lines.push({ kind: 'del', text: row.slice(1), oldLine: oldLine++ });
    } else if (row.startsWith(' ')) {
      lines.push({ kind: 'context', text: row.slice(1), oldLine: oldLine++, newLine: newLine++ });
    } else if (row.startsWith('…')) {
      lines.push({ kind: 'context', text: row });
    }
  }
  return lines;
}
