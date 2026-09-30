import * as assert from 'assert';
import { localeFromSystemName } from '../../src/util/systemLocale';

describe('localeFromSystemName', () => {
  it('turns POSIX and macOS locale names into language tags', () => {
    assert.strictEqual(localeFromSystemName('tr_TR.UTF-8'), 'tr-TR');
    assert.strictEqual(localeFromSystemName('de_DE'), 'de-DE');
    assert.strictEqual(localeFromSystemName('en_GB.UTF-8@euro'), 'en-GB');
    assert.strictEqual(localeFromSystemName('zh-Hans_CN\n'), 'zh-Hans-CN');
  });

  it("uses a macOS region override's region", () => {
    assert.strictEqual(localeFromSystemName('en_US@rg=dezzzz'), 'en-DE');
  });

  it('is undefined for names that give no language', () => {
    assert.strictEqual(localeFromSystemName(undefined), undefined);
    assert.strictEqual(localeFromSystemName(''), undefined);
    assert.strictEqual(localeFromSystemName('C'), undefined);
    assert.strictEqual(localeFromSystemName('POSIX'), undefined);
    assert.strictEqual(localeFromSystemName('C.UTF-8'), undefined);
  });
});
