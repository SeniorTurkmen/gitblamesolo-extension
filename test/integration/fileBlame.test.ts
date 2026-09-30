import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { removeRepo } from '../fixtures/tempRepo';

// Needs the VS Code API, so it only runs in the extension host (`vscode-test`).
describe('file blame', () => {
  let repoRoot: string;
  let fileUri: vscode.Uri;
  const settings = () => vscode.workspace.getConfiguration('gitBlameSolo');

  async function hoverText(line: number, character: number): Promise<string> {
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      fileUri,
      new vscode.Position(line, character),
    );
    return hovers
      .flatMap((hover) => hover.contents)
      .map((content) => (typeof content === 'string' ? content : content.value))
      .join('\n');
  }

  before(async () => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitblamesolo-fileblame-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repoRoot });
    git('init');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test User');
    git('config', 'core.autocrlf', 'false');
    fs.writeFileSync(path.join(repoRoot, 'file.txt'), 'first line\nsecond line\n');
    git('add', 'file.txt');
    git('commit', '-m', 'Add the file blame fixture');

    fileUri = vscode.Uri.file(path.join(repoRoot, 'file.txt'));
    await vscode.extensions.getExtension('SeniorTurkmen.gitblamesolo')!.activate();
    const editor = await vscode.window.showTextDocument(fileUri);
    editor.selection = new vscode.Selection(0, 0, 0, 0);
  });

  after(async () => {
    await settings().update('fileBlame.enabled', undefined, vscode.ConfigurationTarget.Global);
    await settings().update('hover.trigger', undefined, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    try {
      removeRepo(repoRoot);
    } catch (err) {
      // On Windows, VS Code's git extension keeps watching the repository the
      // test opened, which locks its folder; leave it to the temp folder cleanup.
      if (process.platform !== 'win32') {
        throw err;
      }
    }
  });

  it('is off by default', () => {
    assert.strictEqual(settings().get('fileBlame.enabled'), false);
  });

  it('opens the hover over the blame column of any line only while file blame is on', async () => {
    // Line 1 isn't the cursor line, so only the file blame column can trigger the hover there.
    assert.ok(!(await hoverText(1, 0)).includes('Add the file blame fixture'));

    await vscode.commands.executeCommand('gitBlameSolo.toggleFileBlame');
    assert.strictEqual(settings().get('fileBlame.enabled'), true);
    assert.ok((await hoverText(1, 0)).includes('Add the file blame fixture'));
    assert.ok(!(await hoverText(1, 3)).includes('Add the file blame fixture'));

    await vscode.commands.executeCommand('gitBlameSolo.toggleFileBlame');
    assert.strictEqual(settings().get('fileBlame.enabled'), false);
    assert.ok(!(await hoverText(1, 0)).includes('Add the file blame fixture'));
  });

  it('shows what changed on an uncommitted line, unsaved edits included', async () => {
    await settings().update('hover.trigger', 'line', vscode.ConfigurationTarget.Global);
    const editor = vscode.window.activeTextEditor!;
    await editor.edit((edit) => edit.replace(new vscode.Range(1, 0, 1, 'second line'.length), 'changed line'));
    try {
      const text = await hoverText(1, 3);
      assert.ok(text.includes('What changed'), text);
      assert.ok(text.includes('-second line\n+changed line'), text);
    } finally {
      await vscode.commands.executeCommand('workbench.action.files.revert');
    }
  });
});
