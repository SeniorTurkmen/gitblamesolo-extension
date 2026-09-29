import * as assert from 'assert';
import { extractCoAuthors } from '../../src/util/coAuthors';

describe('extractCoAuthors', () => {
  it('pulls co-author trailers out of the body', () => {
    const body = [
      'Explain the change.',
      '',
      'Co-authored-by: Grace Hopper <grace@example.com>',
      'co-authored-by:   Alan Turing   <alan@example.com>  ',
    ].join('\n');

    assert.deepStrictEqual(extractCoAuthors(body), {
      coAuthors: [
        { name: 'Grace Hopper', email: 'grace@example.com' },
        { name: 'Alan Turing', email: 'alan@example.com' },
      ],
      body: 'Explain the change.',
    });
  });

  it('drops duplicates and the commit author', () => {
    const body = [
      'Co-authored-by: Ada <ADA@example.com>',
      'Co-authored-by: Grace <grace@example.com>',
      'Co-authored-by: Grace H. <Grace@Example.com>',
    ].join('\n');

    assert.deepStrictEqual(extractCoAuthors(body, 'ada@example.com').coAuthors, [
      { name: 'Grace', email: 'grace@example.com' },
    ]);
  });

  it('keeps other trailers and lines that only mention co-authoring', () => {
    const body = 'Signed-off-by: Ada <ada@example.com>\nThanks to the co-authored-by convention.';
    assert.deepStrictEqual(extractCoAuthors(body), { coAuthors: [], body });
  });

  it('handles an empty body', () => {
    assert.deepStrictEqual(extractCoAuthors(''), { coAuthors: [], body: '' });
  });
});
