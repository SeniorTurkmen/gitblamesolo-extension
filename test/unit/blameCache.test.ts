import * as assert from 'assert';
import { BlameCache, ContentChangeLike } from '../../src/cache/blameCache';
import { BlameLine, FileBlame } from '../../src/git/gitBlame';

function fakeDocument(uri: string, version: number) {
  return { uri: { toString: () => uri }, version };
}

function committedLine(sha: string, originalLine: number): BlameLine {
  return {
    commit: {
      sha,
      isUncommitted: false,
      authorName: 'Ada',
      authorEmail: 'ada@example.com',
      authorTimestamp: 0,
      summary: `commit ${sha}`,
    },
    origin: { filename: 'file.txt' },
    originalLine,
  };
}

/** Blame for a file whose line i comes from commit `c<i>`. */
function fakeBlame(lineCount: number): FileBlame {
  return Array.from({ length: lineCount }, (_, i) => committedLine(`c${i}`, i));
}

function change(startLine: number, endLine: number, text: string): ContentChangeLike {
  return { range: { start: { line: startLine }, end: { line: endLine } }, text };
}

describe('BlameCache', () => {
  it('blames the whole file once per document version', async () => {
    const cache = new BlameCache();
    let calls = 0;
    const compute = async () => {
      calls++;
      return fakeBlame(3);
    };

    const doc = fakeDocument('file:///a.ts', 1);
    const first = await cache.getLine(doc, 0, compute);
    const third = await cache.getLine(doc, 2, compute);

    assert.strictEqual(calls, 1);
    assert.strictEqual(first!.sha, 'c0');
    assert.strictEqual(third!.sha, 'c2');
  });

  it('recomputes when the document version changes without a tracked edit', async () => {
    const cache = new BlameCache();
    let calls = 0;
    const compute = async () => {
      calls++;
      return fakeBlame(3);
    };

    await cache.getLine(fakeDocument('file:///a.ts', 1), 0, compute);
    await cache.getLine(fakeDocument('file:///a.ts', 2), 0, compute);

    assert.strictEqual(calls, 2);
  });

  it('shifts lines below an inserted line and marks the inserted lines uncommitted', async () => {
    const cache = new BlameCache();
    let calls = 0;
    const compute = async () => {
      calls++;
      return fakeBlame(3);
    };
    await cache.getLine(fakeDocument('file:///a.ts', 1), 0, compute);

    // Replace line 1 with two lines.
    const v2 = fakeDocument('file:///a.ts', 2);
    cache.applyChanges(v2, [change(1, 1, 'new\nlines')]);

    assert.strictEqual((await cache.getLine(v2, 0, compute))!.sha, 'c0');
    assert.strictEqual((await cache.getLine(v2, 1, compute))!.isUncommitted, true);
    assert.strictEqual((await cache.getLine(v2, 2, compute))!.isUncommitted, true);
    const shifted = await cache.getLine(v2, 3, compute);
    assert.strictEqual(shifted!.sha, 'c2');
    assert.strictEqual(shifted!.line, 3);
    assert.strictEqual(shifted!.originalLine, 2);
    assert.strictEqual(calls, 1);
  });

  it('shifts lines up when lines are deleted', async () => {
    const cache = new BlameCache();
    const compute = async () => fakeBlame(4);
    await cache.getLine(fakeDocument('file:///a.ts', 1), 0, compute);

    // Join lines 1 and 2 into one.
    const v2 = fakeDocument('file:///a.ts', 2);
    cache.applyChanges(v2, [change(1, 2, '')]);

    assert.strictEqual((await cache.getLine(v2, 1, compute))!.isUncommitted, true);
    assert.strictEqual((await cache.getLine(v2, 2, compute))!.sha, 'c3');
    assert.strictEqual(await cache.getLine(v2, 3, compute), undefined);
  });

  it('applies several changes from one event in order', async () => {
    const cache = new BlameCache();
    const compute = async () => fakeBlame(4);
    await cache.getLine(fakeDocument('file:///a.ts', 1), 0, compute);

    const v2 = fakeDocument('file:///a.ts', 2);
    cache.applyChanges(v2, [change(3, 3, 'x\n'), change(0, 0, 'y\n')]);

    const shas = [];
    for (let line = 0; line < 6; line++) {
      const info = await cache.getLine(v2, line, compute);
      shas.push(info!.isUncommitted ? 'new' : info!.sha);
    }
    assert.deepStrictEqual(shas, ['new', 'new', 'c1', 'c2', 'new', 'new']);
  });

  it('drops a pending blame when the document changes before it settles', async () => {
    const cache = new BlameCache();
    let calls = 0;
    let release: (lines: FileBlame) => void = () => undefined;
    const slowCompute = () => {
      calls++;
      return new Promise<FileBlame>((resolve) => {
        release = resolve;
      });
    };

    const pending = cache.getLine(fakeDocument('file:///a.ts', 1), 0, slowCompute);
    const v2 = fakeDocument('file:///a.ts', 2);
    cache.applyChanges(v2, [change(0, 0, 'edited')]);
    release(fakeBlame(1));
    await pending;

    await cache.getLine(v2, 0, async () => {
      calls++;
      return fakeBlame(1);
    });
    assert.strictEqual(calls, 2);
  });

  it('recomputes after delete and clear', async () => {
    const cache = new BlameCache();
    let calls = 0;
    const compute = async () => {
      calls++;
      return fakeBlame(1);
    };
    const doc = fakeDocument('file:///a.ts', 1);

    await cache.getLine(doc, 0, compute);
    cache.delete(doc.uri);
    await cache.getLine(doc, 0, compute);
    cache.clear();
    await cache.getLine(doc, 0, compute);

    assert.strictEqual(calls, 3);
  });

  it('does not cache a failed blame', async () => {
    const cache = new BlameCache();
    const doc = fakeDocument('file:///a.ts', 1);

    await assert.rejects(() => cache.getLine(doc, 0, () => Promise.reject(new Error('boom'))));
    const info = await cache.getLine(doc, 0, async () => fakeBlame(1));
    assert.strictEqual(info!.sha, 'c0');
  });

  describe('refresh', () => {
    it('replaces the shifted blame, so a line edited back to its committed text is blamed again', async () => {
      const cache = new BlameCache();
      await cache.getLine(fakeDocument('file:///a.ts', 1), 1, async () => fakeBlame(3));
      const v2 = fakeDocument('file:///a.ts', 2);
      cache.applyChanges(v2, [change(1, 1, 'line 1')]);
      assert.strictEqual((await cache.getLine(v2, 1, async () => fakeBlame(3)))!.isUncommitted, true);

      assert.strictEqual(await cache.refresh(v2, async () => fakeBlame(3)), true);
      assert.strictEqual((await cache.getLine(v2, 1, async () => assert.fail('recomputed')))!.sha, 'c1');
    });

    it('drops a result for content that was edited while it ran', async () => {
      const cache = new BlameCache();
      await cache.getLine(fakeDocument('file:///a.ts', 1), 0, async () => fakeBlame(2));
      const v2 = fakeDocument('file:///a.ts', 2);
      cache.applyChanges(v2, [change(0, 0, 'edited')]);

      let release: (lines: FileBlame) => void = () => undefined;
      const refreshing = cache.refresh(v2, () => new Promise<FileBlame>((resolve) => (release = resolve)));
      const v3 = fakeDocument('file:///a.ts', 3);
      cache.applyChanges(v3, [change(1, 1, 'edited too')]);
      release(fakeBlame(2));

      assert.strictEqual(await refreshing, false);
      const info = await cache.getLine(v3, 0, async () => assert.fail('recomputed'));
      assert.strictEqual(info!.isUncommitted, true);
    });

    it('keeps the shifted blame when git fails', async () => {
      const cache = new BlameCache();
      await cache.getLine(fakeDocument('file:///a.ts', 1), 0, async () => fakeBlame(2));
      const v2 = fakeDocument('file:///a.ts', 2);
      cache.applyChanges(v2, [change(0, 0, 'edited')]);

      assert.strictEqual(await cache.refresh(v2, async () => undefined), false);
      assert.strictEqual(await cache.refresh(v2, () => Promise.reject(new Error('boom'))), false);
      assert.strictEqual((await cache.getLine(v2, 1, async () => assert.fail('recomputed')))!.sha, 'c1');
    });

    it('does nothing for a document it has no settled blame for', async () => {
      const cache = new BlameCache();
      let calls = 0;
      const compute = async () => {
        calls++;
        return fakeBlame(1);
      };
      assert.strictEqual(await cache.refresh(fakeDocument('file:///a.ts', 1), compute), false);
      assert.strictEqual(calls, 0);
    });
  });
});
