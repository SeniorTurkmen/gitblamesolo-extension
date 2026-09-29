export type DateStyle = 'relative' | 'absolute';

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 60 * 60 * 24 * 365],
  ['month', 60 * 60 * 24 * 30],
  ['day', 60 * 60 * 24],
  ['hour', 60 * 60],
  ['minute', 60],
];

export function formatDate(unixSeconds: number, style: DateStyle, locale = 'en-US', now = Date.now()): string {
  if (style === 'absolute') {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(unixSeconds * 1000),
    );
  }

  const deltaSeconds = Math.round(unixSeconds - now / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  for (const [unit, secondsInUnit] of RELATIVE_UNITS) {
    if (Math.abs(deltaSeconds) >= secondsInUnit) {
      return rtf.format(Math.round(deltaSeconds / secondsInUnit), unit);
    }
  }
  return rtf.format(deltaSeconds, 'second');
}

/**
 * Git keeps no time for uncommitted lines, so the only honest time is when the
 * file was last saved, and only while it has no unsaved changes: with a dirty
 * buffer the line may have been typed a second ago in a file saved weeks ago.
 */
export function formatUncommittedText(
  label: string,
  savedAtSeconds: number | undefined,
  dateStyle: DateStyle,
  locale = 'en-US',
  now = Date.now(),
): string {
  if (savedAtSeconds === undefined) {
    return `${label} (file not saved)`;
  }
  return `${label}, file saved ${formatDate(savedAtSeconds, dateStyle, locale, now)}`;
}

export interface DecorationTemplateData {
  author: string;
  authorTimestamp: number;
  summary: string;
  sha: string;
}

export function formatDecorationText(
  data: DecorationTemplateData,
  template: string,
  dateStyle: DateStyle,
  locale = 'en-US',
): string {
  return template
    .replace(/\$\{author\}/g, data.author)
    .replace(/\$\{date\}/g, formatDate(data.authorTimestamp, dateStyle, locale))
    .replace(/\$\{message\}/g, data.summary)
    .replace(/\$\{hash\}/g, data.sha.slice(0, 7));
}
