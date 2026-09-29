import * as assert from 'assert';
import { buildHistoryArgs, parseHistory, parseRefs } from '../../src/git/gitHistory';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);

function record(fields: string[]): string {
  return '\x1e' + fields.join('\x1f') + '\n';
}

describe('parseRefs', () => {
  it('reads the checked-out branch, remote branches, and tags', () => {
    assert.deepStrictEqual(parseRefs('HEAD -> main, origin/main, tag: v1.0, feature'), [
      { kind: 'head', name: 'HEAD' },
      { kind: 'branch', name: 'main' },
      { kind: 'remote', name: 'origin/main' },
      { kind: 'tag', name: 'v1.0' },
      { kind: 'branch', name: 'feature' },
    ]);
  });

  it('reads a detached HEAD and skips the remote default branch', () => {
    assert.deepStrictEqual(parseRefs('HEAD, origin/HEAD, upstream/dev', ['origin', 'upstream']), [
      { kind: 'head', name: 'HEAD' },
      { kind: 'remote', name: 'upstream/dev' },
    ]);
  });

  it('treats a branch with a slash as local unless it starts with a remote name', () => {
    assert.deepStrictEqual(parseRefs('feature/login', ['origin']), [{ kind: 'branch', name: 'feature/login' }]);
    assert.deepStrictEqual(parseRefs(''), []);
  });
});

describe('parseHistory', () => {
  it('reads each commit with its parents and refs', () => {
    const output =
      record([SHA_C, `${SHA_A} ${SHA_B}`, 'Ada', 'ada@example.com', '1700000000', "Merge branch 'x'", 'HEAD -> main']) +
      record([SHA_A, '', 'Bob', 'bob@example.com', '1600000000', 'Root: a|b', '']);
    const entries = parseHistory(output);
    assert.strictEqual(entries.length, 2);
    assert.deepStrictEqual(entries[0], {
      sha: SHA_C,
      parents: [SHA_A, SHA_B],
      authorName: 'Ada',
      authorEmail: 'ada@example.com',
      authorTimestamp: 1700000000,
      summary: "Merge branch 'x'",
      refs: [
        { kind: 'head', name: 'HEAD' },
        { kind: 'branch', name: 'main' },
      ],
    });
    assert.deepStrictEqual(entries[1].parents, []);
    assert.strictEqual(entries[1].summary, 'Root: a|b');
    assert.deepStrictEqual(entries[1].refs, []);
  });

  it('reads empty output as no commits', () => {
    assert.deepStrictEqual(parseHistory(''), []);
  });
});

describe('buildHistoryArgs', () => {
  it('lists the current branch a page at a time, asking for one extra commit', () => {
    const args = buildHistoryArgs({ scope: { kind: 'head' }, skip: 200, limit: 100 });
    assert.ok(args.includes('--skip=200'));
    assert.ok(args.includes('--max-count=101'));
    assert.deepStrictEqual(args.slice(-2), ['HEAD', '--']);
    assert.ok(!args.includes('--fixed-strings'));
  });

  it('lists every branch, remote branch, and tag, but not stashes', () => {
    const args = buildHistoryArgs({ scope: { kind: 'all' }, skip: 0, limit: 10 });
    assert.deepStrictEqual(args.slice(-5), ['--branches', '--remotes', '--tags', 'HEAD', '--']);
    assert.ok(!args.includes('--all'));
  });

  it('matches author and message text literally, ignoring case', () => {
    const args = buildHistoryArgs({ scope: { kind: 'ref', ref: 'dev' }, author: 'ada', search: 'fix(', skip: 0, limit: 10 });
    assert.ok(args.includes('--regexp-ignore-case'));
    assert.ok(args.includes('--fixed-strings'));
    assert.ok(args.includes('--author=ada'));
    assert.ok(args.includes('--grep=fix('));
    assert.deepStrictEqual(args.slice(-2), ['dev', '--']);
  });

  it('follows a file through renames', () => {
    const args = buildHistoryArgs({ scope: { kind: 'head' }, path: 'src/a.ts', skip: 0, limit: 10 });
    assert.deepStrictEqual(args.slice(-4), ['HEAD', '--follow', '--', 'src/a.ts']);
  });
});
