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
