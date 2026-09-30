import * as assert from 'assert';
import { HistoryEntry } from '../../src/git/gitHistory';
import { layoutGraph } from '../../src/util/historyGraph';
import { renderGraphSvg, renderHistoryRows, renderHistoryShell, renderRefs } from '../../src/webview/historyHtml';

const NOW = 1700000000 * 1000;

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    sha: 'abcdef1234567890abcdef1234567890abcdef12',
    parents: [],
    authorName: 'Ada <Lovelace>',
    authorEmail: 'ada@example.com',
    authorTimestamp: 1700000000 - 3600,
    summary: 'Fix <script>alert(1)</script>',
    refs: [],
    ...overrides,
  };
}

const OPTIONS = { dateStyle: 'relative' as const, currentUserLabel: 'You', now: NOW };

describe('renderHistoryRows', () => {
  it('escapes the summary and author and shows the short SHA', () => {
    const html = renderHistoryRows([entry()], undefined, OPTIONS);
    assert.ok(html.includes('Fix &lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(html.includes('Ada &lt;Lovelace&gt;'));
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('data-sha="abcdef1234567890abcdef1234567890abcdef12"'));
    assert.ok(html.includes('>abcdef1<'));
    assert.ok(!html.includes('<svg'));
  });

  it("carries the file's path in the commit for a file's history", () => {
    assert.ok(renderHistoryRows([entry({ path: 'src/<a>.ts' })], undefined, OPTIONS).includes('data-path="src/&lt;a&gt;.ts"'));
    assert.ok(!renderHistoryRows([entry()], undefined, OPTIONS).includes('data-path'));
  });

  it("lets the author be clicked to filter by their email", () => {
    const html = renderHistoryRows([entry()], undefined, OPTIONS);
    assert.ok(html.includes('data-author="ada@example.com"'));
    assert.ok(renderHistoryRows([entry({ authorEmail: '' })], undefined, OPTIONS).includes('data-author="Ada &lt;Lovelace&gt;"'));
  });

  it("offers Open and Compare for a file's history, and Compare… otherwise", () => {
    const plain = renderHistoryRows([entry()], undefined, OPTIONS);
    assert.ok(plain.includes('class="act copy"'));
    assert.ok(plain.includes('class="act compare-from"'));
    assert.ok(!plain.includes('open-file'));
    const file = renderHistoryRows([entry({ path: 'a.ts' })], undefined, { ...OPTIONS, fileActions: true });
    assert.ok(file.includes('class="act open-file"'));
    assert.ok(file.includes('class="act compare"'));
    assert.ok(!file.includes('compare-from'));
  });

  it('marks commits that are not pushed', () => {
    const sha = entry().sha;
    const html = renderHistoryRows([entry()], undefined, { ...OPTIONS, unpushed: new Set([sha]) });
    assert.ok(html.includes('ref-unpushed'));
    assert.ok(!renderHistoryRows([entry()], undefined, { ...OPTIONS, unpushed: new Set() }).includes('ref-unpushed'));
  });

  it('shows the current user label for their own commits', () => {
    const html = renderHistoryRows([entry()], undefined, { ...OPTIONS, currentUserEmail: 'ADA@example.com' });
    assert.ok(html.includes('>You<'));
  });

  it('draws the graph when given one', () => {
    const entries = [entry({ sha: 'b', parents: ['a'] }), entry({ sha: 'a' })];
    const html = renderHistoryRows(entries, layoutGraph(entries), OPTIONS);
    assert.strictEqual(html.split('<svg').length - 1, 2);
  });
});

describe('renderGraphSvg', () => {
  it('draws each segment and the commit dot', () => {
    const [row] = layoutGraph([{ sha: 'm', parents: ['a', 'b'] }]);
    const svg = renderGraphSvg(row);
    assert.strictEqual(svg.split('<line').length - 1, 2);
    assert.ok(svg.includes('<circle'));
  });
});

describe('renderRefs', () => {
  it('marks the checked-out branch and escapes names', () => {
    const html = renderRefs([
      { kind: 'head', name: 'HEAD' },
      { kind: 'branch', name: 'main' },
      { kind: 'tag', name: 'v<1>' },
    ]);
    assert.ok(html.includes('ref-branch ref-current'));
    assert.ok(html.includes('v&lt;1&gt;'));
    assert.ok(!html.includes('>HEAD<'));
  });

  it('shows a detached HEAD', () => {
    assert.ok(renderRefs([{ kind: 'head', name: 'HEAD' }]).includes('>HEAD<'));
  });
});

describe('renderHistoryShell', () => {
  it('selects the scope and lists branches', () => {
    const html = renderHistoryShell(
      { filter: { scope: { kind: 'ref', ref: 'dev' } }, branches: { current: 'main', local: ['main', 'dev'], remote: ['origin/main'] } },
      'NONCE',
    );
    assert.ok(html.includes('value="ref:dev" selected'));
    assert.ok(html.includes('Current branch (main)'));
    assert.ok(html.includes('value="ref:origin/main"'));
    assert.ok(html.includes("script-src 'nonce-NONCE'"));
  });

  it('adds an option for a ref that is not a branch', () => {
    const html = renderHistoryShell(
      { filter: { scope: { kind: 'ref', ref: 'v1.0' } }, branches: { local: ['main'], remote: [] } },
      'NONCE',
    );
    assert.ok(html.includes('value="ref:v1.0" selected'));
  });

  it('shows the file filter, escaped', () => {
    const html = renderHistoryShell(
      { filter: { scope: { kind: 'head' }, path: 'src/<a>.ts' }, branches: { local: [], remote: [] } },
      'NONCE',
    );
    assert.ok(html.includes('File: src/&lt;a&gt;.ts'));
    assert.ok(html.includes('id="clear-path"'));
  });
});
