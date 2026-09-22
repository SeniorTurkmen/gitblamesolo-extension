export const COMMITTED_LINE_PORCELAIN = [
  'abcdef1234567890abcdef1234567890abcdef12 3 3 1',
  'author Ada Lovelace',
  'author-mail <ada@example.com>',
  'author-time 1700000000',
  'author-tz +0000',
  'committer Ada Lovelace',
  'committer-mail <ada@example.com>',
  'committer-time 1700000000',
  'committer-tz +0000',
  'summary Add initial calculation engine',
  'filename src/engine.ts',
  '\tconst result = compute(a, b);',
  '',
].join('\n');

export const UNCOMMITTED_LINE_PORCELAIN = [
  '0000000000000000000000000000000000000000 5 5 1',
  'author Not Committed Yet',
  'author-mail <not.committed.yet>',
  'author-time 1700003600',
  'author-tz +0000',
  'committer Not Committed Yet',
  'committer-mail <not.committed.yet>',
  'committer-time 1700003600',
  'committer-tz +0000',
  'summary Uncommitted changes',
  'filename src/engine.ts',
  '\tconst draft = true;',
  '',
].join('\n');

export const COMMIT_SHOW_OUTPUT =
  [
    'abcdef1234567890abcdef1234567890abcdef12',
    'Ada Lovelace',
    'ada@example.com',
    '1700000000',
    '1700000100',
    'Add initial calculation engine',
    'This introduces the first version of the calculation engine.\nIt supports add and subtract.',
  ].join('\x1f') +
  '\x1e\n\n' +
  ['M\tsrc/engine.ts', 'A\tsrc/engine.test.ts', 'R100\told/path.ts\tnew/path.ts', ''].join('\n');
