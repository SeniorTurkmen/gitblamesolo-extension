export interface DiffStats {
  added: number;
  removed: number;
}

export function countDiffStats(diffHunk: string): DiffStats {
  let added = 0;
  let removed = 0;
  for (const line of diffHunk.split('\n')) {
    if (line.startsWith('@@')) {
      continue;
    }
    if (line.startsWith('+')) {
      added++;
    } else if (line.startsWith('-')) {
      removed++;
    }
  }
  return { added, removed };
}
