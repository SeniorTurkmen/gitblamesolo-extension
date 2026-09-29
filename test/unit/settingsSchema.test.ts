import * as assert from 'assert';
import {
  formatSettingValue,
  readSettingEntries,
  settingTitle,
  validateNumberInput,
} from '../../src/util/settingsSchema';
import packageJson from '../../package.json';

describe('settingTitle', () => {
  it('splits dotted, camelCase keys into a readable title', () => {
    assert.strictEqual(settingTitle('enabled'), 'Enabled');
    assert.strictEqual(settingTitle('statusBar.template'), 'Status Bar: Template');
    assert.strictEqual(settingTitle('maxFileSizeKB'), 'Max File Size KB');
    assert.strictEqual(settingTitle('hover.trigger'), 'Hover: Trigger');
  });
});

describe('formatSettingValue', () => {
  it('formats each setting type for display', () => {
    assert.strictEqual(formatSettingValue(true), 'On');
    assert.strictEqual(formatSettingValue(false), 'Off');
    assert.strictEqual(formatSettingValue(150), '150');
    assert.strictEqual(formatSettingValue('relative'), 'relative');
    assert.strictEqual(formatSettingValue(''), '(empty)');
    assert.strictEqual(formatSettingValue([]), '(none)');
    assert.strictEqual(formatSettingValue(['**/*.min.js', 'dist/**']), '**/*.min.js, dist/**');
  });
});

describe('validateNumberInput', () => {
  it('accepts whole numbers and rejects everything else', () => {
    assert.strictEqual(validateNumberInput('0'), undefined);
    assert.strictEqual(validateNumberInput(' 250 '), undefined);
    assert.ok(validateNumberInput(''));
    assert.ok(validateNumberInput('-1'));
    assert.ok(validateNumberInput('1.5'));
    assert.ok(validateNumberInput('abc'));
  });
});

describe('readSettingEntries', () => {
  const entries = readSettingEntries(packageJson);

  it('lists every contributed setting with a supported type', () => {
    const declared = Object.keys(packageJson.contributes.configuration.properties);
    assert.strictEqual(entries.length, declared.length);
    for (const entry of entries) {
      assert.ok(['boolean', 'string', 'number', 'array'].includes(entry.schema.type), entry.key);
    }
  });

  it('strips the section prefix from keys', () => {
    assert.ok(entries.some((e) => e.key === 'enabled'));
    assert.ok(entries.some((e) => e.key === 'hover.trigger' && e.schema.enum?.includes('annotation')));
  });

  it('returns nothing for a package.json without settings', () => {
    assert.deepStrictEqual(readSettingEntries({}), []);
  });
});
