import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { blameLine } from '../../src/git/gitBlame';
import { getCommitDetails } from '../../src/git/gitLog';

function git(repoRoot: string, args: string[]): void {
  execFileSync('git', args, { cwd: repoRoot });
}

describe('git blame integration', () => {
  let repoRoot: string;
  let filePath: string;

  before(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitblamesolo-'));
    git(repoRoot, ['init', '--initial-branch=main']);
    git(repoRoot, ['config', 'user.email', 'test@example.com']);
    git(repoRoot, ['config', 'user.name', 'Test User']);

    filePath = path.join(repoRoot, 'file.txt');
    fs.writeFileSync(filePath, 'line one\nline two\n');
    git(repoRoot, ['add', 'file.txt']);
    git(repoRoot, ['commit', '-m', 'First commit']);

    fs.writeFileSync(filePath, 'line one\nline two changed\nline three\n');
    git(repoRoot, ['add', 'file.txt']);
    git(repoRoot, ['commit', '-m', 'Second commit']);
  });

  after(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('resolves a committed line to its commit', async () => {
    const content = fs.readFileSync(filePath, 'utf8');
    const blame = await blameLine({ filePath, content, line: 0, repoRoot });

    assert.ok(blame);
    assert.strictEqual(blame!.isUncommitted, false);
    assert.strictEqual(blame!.summary, 'First commit');
  });

  it('resolves a line modified by the latest commit', async () => {
    const content = fs.readFileSync(filePath, 'utf8');
    const blame = await blameLine({ filePath, content, line: 1, repoRoot });

    assert.ok(blame);
    assert.strictEqual(blame!.summary, 'Second commit');
  });

  it('marks an unsaved buffer edit as uncommitted', async () => {
    const dirtyContent = 'line one\nline two changed\nline three EDITED\n';
    const blame = await blameLine({ filePath, content: dirtyContent, line: 2, repoRoot });

    assert.ok(blame);
    assert.strictEqual(blame!.isUncommitted, true);
  });

  it('fetches full commit details by sha', async () => {
    const content = fs.readFileSync(filePath, 'utf8');
    const blame = await blameLine({ filePath, content, line: 1, repoRoot });
    assert.ok(blame);

    const details = await getCommitDetails(blame!.sha, repoRoot);
    assert.ok(details);
    assert.strictEqual(details!.summary, 'Second commit');
    assert.strictEqual(details!.authorEmail, 'test@example.com');
  });
});
