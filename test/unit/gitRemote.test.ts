import * as assert from 'assert';
import { buildCommitLink, parseRemoteUrl } from '../../src/git/gitRemote';

const SHA = 'abcdef1234567890abcdef1234567890abcdef12';

describe('parseRemoteUrl', () => {
  it('parses https, ssh, and scp-like remotes to the same location', () => {
    const expected = { host: 'github.com', path: 'owner/repo' };
    assert.deepStrictEqual(parseRemoteUrl('https://github.com/owner/repo.git'), expected);
    assert.deepStrictEqual(parseRemoteUrl('https://user:token@github.com/owner/repo'), expected);
    assert.deepStrictEqual(parseRemoteUrl('ssh://git@github.com:22/owner/repo.git'), expected);
    assert.deepStrictEqual(parseRemoteUrl('git@github.com:owner/repo.git'), expected);
    assert.deepStrictEqual(parseRemoteUrl('github.com:owner/repo/'), expected);
  });

  it('keeps nested group paths and https ports', () => {
    assert.deepStrictEqual(parseRemoteUrl('https://git.example.com:8443/group/sub/repo.git'), {
      host: 'git.example.com:8443',
      path: 'group/sub/repo',
    });
  });

  it('rejects local paths and unsupported protocols', () => {
    assert.strictEqual(parseRemoteUrl('/srv/git/repo.git'), undefined);
    assert.strictEqual(parseRemoteUrl('file:///srv/git/repo.git'), undefined);
    assert.strictEqual(parseRemoteUrl('../other-repo'), undefined);
  });
});

describe('buildCommitLink', () => {
  it('links GitHub commits', () => {
    assert.deepStrictEqual(buildCommitLink('git@github.com:owner/repo.git', SHA), {
      provider: 'GitHub',
      url: `https://github.com/owner/repo/commit/${SHA}`,
    });
  });

  it('links GitLab commits, including self-hosted and nested groups', () => {
    assert.deepStrictEqual(buildCommitLink('https://gitlab.com/group/sub/repo.git', SHA), {
      provider: 'GitLab',
      url: `https://gitlab.com/group/sub/repo/-/commit/${SHA}`,
    });
    assert.strictEqual(
      buildCommitLink('git@gitlab.example.com:team/repo.git', SHA)?.url,
      `https://gitlab.example.com/team/repo/-/commit/${SHA}`,
    );
  });

  it('links Bitbucket commits', () => {
    assert.strictEqual(
      buildCommitLink('git@bitbucket.org:team/repo.git', SHA)?.url,
      `https://bitbucket.org/team/repo/commits/${SHA}`,
    );
  });

  it('links Azure DevOps commits from ssh and https remotes', () => {
    const expected = `https://dev.azure.com/org/project/_git/repo/commit/${SHA}`;
    assert.strictEqual(buildCommitLink('git@ssh.dev.azure.com:v3/org/project/repo', SHA)?.url, expected);
    assert.strictEqual(buildCommitLink('https://org@dev.azure.com/org/project/_git/repo', SHA)?.url, expected);
  });

  it('falls back to /commit/<sha> for other hosts', () => {
    assert.deepStrictEqual(buildCommitLink('https://git.example.com/owner/repo.git', SHA), {
      provider: 'Remote',
      url: `https://git.example.com/owner/repo/commit/${SHA}`,
    });
  });
});
