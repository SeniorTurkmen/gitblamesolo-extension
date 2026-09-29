import { BlameLine, FileBlame } from '../git/gitBlame';
import { DateStyle, formatDecorationText } from './dateFormat';

/** The blame column never grows wider than this many characters; longer text is cut with an ellipsis. */
export const MAX_COLUMN_WIDTH = 50;

export interface FileBlameColumnOptions {
  /** Same placeholders as the inline annotation: ${author} ${date} ${message} ${hash}. */
  template: string;
  dateStyle: DateStyle;
  uncommittedLabel: string;
  /** Replaces the author's name when their email matches `currentUserEmail`; empty to always show the name. */
  currentUserLabel: string;
  currentUserEmail?: string;
  locale?: string;
}

export interface FileBlameColumnLine {
  /** Text for the column, padded with no-break spaces to the column width; blank below the first line of a commit's block. */
  text: string;
  /** How recent the line's commit is among the file's commits: 1 for the newest (and uncommitted lines), 0 for the oldest. */
  heat: number;
}

/**
 * Lays out the blame column shown before every line. Consecutive lines from
 * the same commit form a block and only its first line is labelled, so the
 * blocks stand out.
 */
export function buildFileBlameColumn(
  blame: FileBlame,
  lineCount: number,
  options: FileBlameColumnOptions,
): FileBlameColumnLine[] {
  const heatBySha = commitHeat(blame);
  const labels: string[] = [];
  const heats: number[] = [];
  let previous: BlameLine | undefined;

  for (let i = 0; i < lineCount; i++) {
    const line = blame[i];
    const startsBlock = line !== undefined && (previous === undefined || previous.commit.sha !== line.commit.sha);
    labels.push(line && startsBlock ? lineLabel(line, options) : '');
    heats.push(line ? (heatBySha.get(line.commit.sha) ?? 1) : 1);
    previous = line;
  }

  const width = Math.min(Math.max(0, ...labels.map((label) => label.length)), MAX_COLUMN_WIDTH);
  return labels.map((label, i) => ({ text: fitToWidth(label, width), heat: heats[i] }));
}

function lineLabel(line: BlameLine, options: FileBlameColumnOptions): string {
  if (line.commit.isUncommitted) {
    return options.uncommittedLabel;
  }
  const isCurrentUser =
    options.currentUserLabel &&
    options.currentUserEmail &&
    options.currentUserEmail.toLowerCase() === line.commit.authorEmail.toLowerCase();
  return formatDecorationText(
    {
      author: isCurrentUser ? options.currentUserLabel : line.commit.authorName,
      authorTimestamp: line.commit.authorTimestamp,
      summary: line.commit.summary,
      sha: line.commit.sha,
    },
    options.template,
    options.dateStyle,
    options.locale,
  );
}

/**
 * Ranks the file's commits by author time rather than scaling by time itself,
 * so one very old commit doesn't wash every other line out to the same color.
 */
function commitHeat(blame: FileBlame): Map<string, number> {
  const times = new Map<string, number>();
  for (const line of blame) {
    if (line && !line.commit.isUncommitted) {
      times.set(line.commit.sha, line.commit.authorTimestamp);
    }
  }
  const distinctTimes = [...new Set(times.values())].sort((a, b) => a - b);
  const heat = new Map<string, number>();
  for (const [sha, time] of times) {
    heat.set(sha, distinctTimes.length > 1 ? distinctTimes.indexOf(time) / (distinctTimes.length - 1) : 1);
  }
  return heat;
}

/** Pads with no-break spaces, which the editor doesn't collapse, so the column lines up. */
function fitToWidth(text: string, width: number): string {
  const chars = [...text];
  if (chars.length > width) {
    return chars.slice(0, Math.max(width - 1, 0)).join('') + '…';
  }
  return text + ' '.repeat(width - chars.length);
}

const COOL = [59, 130, 246];
const WARM = [249, 115, 22];

/** Heatmap color from blue (oldest) to orange (newest), translucent so it tints the column. */
export function heatColor(heat: number): string {
  const t = Math.min(Math.max(heat, 0), 1);
  const [r, g, b] = COOL.map((cool, i) => Math.round(cool + (WARM[i] - cool) * t));
  return `rgba(${r}, ${g}, ${b}, 0.25)`;
}
