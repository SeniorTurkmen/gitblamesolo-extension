import { execFile } from 'child_process';

/**
 * Turns an operating system locale name into a BCP 47 tag: `tr_TR.UTF-8` and
 * `tr_TR` become `tr-TR`. A macOS region override such as `en_US@rg=dezzzz`
 * (English, formats for Germany) becomes `en-DE`. Undefined for `C`, `POSIX`,
 * or an empty value, which name no language.
 */
export function localeFromSystemName(name: string | undefined): string | undefined {
  const [base, modifiers = ''] = (name ?? '').trim().split('@');
  const locale = base.split('.')[0].replace(/_/g, '-');
  if (!locale || locale === 'C' || locale === 'POSIX') {
    return undefined;
  }
  const region = /(?:^|;)rg=([a-z]{2})zzzz/i.exec(modifiers)?.[1];
  return region ? `${locale.split('-')[0]}-${region.toUpperCase()}` : locale;
}

function appleLocale(): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('defaults', ['read', '-g', 'AppleLocale'], { timeout: 2000 }, (err, stdout) =>
      resolve(err ? undefined : localeFromSystemName(stdout)),
    );
  });
}

/**
 * The locale the operating system formats dates in. The extension host's own
 * default can't be trusted for this: an app started outside a terminal may get
 * no locale variables, and ICU then falls back to en-US or `und`. So macOS is
 * asked for its region setting, and elsewhere the locale variables are read,
 * the date one first. Windows' default already comes from the user's settings.
 */
export async function detectSystemLocale(): Promise<string> {
  const intlDefault = Intl.DateTimeFormat().resolvedOptions().locale;
  if (process.platform === 'win32') {
    return intlDefault;
  }
  const fromOs =
    (process.platform === 'darwin' ? await appleLocale() : undefined) ??
    localeFromSystemName(process.env.LC_ALL || process.env.LC_TIME || process.env.LANG);
  return fromOs ?? intlDefault;
}
