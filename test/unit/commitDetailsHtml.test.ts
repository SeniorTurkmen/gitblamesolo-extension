import * as assert from 'assert';
import { CommitDetailsView, renderCommitDetailsHtml } from '../../src/webview/commitDetailsHtml';
import { CommitDetails, DiffHunk, FileDiff } from '../../src/types';

const SHA = 'abcdef1234567890abcdef1234567890abcdef12';

function commit(overrides: Partial<CommitDetails> = {}): CommitDetails {
  return {
    sha: SHA,
    authorName: 'Ada Lovelace',
    authorEmail: 'ada@example.com',
    authorTimestamp: 1700000000,
    committerTimestamp: 1700000000,
    summary: 'Add the engine',
    body: '',
    coAuthors: [],
    files: [{ status: 'M', path: 'src/a.ts' }],
    ...overrides,
  };
}

const CHANGE: DiffHunk = {
  header: '@@ -1,2 +1,2 @@',
  oldStart: 1,
  oldCount: 2,
  newStart: 1,
  newCount: 2,
  lines: [
    { kind: 'del', text: 'old' },
    { kind: 'add', text: 'new', newLine: 1 },
    { kind: 'context', text: 'same', newLine: 2 },
  ],
};

function diff(path: string, overrides: Partial<FileDiff> = {}): FileDiff {
  return { path, hunks: [CHANGE], truncated: false, ...overrides };
}

function render(view: Partial<CommitDetailsView> = {}): string {
  return renderCommitDetailsHtml({ commit: commit(), diffs: [diff('src/a.ts')], ...view }, 'NONCE');
}

function count(html: string, text: string): number {
  return html.split(text).length - 1;
}

describe('renderCommitDetailsHtml', () => {
  it('allows only its own nonce-tagged script', () => {
    const html = render();
    assert.ok(html.includes("script-src 'nonce-NONCE'"));
    assert.ok(html.includes('<script nonce="NONCE">'));
  });

  it('escapes text from the commit', () => {
    const html = render({
      commit: commit({
        summary: '<img src=x onerror=alert(1)>',
        authorName: 'Eve "quote"',
        body: '<script>alert(1)</script>',
        files: [{ status: 'M', path: 'src/<b>.ts' }],
      }),
      diffs: [diff('src/<b>.ts', { hunks: [{ ...CHANGE, lines: [{ kind: 'add', text: '</div><script>', newLine: 1 }] }] })],
    });

    assert.ok(!html.includes('<img src=x'));
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(!html.includes('</div><script>'));
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(html.includes('Eve &quot;quote&quot;'));
    assert.ok(html.includes('data-path="src/&lt;b&gt;.ts"'));
  });

  it('shows the author with their email, the full hash, and the body', () => {
    const html = render({ commit: commit({ body: 'Why it changed.' }) });
    assert.ok(html.includes('Ada Lovelace &lt;ada@example.com&gt;'));
    assert.ok(html.includes(`<span class="hash">${SHA}</span>`));
    assert.ok(html.includes('<div class="body">Why it changed.</div>'));
  });

  it('lists co-authors only when there are some', () => {
    assert.ok(!render().includes('Co-authored by'));
    const html = render({
      commit: commit({
        coAuthors: [
          { name: 'Grace', email: 'grace@example.com' },
          { name: 'Alan', email: 'alan@example.com' },
        ],
      }),
    });
    assert.ok(html.includes('Co-authored by Grace &lt;grace@example.com&gt;, Alan &lt;alan@example.com&gt;'));
  });

  describe('remote buttons', () => {
    it('shows none without a remote', () => {
      assert.strictEqual(count(render(), 'remote-btn"'), 0);
    });

    it('opens the commit on the remote', () => {
      const html = render({ remoteLink: { provider: 'GitHub', url: 'https://github.com/o/r/commit/abc' } });
      assert.ok(html.includes('data-target="commit"'));
      assert.ok(html.includes('>Open on GitHub</button>'));
      assert.ok(!html.includes('data-target="pullRequest"'));
    });

    it('adds the pull request, called a merge request on GitLab', () => {
      const github = render({
        remoteLink: { provider: 'GitHub', url: 'u', pullRequest: { number: 7, url: 'https://github.com/o/r/pull/7' } },
      });
      assert.ok(github.includes('data-target="pullRequest" title="https://github.com/o/r/pull/7">Open PR #7</button>'));

      const gitlab = render({ remoteLink: { provider: 'GitLab', url: 'u', pullRequest: { number: 7, url: 'mr' } } });
      assert.ok(gitlab.includes('>Open MR !7</button>'));
    });
  });

  describe('changed files', () => {
    it('shows the old path of a renamed file and passes it to Open Diff', () => {
      const html = render({
        commit: commit({ files: [{ status: 'R', path: 'new.ts', oldPath: 'old.ts' }] }),
        diffs: [diff('new.ts', { oldPath: 'old.ts' })],
      });
      assert.ok(html.includes('<span class="old-path">old.ts &rarr;</span>new.ts'));
      assert.ok(html.includes('data-file="new.ts" data-old-file="old.ts"'));
      assert.ok(html.includes('status-R'));
    });

    it('explains files without a diff or without content changes', () => {
      const html = render({
        commit: commit({
          files: [
            { status: 'M', path: 'missing.ts' },
            { status: 'T', path: 'mode.sh' },
          ],
        }),
        diffs: [diff('mode.sh', { hunks: [] })],
      });
      assert.ok(html.includes('No diff available for this file.'));
      assert.ok(html.includes('No content changes.'));
    });

    it('says when a diff was truncated', () => {
      assert.ok(render({ diffs: [diff('src/a.ts', { truncated: true })] }).includes('diff truncated'));
      assert.ok(!render().includes('diff truncated'));
    });

    it('says when the commit changed no files', () => {
      assert.ok(render({ commit: commit({ files: [] }), diffs: [] }).includes('No file changes recorded.'));
    });

    it('offers Revert Hunk only for hunks with changes', () => {
      const contextOnly: DiffHunk = { ...CHANGE, lines: [{ kind: 'context', text: 'same', newLine: 1 }] };
      const html = render({ diffs: [diff('src/a.ts', { hunks: [CHANGE, contextOnly] })] });
      assert.strictEqual(count(html, 'class="revert-btn"'), 1);
      assert.ok(html.includes('data-file="src/a.ts" data-hunk="0"'));
    });
  });

  describe('source line', () => {
    const source = { uri: 'file:///repo/src/a.ts', commitPath: 'src/a.ts', line: 10, commitLine: 1 };

    it('marks the line the panel was opened from', () => {
      const html = render({ source });
      assert.strictEqual(count(html, 'diff-line-source"'), 1);
      assert.ok(html.includes('<div class="diff-line diff-add diff-line-source"'));
    });

    it('matches the file by its path in the commit, not by line number alone', () => {
      const html = render({
        source,
        commit: commit({ files: [{ status: 'M', path: 'src/b.ts' }, { status: 'M', path: 'src/a.ts' }] }),
        diffs: [diff('src/b.ts'), diff('src/a.ts')],
      });
      assert.strictEqual(count(html, 'diff-line-source"'), 1);
      assert.ok(html.indexOf('diff-line-source"') > html.indexOf('data-path="src/a.ts"'));
    });

    it('marks nothing without a source', () => {
      assert.strictEqual(count(render(), 'diff-line-source"'), 0);
    });
  });

  describe('focused file', () => {
    const files = commit({
      files: [
        { status: 'M', path: 'src/b.ts' },
        { status: 'R', path: 'src/new.ts', oldPath: 'src/old.ts' },
      ],
    });

    it('marks the section of the file the panel was opened for', () => {
      const html = render({ commit: files, diffs: [diff('src/b.ts'), diff('src/new.ts')], focusPath: 'src/new.ts' });
      assert.strictEqual(count(html, 'file-section-focus"'), 1);
      assert.strictEqual(count(html, 'Opened from this file'), 1);
      assert.ok(html.indexOf('file-section-focus"') > html.indexOf('data-path="src/b.ts"'));
    });

    it('matches a renamed file by its old path too', () => {
      const html = render({ commit: files, diffs: [], focusPath: 'src/old.ts' });
      assert.strictEqual(count(html, 'file-section-focus"'), 1);
    });

    it('marks nothing without a focused file', () => {
      assert.strictEqual(count(render({ commit: files }), 'file-section-focus"'), 0);
    });
  });
});
