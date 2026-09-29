import * as assert from 'assert';
import { formatAuthor } from '../../src/util/authorFormat';

describe('formatAuthor', () => {
  it('appends the email when enabled', () => {
    assert.strictEqual(formatAuthor('Ada Lovelace', 'ada@example.com', true), 'Ada Lovelace <ada@example.com>');
  });

  it('shows only the name when disabled or when the email is unknown', () => {
    assert.strictEqual(formatAuthor('Ada Lovelace', 'ada@example.com', false), 'Ada Lovelace');
    assert.strictEqual(formatAuthor('Ada Lovelace', '', true), 'Ada Lovelace');
  });
});
