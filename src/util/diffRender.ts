export type DiffRenderLineKind = 'add' | 'del' | 'context';

export interface DiffRenderLine {
  kind: DiffRenderLineKind;
  text: string;
}

export interface DiffStats {
  added: number;
  removed: number;
}

export function countDiffStats(lines: DiffRenderLine[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === 'add') {
      added++;
    } else if (line.kind === 'del') {
      removed++;
    }
  }
  return { added, removed };
}

/**
 * Turns a raw hunk string (as produced by getLineDiffHunk: a "@@ ... @@" header
 * followed by " "/"+"/"-" prefixed lines, possibly ending in a "… (N more lines)"
 * truncation notice) into structured lines for hover rendering.
 */
export function parseDiffHunkLines(diffHunk: string): DiffRenderLine[] {
  const lines: DiffRenderLine[] = [];
  for (const raw of diffHunk.split('\n')) {
    if (raw.length === 0 || raw.startsWith('@@')) {
      continue;
    }
    if (raw.startsWith('…')) {
      lines.push({ kind: 'context', text: raw });
    } else if (raw.startsWith('+')) {
      lines.push({ kind: 'add', text: raw.slice(1) });
    } else if (raw.startsWith('-')) {
      lines.push({ kind: 'del', text: raw.slice(1) });
    } else if (raw.startsWith(' ')) {
      lines.push({ kind: 'context', text: raw.slice(1) });
    }
  }
  return lines;
}
