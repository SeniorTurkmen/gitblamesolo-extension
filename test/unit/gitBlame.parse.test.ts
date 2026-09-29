import * as assert from 'assert';
import { buildBlameArgs, parseIncrementalBlame, toBlameInfo } from '../../src/git/gitBlame';
import { ZERO_SHA } from '../../src/types';
import { INCREMENTAL_BLAME_OUTPUT } from '../fixtures/git-samples';

describe('parseIncrementalBlame', () => {
  const lines = parseIncrementalBlame(INCREMENTAL_BLAME_OUTPUT);

  it('produces one entry per line of the blamed contents', () => {
    assert.strictEqual(lines.length, 5);
    assert.ok(lines.every((entry) => entry !== undefined));
  });

  it('parses a committed line', () => {
    const info = toBlameInfo(lines, 1);

    assert.ok(info);
    assert.strictEqual(info!.sha, 'abcdef1234567890abcdef1234567890abcdef12');
    assert.strictEqual(info!.isUncommitted, false);
    assert.strictEqual(info!.authorName, 'Ada Lovelace');
    assert.strictEqual(info!.authorEmail, 'ada@example.com');
    assert.strictEqual(info!.authorTimestamp, 1700000000);
    assert.strictEqual(info!.summary, 'Add initial calculation engine');
    assert.strictEqual(info!.line, 1);
    assert.strictEqual(info!.originalLine, 1);
  });

  it('reuses metadata from the first group for later groups of the same commit', () => {
    const info = toBlameInfo(lines, 4);

    assert.ok(info);
    assert.strictEqual(info!.authorName, 'Ada Lovelace');
    assert.strictEqual(info!.summary, 'Add initial calculation engine');
    assert.strictEqual(info!.originalLine, 3);
  });

  it('keeps the original line number when it differs from the final one', () => {
    const info = toBlameInfo(lines, 2);

    assert.ok(info);
    assert.strictEqual(info!.authorName, 'Grace Hopper');
    assert.strictEqual(info!.originalLine, 6);
  });

  it('parses an uncommitted line as ZERO_SHA', () => {
    const info = toBlameInfo(lines, 3);

    assert.ok(info);
    assert.strictEqual(info!.sha, ZERO_SHA);
    assert.strictEqual(info!.isUncommitted, true);
  });

  it('returns nothing for empty output or a line past the end', () => {
    assert.deepStrictEqual(parseIncrementalBlame(''), []);
    assert.strictEqual(toBlameInfo(lines, 5), undefined);
  });
});

describe('buildBlameArgs', () => {
  it('blames the buffer from stdin with no extra flags by default', () => {
    assert.deepStrictEqual(buildBlameArgs('src/a.ts', undefined), [
      'blame',
      '--incremental',
      '--contents',
      '-',
      '--',
      'src/a.ts',
    ]);
  });

  it('adds whitespace, move detection, and ignore-revs flags', () => {
    const args = buildBlameArgs(
      'src/a.ts',
      { ignoreWhitespace: true, detectMovedLines: 'acrossFiles', ignoreRevsFile: '.git-blame-ignore-revs' },
      '/repo/.git-blame-ignore-revs',
    );
    assert.deepStrictEqual(args, [
      'blame',
      '--incremental',
      '-w',
      '-M',
      '-C',
      '--ignore-revs-file',
      '/repo/.git-blame-ignore-revs',
      '--contents',
      '-',
      '--',
      'src/a.ts',
    ]);
  });
});
