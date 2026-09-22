import * as assert from 'assert';
import { BlameCache } from '../../src/cache/blameCache';
import { BlameInfo } from '../../src/types';

function fakeDocument(uri: string, version: number) {
  return { uri: { toString: () => uri }, version };
}

function fakeBlame(line: number): BlameInfo {
  return {
    sha: 'a'.repeat(40),
    isUncommitted: false,
    authorName: 'Ada',
    authorEmail: 'ada@example.com',
    authorTimestamp: 0,
    summary: 'test',
    line,
  };
}

describe('BlameCache', () => {
  it('caches by document uri + version + line', async () => {
    const cache = new BlameCache();
    let calls = 0;
    const compute = async () => {
      calls++;
      return fakeBlame(1);
    };

    const doc = fakeDocument('file:///a.ts', 1);
    await cache.getOrCompute(doc, 1, compute);
    await cache.getOrCompute(doc, 1, compute);

    assert.strictEqual(calls, 1);
  });

  it('invalidates entries from older document versions', async () => {
    const cache = new BlameCache();
    let calls = 0;
    const compute = async () => {
      calls++;
      return fakeBlame(1);
    };

    const docV1 = fakeDocument('file:///a.ts', 1);
    await cache.getOrCompute(docV1, 1, compute);

    const docV2 = fakeDocument('file:///a.ts', 2);
    await cache.getOrCompute(docV2, 1, compute);

    // Recomputing for the (now stale) v1 key should run again, proving it was evicted.
    await cache.getOrCompute(docV1, 1, compute);

    assert.strictEqual(calls, 3);
  });
});
