import * as path from 'path';
import * as vscode from 'vscode';
import { BlameCache } from './cache/blameCache';
import { CommitCache } from './cache/commitCache';
import { CommitDiffCache } from './cache/commitDiffCache';
import { LineDiffCache } from './cache/lineDiffCache';
import { changeSetting } from './commands/changeSetting';
import { getConfig, onConfigChanged } from './config';
import { CurrentLineBlameDecorator } from './decorations/currentLineDecorator';
import { GitCliError, runGit } from './git/gitCli';
import { blameFile } from './git/gitBlame';
import { getCommitDiff } from './git/gitCommitDiff';
import { getCommitDetails } from './git/gitLog';
import { clearRemoteCaches, getCommitLink } from './git/gitRemote';
import { invalidateRepositoryCache, resolveRepository } from './git/gitRepository';
import { RepositoryWatcher } from './git/repositoryWatcher';
import { buildGitShowUri, GIT_SHOW_SCHEME, GitShowContentProvider } from './git/gitShowContentProvider';
import { BlameHoverProvider } from './hover/blameHoverProvider';
import { BlameInfo } from './types';
import { CommitDetailsPanel } from './webview/commitDetailsPanel';

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
  const commitDiffCache = new CommitDiffCache();
  const lineDiffCache = new LineDiffCache();
  const decorator = new CurrentLineBlameDecorator({ blameCache, getConfig });

  context.subscriptions.push(decorator);
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((e) => decorator.onDidChangeSelection(e)),
  );
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((e) => decorator.onDidChangeActiveEditor(e)),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      blameCache.applyChanges(e.document, e.contentChanges);
      decorator.onDidChangeDocument(e);
    }),
  );
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      // Edits only approximate blame (edited lines read as uncommitted); saving re-blames exactly.
      blameCache.delete(document.uri);
      if (vscode.window.activeTextEditor?.document === document) {
        decorator.refreshNow();
      }
    }),
  );
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => blameCache.delete(document.uri)),
  );
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { scheme: 'file' },
      new BlameHoverProvider({ blameCache, commitCache, lineDiffCache, getConfig }),
    ),
  );
  context.subscriptions.push(
    onConfigChanged((e) => {
      const blameSettings = ['ignoreWhitespace', 'detectMovedLines', 'ignoreRevsFile'];
      if (blameSettings.some((key) => e.affectsConfiguration(`gitBlameSolo.${key}`))) {
        blameCache.clear();
      }
      decorator.refreshNow();
    }),
  );
  /** Drops everything read from git that can go stale: blame, repository roots, remote URL, and user.email. */
  function resetCaches(): void {
    invalidateRepositoryCache();
    clearRemoteCaches();
    blameCache.clear();
    decorator.refreshNow();
  }

  context.subscriptions.push(
    new RepositoryWatcher({
      onHeadChanged: () => {
        blameCache.clear();
        decorator.refreshNow();
      },
      onRepositoriesChanged: resetCaches,
    }),
  );
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(GIT_SHOW_SCHEME, new GitShowContentProvider()),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitBlameSolo.openDiff',
      async (sha: string, repoRoot: string, relativePath: string, oldRelativePath?: string) => {
        const leftUri = buildGitShowUri(`${sha}^`, repoRoot, oldRelativePath ?? relativePath);
        const rightUri = buildGitShowUri(sha, repoRoot, relativePath);
        const fileName = path.basename(relativePath);
        const title = `${fileName} (${sha.slice(0, 7)}^ ↔ ${sha.slice(0, 7)})`;
        await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title, { preview: true });
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitBlameSolo.refresh', () => {
      resetCaches();
      void vscode.window.setStatusBarMessage('Git Blame Solo: refreshed', 3000);
    }),
  );

  for (const [command, show] of [
    ['gitBlameSolo.showAuthorEmail', true],
    ['gitBlameSolo.hideAuthorEmail', false],
  ] as const) {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, async () => {
        await vscode.workspace
          .getConfiguration('gitBlameSolo')
          .update('showAuthorEmail', show, vscode.ConfigurationTarget.Global);
      }),
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('gitBlameSolo.changeSetting', () => changeSetting(context.extension)),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitBlameSolo.toggle', async () => {
      const cfg = vscode.workspace.getConfiguration('gitBlameSolo');
      const current = cfg.get<boolean>('enabled', true);
      await cfg.update('enabled', !current, vscode.ConfigurationTarget.Global);
    }),
  );

  /** Blames the active editor's cursor line, telling the user why when there is no commit to act on. */
  async function blameAtCursor(): Promise<
    { blame: BlameInfo; repoRoot: string; document: vscode.TextDocument; line: number } | undefined
  > {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return undefined;
    }
    const document = editor.document;
    const line = editor.selection.active.line;
    const repo = await resolveRepository(document.uri);
    if (!repo) {
      void vscode.window.showInformationMessage('Git Blame Solo: this file is not inside a git repository.');
      return undefined;
    }
    const blame = await blameCache.getLine(document, line, () =>
      blameFile({
        filePath: document.uri.fsPath,
        content: document.getText(),
        repoRoot: repo.rootFsPath,
        options: getConfig().blameOptions,
      }),
    );
    if (!blame) {
      void vscode.window.showInformationMessage('Git Blame Solo: no blame information for this line.');
      return undefined;
    }
    if (blame.isUncommitted) {
      void vscode.window.showInformationMessage('Git Blame Solo: this line has uncommitted changes.');
      return undefined;
    }
    return { blame, repoRoot: repo.rootFsPath, document, line };
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitBlameSolo.showCommitDetails',
      async (
        shaArg?: string,
        repoRootArg?: string,
        sourceFilePathArg?: string,
        sourceLineArg?: number,
        sourceCommitLineArg?: number,
      ) => {
        let sha = shaArg;
        let repoRoot = repoRootArg;
        let sourceFilePath = sourceFilePathArg;
        let sourceLine = sourceLineArg;
        let sourceCommitLine = sourceCommitLineArg;

        if (!sha || !repoRoot) {
          const target = await blameAtCursor();
          if (!target) {
            return;
          }
          sha = target.blame.sha;
          repoRoot = target.repoRoot;
          sourceFilePath = target.document.uri.fsPath;
          sourceLine = target.line;
          sourceCommitLine = target.blame.originalLine + 1;
        }

        const commit = await commitCache.getOrCompute(sha, () => getCommitDetails(sha!, repoRoot!));
        if (!commit) {
          void vscode.window.showWarningMessage(`Git Blame Solo: could not load details for commit ${sha}.`);
          return;
        }
        const [diffs, remoteLink] = await Promise.all([
          commitDiffCache.getOrCompute(sha, () => getCommitDiff(sha!, repoRoot!)),
          getCommitLink(repoRoot, sha),
        ]);
        const source =
          sourceFilePath && sourceCommitLine !== undefined
            ? { filePath: sourceFilePath, line: sourceLine ?? 0, commitLine: sourceCommitLine }
            : undefined;
        CommitDetailsPanel.show(commit, diffs, repoRoot, source, remoteLink);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitBlameSolo.openCommitOnRemote', async (shaArg?: string, repoRootArg?: string) => {
      let sha = shaArg;
      let repoRoot = repoRootArg;
      if (!sha || !repoRoot) {
        const target = await blameAtCursor();
        if (!target) {
          return;
        }
        sha = target.blame.sha;
        repoRoot = target.repoRoot;
      }
      const link = await getCommitLink(repoRoot, sha);
      if (!link) {
        void vscode.window.showInformationMessage(
          'Git Blame Solo: this repository has no remote with a recognizable web address.',
        );
        return;
      }
      await vscode.env.openExternal(vscode.Uri.parse(link.url));
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitBlameSolo.copyCommitHash', async () => {
      const target = await blameAtCursor();
      if (!target) {
        return;
      }
      await vscode.env.clipboard.writeText(target.blame.sha);
      void vscode.window.showInformationMessage(`Copied ${target.blame.sha.slice(0, 7)} to clipboard.`);
    }),
  );

  if (vscode.window.activeTextEditor) {
    decorator.onDidChangeActiveEditor(vscode.window.activeTextEditor);
  }
}

export function deactivate(): void {
  // All resources are disposed via context.subscriptions.
}
