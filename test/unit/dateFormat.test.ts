import * as assert from 'assert';
import { formatDate, formatDecorationText } from '../../src/util/dateFormat';

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
