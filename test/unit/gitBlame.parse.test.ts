import * as assert from 'assert';
import { parsePorcelainBlame } from '../../src/git/gitBlame';
import { ZERO_SHA } from '../../src/types';
import { COMMITTED_LINE_PORCELAIN, UNCOMMITTED_LINE_PORCELAIN } from '../fixtures/porcelain-samples';

describe('parsePorcelainBlame', () => {
  it('parses a committed line', () => {
    const info = parsePorcelainBlame(COMMITTED_LINE_PORCELAIN, 2);

    assert.strictEqual(info.sha, 'abcdef1234567890abcdef1234567890abcdef12');
    assert.strictEqual(info.isUncommitted, false);
    assert.strictEqual(info.authorName, 'Ada Lovelace');
    assert.strictEqual(info.authorEmail, 'ada@example.com');
    assert.strictEqual(info.authorTimestamp, 1700000000);
    assert.strictEqual(info.summary, 'Add initial calculation engine');
    assert.strictEqual(info.line, 2);
    assert.strictEqual(info.originalLine, 2);
  });

  it('parses an uncommitted line as ZERO_SHA', () => {
    const info = parsePorcelainBlame(UNCOMMITTED_LINE_PORCELAIN, 4);

    assert.strictEqual(info.sha, ZERO_SHA);
    assert.strictEqual(info.isUncommitted, true);
  });

  it('throws on empty output', () => {
    assert.throws(() => parsePorcelainBlame('', 0));
  });
});
