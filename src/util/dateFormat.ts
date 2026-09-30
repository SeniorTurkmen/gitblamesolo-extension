export type DateStyle = 'relative' | 'absolute' | 'iso';

/** How dates read everywhere: the locale, and whether exact dates are ISO (`2026-09-22 14:39`) or the locale's. */
const dateSettings = { locale: 'en-US', iso: false };

/** Sets the locale and exact-date format that every later formatDate call without an explicit locale uses. */
export function configureDates(locale: string, iso: boolean): void {
  dateSettings.locale = locale;
  dateSettings.iso = iso;
}

/**
 * The locale for the `dateLocale` setting: `system` for the operating
 * system's, `vscode` (or empty) for VS Code's display language, otherwise a
 * BCP 47 tag such as `de-DE`. A tag Intl can't use falls back to VS Code's language.
 */
export function resolveDateLocale(setting: string, displayLanguage: string, systemLocale: string): string {
  const requested = setting.trim();
  const keyword = requested.toLowerCase();
  const candidate = !requested || keyword === 'vscode' ? displayLanguage : keyword === 'system' ? systemLocale : requested;
  for (const locale of [candidate, displayLanguage]) {
    try {
      if (Intl.DateTimeFormat.supportedLocalesOf([locale]).length > 0) {
        return locale;
      }
    } catch {
      // Not a valid language tag.
    }
  }
  return 'en-US';
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `2026-09-22 14:39` in local time: the same in every locale, and it sorts. */
function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 60 * 60 * 24 * 365],
  ['month', 60 * 60 * 24 * 30],
  ['day', 60 * 60 * 24],
  ['hour', 60 * 60],
  ['minute', 60],
];

/**
 * Formats a commit time. `absolute` is an exact date, in ISO form when the
 * `iso` style is configured; `relative` reads like "3 days ago" in the locale.
 */
export function formatDate(
  unixSeconds: number,
  style: DateStyle,
  locale = dateSettings.locale,
  now = Date.now(),
): string {
  if (style === 'iso' || (style === 'absolute' && dateSettings.iso)) {
    return isoDate(new Date(unixSeconds * 1000));
  }
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
  locale = dateSettings.locale,
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
  locale = dateSettings.locale,
): string {
  return template
    .replace(/\$\{author\}/g, data.author)
    .replace(/\$\{date\}/g, formatDate(data.authorTimestamp, dateStyle, locale))
    .replace(/\$\{message\}/g, data.summary)
    .replace(/\$\{hash\}/g, data.sha.slice(0, 7));
}
