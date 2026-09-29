import * as assert from 'assert';
import { formatDate, formatDecorationText, formatUncommittedText } from '../../src/util/dateFormat';

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
