import * as vscode from 'vscode';
import { BlameCache } from './cache/blameCache';
import { CommitCache } from './cache/commitCache';
import { getConfig, onConfigChanged } from './config';
import { CurrentLineBlameDecorator } from './decorations/currentLineDecorator';
import { GitCliError, runGit } from './git/gitCli';
import { blameLine } from './git/gitBlame';
import { getCommitDetails } from './git/gitLog';
import { resolveRepository } from './git/gitRepository';
import { BlameHoverProvider } from './hover/blameHoverProvider';
import { formatDate } from './util/dateFormat';

async function warnIfGitMissing(): Promise<void> {
  try {
    await runGit(['--version'], { cwd: process.cwd() });
  } catch (err) {
    if (err instanceof GitCliError && err.isGitMissing) {
      void vscode.window.showWarningMessage(
        'Git Blame Solo: the "git" command was not found on PATH. Inline blame and hover are disabled.',
      );
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  void warnIfGitMissing();

  const blameCache = new BlameCache();
  const commitCache = new CommitCache();
  const decorator = new CurrentLineBlameDecorator({ blameCache, getConfig });

  context.subscriptions.push(decorator);
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((e) => decorator.onDidChangeSelection(e)),
  );
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((e) => decorator.onDidChangeActiveEditor(e)),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => decorator.onDidChangeDocument(e)),
  );
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { scheme: 'file' },
      new BlameHoverProvider({ blameCache, commitCache, getConfig }),
    ),
  );
  context.subscriptions.push(onConfigChanged(() => decorator.refreshNow()));

  context.subscriptions.push(
    vscode.commands.registerCommand('gitBlameSolo.toggle', async () => {
      const cfg = vscode.workspace.getConfiguration('gitBlameSolo');
      const current = cfg.get<boolean>('enabled', true);
      await cfg.update('enabled', !current, vscode.ConfigurationTarget.Global);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitBlameSolo.showCommitDetails', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const document = editor.document;
      const line = editor.selection.active.line;
      const repo = await resolveRepository(document.uri);
      if (!repo) {
        void vscode.window.showInformationMessage('Git Blame Solo: this file is not inside a git repository.');
        return;
      }
      const blame = await blameCache.getOrCompute(document, line, () =>
        blameLine({ filePath: document.uri.fsPath, content: document.getText(), line, repoRoot: repo.rootFsPath }),
      );
      if (!blame) {
        void vscode.window.showInformationMessage('Git Blame Solo: no blame information for this line.');
        return;
      }
      if (blame.isUncommitted) {
        void vscode.window.showInformationMessage('Git Blame Solo: this line has uncommitted changes.');
        return;
      }
      const commit = await commitCache.getOrCompute(blame.sha, () => getCommitDetails(blame.sha, repo.rootFsPath));
      const details = commit ?? {
        sha: blame.sha,
        authorName: blame.authorName,
        authorEmail: blame.authorEmail,
        authorTimestamp: blame.authorTimestamp,
        committerTimestamp: blame.authorTimestamp,
        summary: blame.summary,
        body: '',
      };
      const when = formatDate(details.authorTimestamp, 'absolute');
      const message = `${details.summary}\n${details.authorName} <${details.authorEmail}> • ${when}\n${details.sha}`;
      const action = await vscode.window.showInformationMessage(message, 'Copy Hash');
      if (action === 'Copy Hash') {
        await vscode.env.clipboard.writeText(details.sha);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitBlameSolo.copyCommitHash', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const document = editor.document;
      const line = editor.selection.active.line;
      const repo = await resolveRepository(document.uri);
      if (!repo) {
        return;
      }
      const blame = await blameCache.getOrCompute(document, line, () =>
        blameLine({ filePath: document.uri.fsPath, content: document.getText(), line, repoRoot: repo.rootFsPath }),
      );
      if (!blame || blame.isUncommitted) {
        void vscode.window.showInformationMessage('Git Blame Solo: no commit hash to copy for this line.');
        return;
      }
      await vscode.env.clipboard.writeText(blame.sha);
      void vscode.window.showInformationMessage(`Copied ${blame.sha.slice(0, 7)} to clipboard.`);
    }),
  );

  if (vscode.window.activeTextEditor) {
    decorator.onDidChangeActiveEditor(vscode.window.activeTextEditor);
  }
}

export function deactivate(): void {
  // All resources are disposed via context.subscriptions.
}
