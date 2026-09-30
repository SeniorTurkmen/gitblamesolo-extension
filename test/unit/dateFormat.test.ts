import * as assert from 'assert';
import {
  configureDates,
  formatDate,
  formatDecorationText,
  formatUncommittedText,
  resolveDateLocale,
} from '../../src/util/dateFormat';

describe('formatDate', () => {
  const now = new Date('2024-01-10T12:00:00Z').getTime();

  it('formats relative hours in the past', () => {
    const twoHoursAgo = Math.floor(now / 1000) - 2 * 60 * 60;
    const text = formatDate(twoHoursAgo, 'relative', 'en-US', now);
    assert.match(text, /2 hours ago/);
  });

  it('formats absolute dates', () => {
    const timestamp = Math.floor(new Date('2024-01-01T00:00:00Z').getTime() / 1000);
    const text = formatDate(timestamp, 'absolute', 'en-US', now);
    assert.match(text, /2024/);
  });
});

describe('date locale and ISO dates', () => {
  // Local time, so the ISO text doesn't depend on the machine's time zone.
  const timestamp = Math.floor(new Date(2026, 8, 22, 14, 39).getTime() / 1000);
  const now = new Date(2026, 8, 25, 14, 39).getTime();

  afterEach(() => configureDates('en-US', false));

  it("formats dates in the configured locale's conventions", () => {
    configureDates('de-DE', false);
    assert.strictEqual(formatDate(timestamp, 'relative', undefined, now), 'vor 3 Tagen');
    assert.match(formatDate(timestamp, 'absolute'), /^22\.09\.2026/);
    configureDates('tr-TR', false);
    assert.strictEqual(formatDate(timestamp, 'relative', undefined, now), '3 gün önce');
  });

  it('formats ISO dates the same in every locale', () => {
    configureDates('tr-TR', false);
    assert.strictEqual(formatDate(timestamp, 'iso'), '2026-09-22 14:39');
  });

  it('shows exact dates in ISO form when the ISO style is configured', () => {
    configureDates('en-US', true);
    assert.strictEqual(formatDate(timestamp, 'absolute'), '2026-09-22 14:39');
    assert.strictEqual(formatDate(timestamp, 'relative', undefined, now), '3 days ago');
  });

  it("resolves the setting to VS Code's language, the system's, or a tag", () => {
    assert.strictEqual(resolveDateLocale('', 'tr', 'en-GB'), 'tr');
    assert.strictEqual(resolveDateLocale('system', 'tr', 'en-GB'), 'en-GB');
    assert.strictEqual(resolveDateLocale(' de-DE ', 'tr', 'en-GB'), 'de-DE');
  });

  it("falls back to VS Code's language for a tag Intl can't use", () => {
    assert.strictEqual(resolveDateLocale('not a locale', 'tr', 'en-GB'), 'tr');
    assert.strictEqual(resolveDateLocale('xx-YY', 'tr', 'en-GB'), 'tr');
    assert.strictEqual(resolveDateLocale('', 'not a locale', 'en-GB'), 'en-US');
  });
});

describe('formatDecorationText', () => {
  it('replaces all placeholders', () => {
    const text = formatDecorationText(
      { author: 'Ada', authorTimestamp: 0, summary: 'Initial commit', sha: 'abcdef1234567890' },
      '${author} - ${message} (${hash})',
      'absolute',
    );
    assert.strictEqual(text, 'Ada - Initial commit (abcdef1)');
  });
});

describe('formatUncommittedText', () => {
  const now = Date.UTC(2026, 8, 29, 12, 0, 0);

  it('says the file is not saved when there is no save time to trust', () => {
    assert.strictEqual(
      formatUncommittedText('Uncommitted changes', undefined, 'relative', 'en-US', now),
      'Uncommitted changes (file not saved)',
    );
  });

  it('labels the time as the file save time', () => {
    const twelveDaysAgo = now / 1000 - 12 * 24 * 60 * 60;
    assert.strictEqual(
      formatUncommittedText('Uncommitted changes', twelveDaysAgo, 'relative', 'en-US', now),
      'Uncommitted changes, file saved 12 days ago',
    );
  });
});
