import * as assert from 'assert';
import { parseCommitDetails } from '../../src/git/gitLog';
import { COMMIT_SHOW_OUTPUT } from '../fixtures/porcelain-samples';

describe('parseCommitDetails', () => {
  it('parses fields separated by the unit separator', () => {
    const details = parseCommitDetails(COMMIT_SHOW_OUTPUT, 'fallback-sha');

    assert.strictEqual(details.sha, 'abcdef1234567890abcdef1234567890abcdef12');
    assert.strictEqual(details.authorName, 'Ada Lovelace');
    assert.strictEqual(details.authorEmail, 'ada@example.com');
    assert.strictEqual(details.authorTimestamp, 1700000000);
    assert.strictEqual(details.committerTimestamp, 1700000100);
    assert.strictEqual(details.summary, 'Add initial calculation engine');
    assert.ok(details.body.includes('It supports add and subtract.'));

    assert.strictEqual(details.files.length, 3);
    assert.deepStrictEqual(details.files[0], { status: 'M', path: 'src/engine.ts' });
    assert.deepStrictEqual(details.files[1], { status: 'A', path: 'src/engine.test.ts' });
    assert.deepStrictEqual(details.files[2], { status: 'R', path: 'new/path.ts', oldPath: 'old/path.ts' });
  });

  it('falls back to the provided sha when output is empty', () => {
    const details = parseCommitDetails('', 'fallback-sha');
    assert.strictEqual(details.sha, 'fallback-sha');
  });
});
