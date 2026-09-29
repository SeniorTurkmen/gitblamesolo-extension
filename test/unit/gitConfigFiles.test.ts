import * as assert from 'assert';
import * as path from 'path';
import { globalGitConfigPaths } from '../../src/git/gitConfigFiles';

describe('globalGitConfigPaths', () => {
  const home = path.resolve('/home/ada');

  it('is the XDG file and ~/.gitconfig by default', () => {
    assert.deepStrictEqual(globalGitConfigPaths({}, home), [
      path.join(home, '.config', 'git', 'config'),
      path.join(home, '.gitconfig'),
    ]);
  });

  it('follows XDG_CONFIG_HOME', () => {
    const xdg = path.resolve('/xdg');
    assert.deepStrictEqual(globalGitConfigPaths({ XDG_CONFIG_HOME: xdg }, home), [
      path.join(xdg, 'git', 'config'),
      path.join(home, '.gitconfig'),
    ]);
  });

  it('is only GIT_CONFIG_GLOBAL when set, as git reads nothing else then', () => {
    const file = path.resolve('/etc/custom-gitconfig');
    assert.deepStrictEqual(globalGitConfigPaths({ GIT_CONFIG_GLOBAL: file, XDG_CONFIG_HOME: '/xdg' }, home), [file]);
  });
});
