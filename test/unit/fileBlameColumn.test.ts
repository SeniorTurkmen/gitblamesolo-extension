import * as assert from 'assert';
import { BlameLine, FileBlame, UNCOMMITTED_LINE } from '../../src/git/gitBlame';
import { buildFileBlameColumn, FileBlameColumnOptions, heatColor, MAX_COLUMN_WIDTH } from '../../src/util/fileBlameColumn';

const NBSP = ' ';

function line(sha: string, authorName: string, authorTimestamp: number, authorEmail = `${authorName}@example.com`): BlameLine {
  return {
    commit: { sha, isUncommitted: false, authorName, authorEmail, authorTimestamp, summary: `summary ${sha}` },
    origin: { filename: 'file.txt' },
    originalLine: 0,
  };
}

const OPTIONS: FileBlameColumnOptions = {
  template: '${author} ${hash}',
  dateStyle: 'absolute',
  uncommittedLabel: 'Uncommitted',
  currentUserLabel: 'You',
};

const A = line('a'.repeat(40), 'Ada', 100);
const B = line('b'.repeat(40), 'Bob', 200);
const C = line('c'.repeat(40), 'Cy', 300);

describe('buildFileBlameColumn', () => {
  it('labels only the first line of each block of lines from the same commit', () => {
    const column = buildFileBlameColumn([A, A, B, A], 4, OPTIONS);
    assert.deepStrictEqual(
      column.map((c) => c.text.replace(new RegExp(NBSP, 'g'), ' ').trimEnd()),
      ['Ada aaaaaaa', '', 'Bob bbbbbbb', 'Ada aaaaaaa'],
    );
  });

  it('pads every line to the widest label with no-break spaces so the column lines up', () => {
    const column = buildFileBlameColumn([A, A, C], 3, OPTIONS);
    const width = 'Ada aaaaaaa'.length;
    assert.ok(column.every((c) => c.text.length === width));
    assert.strictEqual(column[1].text, NBSP.repeat(width));
    assert.strictEqual(column[2].text, `Cy ccccccc${NBSP}`);
  });

  it('cuts labels longer than the maximum width with an ellipsis', () => {
    const long = line('d'.repeat(40), 'x'.repeat(80), 100);
    const [first] = buildFileBlameColumn([long], 1, OPTIONS);
    assert.strictEqual(first.text.length, MAX_COLUMN_WIDTH);
    assert.ok(first.text.endsWith('…'));
  });

  it('labels uncommitted lines and treats them as the newest', () => {
    const column = buildFileBlameColumn([A, UNCOMMITTED_LINE, B], 3, OPTIONS);
    assert.ok(column[1].text.startsWith('Uncommitted'));
    assert.strictEqual(column[1].heat, 1);
  });

  it('shows the current user label for your own commits, matching the email case-insensitively', () => {
    const mine = line('e'.repeat(40), 'Me', 100, 'Me@Example.com');
    const [first] = buildFileBlameColumn([mine], 1, { ...OPTIONS, currentUserEmail: 'me@example.com' });
    assert.ok(first.text.startsWith('You eeeeeee'));

    const [named] = buildFileBlameColumn([mine], 1, { ...OPTIONS, currentUserLabel: '', currentUserEmail: 'me@example.com' });
    assert.ok(named.text.startsWith('Me eeeeeee'));
  });

  it('ranks heat by commit age, from 0 for the oldest to 1 for the newest', () => {
    const veryOld = line('f'.repeat(40), 'Old', 1);
    const column = buildFileBlameColumn([veryOld, A, B, C], 4, OPTIONS);
    assert.deepStrictEqual(
      column.map((c) => c.heat),
      [0, 1 / 3, 2 / 3, 1],
    );
  });

  it('gives a file with a single commit full heat', () => {
    assert.deepStrictEqual(
      buildFileBlameColumn([A, A], 2, OPTIONS).map((c) => c.heat),
      [1, 1],
    );
  });

  it('leaves lines past the end of the blame blank, as while a document is being blamed after an edit', () => {
    const blame: FileBlame = [A];
    const column = buildFileBlameColumn(blame, 3, OPTIONS);
    assert.strictEqual(column.length, 3);
    assert.strictEqual(column[2].text.trim(), '');
  });
});

describe('heatColor', () => {
  it('runs from blue for the oldest to orange for the newest', () => {
    assert.strictEqual(heatColor(0), 'rgba(59, 130, 246, 0.25)');
    assert.strictEqual(heatColor(1), 'rgba(249, 115, 22, 0.25)');
    assert.strictEqual(heatColor(2), heatColor(1));
  });
});
