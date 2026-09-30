import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { removeRepo } from '../fixtures/tempRepo';

/** Waits for the tab labels to settle, as a panel's new title reaches the tabs asynchronously. */
async function waitForTab(label: string): Promise<string[]> {
  for (let attempt = 0; attempt < 50 && !webviewTabLabels().includes(label); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return webviewTabLabels();
}

function webviewTabLabels(): string[] {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.input instanceof vscode.TabInputWebview)
    .map((tab) => tab.label);
}

// Needs the VS Code API, so it only runs in the extension host (`vscode-test`).
describe('history view', () => {
  let repoRoot: string;
  let fileUri: vscode.Uri;

  before(async () => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitblamesolo-historyview-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repoRoot });
    git('init');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test User');
    fs.writeFileSync(path.join(repoRoot, 'notes.txt'), 'one\n');
    git('add', 'notes.txt');
    git('commit', '-m', 'Add notes');

    fileUri = vscode.Uri.file(path.join(repoRoot, 'notes.txt'));
    await vscode.extensions.getExtension('SeniorTurkmen.gitblamesolo')!.activate();
    await vscode.window.showTextDocument(fileUri);
  });

  after(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    try {
      removeRepo(repoRoot);
    } catch (err) {
      // On Windows, VS Code's git extension may lock the repository folder; leave it to the temp folder cleanup.
      if (process.platform !== 'win32') {
        throw err;
      }
    }
  });

  it('opens the history of the active file', async () => {
    await vscode.commands.executeCommand('gitBlameSolo.showFileHistory');
    const labels = await waitForTab('History: notes.txt');
    assert.ok(labels.includes('History: notes.txt'), labels.join(', '));
  });

  it("opens an author's commits in the repository's panel", async () => {
    await vscode.commands.executeCommand('gitBlameSolo.showAuthorHistory', repoRoot, 'test@example.com');
    const title = `Git Log: ${path.basename(repoRoot)}`;
    const labels = await waitForTab(title);
    assert.ok(labels.includes(title), labels.join(', '));
  });

  it("reuses the repository's panel for its git log", async () => {
    await vscode.commands.executeCommand('gitBlameSolo.showHistory', fileUri);
    const title = `Git Log: ${path.basename(repoRoot)}`;
    const labels = await waitForTab(title);
    assert.ok(labels.includes(title), labels.join(', '));
    assert.strictEqual(labels.length, 1, labels.join(", "));
  });
});
