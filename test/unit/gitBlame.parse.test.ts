import * as assert from 'assert';
import { buildBlameArgs, parseIncrementalBlame, toBlameInfo, unquoteGitPath } from '../../src/git/gitBlame';
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

  it('records the commit and path each line had before its commit', () => {
    assert.deepStrictEqual(toBlameInfo(lines, 2)!.previous, {
      sha: 'abcdef1234567890abcdef1234567890abcdef12',
      filename: 'src/engine.ts',
    });
    assert.strictEqual(toBlameInfo(lines, 2)!.filename, 'src/engine.ts');
    // A boundary commit created its lines, so there is nothing before it.
    assert.strictEqual(toBlameInfo(lines, 0)!.previous, undefined);
  });

  it('reads previous and filename per group, not per commit', () => {
    const sha = 'cccccccccccccccccccccccccccccccccccccccc';
    const output = [
      `${sha} 1 1 1`,
      'author Ada',
      'summary Rename',
      'previous dddddddddddddddddddddddddddddddddddddddd "old n\\303\\244me.txt"',
      'filename "n\\303\\244me.txt"',
      `${sha} 5 2 1`,
      'filename "n\\303\\244me.txt"',
      '',
    ].join('\n');
    const parsed = parseIncrementalBlame(output);

    assert.strictEqual(toBlameInfo(parsed, 0)!.filename, 'näme.txt');
    assert.deepStrictEqual(toBlameInfo(parsed, 0)!.previous, {
      sha: 'dddddddddddddddddddddddddddddddddddddddd',
      filename: 'old näme.txt',
    });
    assert.strictEqual(toBlameInfo(parsed, 1)!.filename, 'näme.txt');
    assert.strictEqual(toBlameInfo(parsed, 1)!.previous, undefined);
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

describe('buildBlameArgs with a revision', () => {
  it('blames the revision instead of reading the buffer from stdin', () => {
    assert.deepStrictEqual(buildBlameArgs('src/a.ts', undefined, undefined, 'abc123'), [
      'blame',
      '--incremental',
      'abc123',
      '--',
      'src/a.ts',
    ]);
  });
});

describe('unquoteGitPath', () => {
  it('leaves plain paths alone', () => {
    assert.strictEqual(unquoteGitPath('src/a b.ts'), 'src/a b.ts');
  });

  it('decodes octal escapes as UTF-8 bytes', () => {
    assert.strictEqual(unquoteGitPath('"dosya \\303\\274.txt"'), 'dosya ü.txt');
  });

  it('decodes character escapes', () => {
    assert.strictEqual(unquoteGitPath('"a\\tb\\"c\\\\d"'), 'a\tb"c\\d');
  });
});
