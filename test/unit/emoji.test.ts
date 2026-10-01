import * as assert from 'assert';
import { emojify } from '../../src/util/emoji';

describe('emojify', () => {
  it('renders gitmoji shortcodes', () => {
    assert.strictEqual(emojify(':sparkles: Add compare view', true), '✨ Add compare view');
    assert.strictEqual(emojify(':bug::ambulance: Fix crash', true), '🐛🚑️ Fix crash');
  });

  it('leaves unknown shortcodes and other colons alone', () => {
    assert.strictEqual(emojify(':not_an_emoji: at 10:30: done', true), ':not_an_emoji: at 10:30: done');
  });

  it('changes nothing when rendering is off', () => {
    assert.strictEqual(emojify(':sparkles: Add', false), ':sparkles: Add');
  });
});
