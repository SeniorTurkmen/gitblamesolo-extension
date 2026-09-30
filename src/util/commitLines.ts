import { FileBlame } from '../git/gitBlame';

/** A run of consecutive lines, 0-based and inclusive. */
export interface LineRun {
  start: number;
  end: number;
}

/** The runs of lines that the commit `sha` last changed, top to bottom. */
export function commitLineRuns(fileBlame: FileBlame, sha: string): LineRun[] {
  const runs: LineRun[] = [];
  fileBlame.forEach((line, index) => {
    if (line.commit.sha !== sha) {
      return;
    }
    const last = runs[runs.length - 1];
    if (last && last.end === index - 1) {
      last.end = index;
    } else {
      runs.push({ start: index, end: index });
    }
  });
  return runs;
}
