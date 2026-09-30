import * as path from 'path';
import * as vscode from 'vscode';
import { BlameCache } from './cache/blameCache';
import { CommitCache } from './cache/commitCache';
import { CommitDiffCache } from './cache/commitDiffCache';
import { LineDiffCache } from './cache/lineDiffCache';
import { changeSetting } from './commands/changeSetting';
import { showAuthorHistory, showFileHistory, showHistory } from './commands/history';
import { compareFileRevisions, compareRefs } from './commands/compare';
import { showLineHistory } from './commands/lineHistory';
import { activeRepoFile, compareWithWorkingFile, openFileAtRevision, pickRevision } from './commands/revision';
import { getConfig, onConfigChanged } from './config';
import { CurrentLineBlameDecorator } from './decorations/currentLineDecorator';
import { FileBlameDecorator } from './decorations/fileBlameDecorator';
import { blameTarget, resolveBlameTarget } from './git/blameTarget';
import { GitCliError, runGit } from './git/gitCli';
import { getCommitDiff } from './git/gitCommitDiff';
import { getParentLine } from './git/gitDiff';
import { getCommitDetails } from './git/gitLog';
import { clearRemoteCaches, getCommitLink } from './git/gitRemote';
import { invalidateRepositoryCache } from './git/gitRepository';
import { RepositoryWatcher } from './git/repositoryWatcher';
import { buildGitShowUri, GIT_SHOW_SCHEME, GitShowContentProvider } from './git/gitShowContentProvider';
import { BlameHoverProvider } from './hover/blameHoverProvider';
import { BlameInfo } from './types';
import { CommitDetailsPanel } from './webview/commitDetailsPanel';

/** How long typing must pause before an edited document is blamed again with its unsaved text. */
const REBLAME_DELAY_MS = 1000;

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
  const fileBlame = new FileBlameDecorator({ blameCache, getConfig });

  /** Redraws the current line's blame and the file blame column after blame or settings changed. */
  function redraw(): void {
    decorator.refreshNow();
    fileBlame.refreshAll();
  }

  context.subscriptions.push(decorator, fileBlame);
  context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(() => fileBlame.refreshAll()));
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((e) => decorator.onDidChangeSelection(e)),
  );
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((e) => decorator.onDidChangeActiveEditor(e)),
  );
  // Edits only approximate blame (edited lines read as uncommitted); once typing
  // pauses, the unsaved text is blamed again for an exact result.
  const reblameTimers = new Map<string, NodeJS.Timeout>();
  function cancelReblame(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    clearTimeout(reblameTimers.get(key));
    reblameTimers.delete(key);
  }
  function scheduleReblame(document: vscode.TextDocument): void {
    cancelReblame(document);
    const key = document.uri.toString();
    reblameTimers.set(
      key,
      setTimeout(async () => {
        reblameTimers.delete(key);
        const target = await resolveBlameTarget(document.uri);
        if (!target) {
          return;
        }
        const replaced = await blameCache.refresh(document, () =>
          blameTarget(target, document, getConfig().blameOptions),
        );
        if (replaced) {
          redraw();
        }
      }, REBLAME_DELAY_MS),
    );
  }
  context.subscriptions.push({
    dispose: () => {
      reblameTimers.forEach((timer) => clearTimeout(timer));
      reblameTimers.clear();
    },
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      blameCache.applyChanges(e.document, e.contentChanges);
      // Some events only change the dirty state, not the text.
      if (e.contentChanges.length > 0) {
        scheduleReblame(e.document);
      }
      decorator.onDidChangeDocument(e);
      fileBlame.onDidChangeDocument(e.document);
    }),
  );
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      // Re-blame right away rather than waiting for a pending re-blame; uncommitted lines also show the new save time.
      cancelReblame(document);
      blameCache.delete(document.uri);
      redraw();
    }),
  );
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      cancelReblame(document);
      blameCache.delete(document.uri);
    }),
  );
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      [{ scheme: 'file' }, { scheme: GIT_SHOW_SCHEME }],
      new BlameHoverProvider({ blameCache, commitCache, lineDiffCache, getConfig }),
    ),
  );
  context.subscriptions.push(
    onConfigChanged((e) => {
      const blameSettings = ['ignoreWhitespace', 'detectMovedLines', 'ignoreRevsFile'];
      if (blameSettings.some((key) => e.affectsConfiguration(`gitBlameSolo.${key}`))) {
        blameCache.clear();
      }
      redraw();
    }),
  );
  /** Drops everything read from git that can go stale: blame, repository roots, remote URL, and user.email. */
  function resetCaches(): void {
    invalidateRepositoryCache();
    clearRemoteCaches();
    blameCache.clear();
    redraw();
  }

  context.subscriptions.push(
    new RepositoryWatcher({
      onHeadChanged: () => {
        blameCache.clear();
        redraw();
      },
      onRepositoriesChanged: resetCaches,
      onConfigChanged: () => {
        clearRemoteCaches();
        redraw();
      },
    }),
  );
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(GIT_SHOW_SCHEME, new GitShowContentProvider()),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitBlameSolo.openDiff',
      async (sha: string, repoRoot: string, relativePath: string, oldRelativePath?: string, line?: number) => {
        const leftUri = buildGitShowUri(`${sha}^`, repoRoot, oldRelativePath ?? relativePath);
        const rightUri = buildGitShowUri(sha, repoRoot, relativePath);
        const fileName = path.basename(relativePath);
        const title = `${fileName} (${sha.slice(0, 7)}^ ↔ ${sha.slice(0, 7)})`;
        // `line` is 0-based in the commit's version of the file, the diff's right side.
        const position = typeof line === 'number' ? new vscode.Position(line, 0) : undefined;
        await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title, {
          preview: true,
          selection: position ? new vscode.Range(position, position) : undefined,
        });
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
    vscode.commands.registerCommand('gitBlameSolo.toggleFileBlame', async () => {
      const cfg = vscode.workspace.getConfiguration('gitBlameSolo');
      const current = cfg.get<boolean>('fileBlame.enabled', false);
      await cfg.update('fileBlame.enabled', !current, vscode.ConfigurationTarget.Global);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitBlameSolo.showHistory', showHistory),
    vscode.commands.registerCommand('gitBlameSolo.showFileHistory', showFileHistory),
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
    const target = await resolveBlameTarget(document.uri);
    if (!target) {
      void vscode.window.showInformationMessage('Git Blame Solo: this file is not inside a git repository.');
      return undefined;
    }
    const blame = await blameCache.getLine(document, line, () =>
      blameTarget(target, document, getConfig().blameOptions),
    );
    if (!blame) {
      void vscode.window.showInformationMessage('Git Blame Solo: no blame information for this line.');
      return undefined;
    }
    if (blame.isUncommitted) {
      void vscode.window.showInformationMessage('Git Blame Solo: this line has uncommitted changes.');
      return undefined;
    }
    return { blame, repoRoot: target.repoRoot, document, line };
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitBlameSolo.openFileAtRevision',
      async (repoRootArg?: unknown, shaArg?: string, relativePathArg?: string) => {
        if (typeof repoRootArg === 'string' && shaArg && relativePathArg) {
          await openFileAtRevision(repoRootArg, shaArg, relativePathArg);
          return;
        }
        const file = await activeRepoFile(repoRootArg);
        const entry = file && (await pickRevision(file, 'Pick a commit to open the file as it was then'));
        if (file && entry) {
          await openFileAtRevision(file.repoRoot, entry.sha, entry.path ?? file.relativePath);
        }
      },
    ),
    vscode.commands.registerCommand('gitBlameSolo.compareRefs', compareRefs),
    vscode.commands.registerCommand('gitBlameSolo.compareFileRevisions', compareFileRevisions),
    vscode.commands.registerCommand(
      'gitBlameSolo.compareWithRevision',
      async (repoRootArg?: unknown, shaArg?: string, revisionPathArg?: string, workingPathArg?: string) => {
        if (typeof repoRootArg === 'string' && shaArg && revisionPathArg && workingPathArg) {
          await compareWithWorkingFile(repoRootArg, shaArg, revisionPathArg, workingPathArg);
          return;
        }
        const file = await activeRepoFile(repoRootArg);
        const entry = file && (await pickRevision(file, 'Pick a commit to compare its version of the file with yours'));
        if (file && entry) {
          await compareWithWorkingFile(file.repoRoot, entry.sha, entry.path ?? file.relativePath, file.relativePath);
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitBlameSolo.showAuthorHistory', async (repoRootArg?: string, authorArg?: string) => {
      if (repoRootArg && authorArg) {
        showAuthorHistory(repoRootArg, authorArg);
        return;
      }
      const target = await blameAtCursor();
      if (target) {
        showAuthorHistory(target.repoRoot, target.blame.authorEmail || target.blame.authorName);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitBlameSolo.showCommitDetails',
      async (
        shaArg?: string,
        repoRootArg?: string,
        sourceUriArg?: string,
        sourceLineArg?: number,
        sourceCommitLineArg?: number,
        sourceCommitPathArg?: string,
        focusPathArg?: string,
      ) => {
        let sha = shaArg;
        let repoRoot = repoRootArg;
        let sourceUri = sourceUriArg;
        let sourceLine = sourceLineArg;
        let sourceCommitLine = sourceCommitLineArg;
        let sourceCommitPath = sourceCommitPathArg;

        if (!sha || !repoRoot) {
          const target = await blameAtCursor();
          if (!target) {
            return;
          }
          sha = target.blame.sha;
          repoRoot = target.repoRoot;
          sourceUri = target.document.uri.toString();
          sourceLine = target.line;
          sourceCommitLine = target.blame.originalLine + 1;
          sourceCommitPath = target.blame.filename;
        }

        const commit = await commitCache.getOrCompute(sha, () => getCommitDetails(sha!, repoRoot!));
        if (!commit) {
          void vscode.window.showWarningMessage(`Git Blame Solo: could not load details for commit ${sha}.`);
          return;
        }
        const [diffs, remoteLink] = await Promise.all([
          commitDiffCache.getOrCompute(sha, () => getCommitDiff(sha!, repoRoot!)),
          getCommitLink(repoRoot, sha, `${commit.summary}\n\n${commit.body}`),
        ]);
        const source =
          sourceUri && sourceCommitPath && sourceCommitLine !== undefined
            ? { uri: sourceUri, commitPath: sourceCommitPath, line: sourceLine ?? 0, commitLine: sourceCommitLine }
            : undefined;
        CommitDetailsPanel.show(commit, diffs, repoRoot, source, remoteLink, focusPathArg ?? source?.commitPath);
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

  /**
   * The current file each opened past revision is compared with, and the line
   * the user started from, so stepping back again from inside a revision still
   * compares with the current file.
   */
  const currentFileForRevision = new Map<string, { uri: vscode.Uri; line: number }>();

  /**
   * Opens the file as it was just before the commit that last changed a line,
   * in a diff editor against the current file, with both sides on that line.
   * Blame works in the past revision too, so the user can keep stepping back
   * through a line's history.
   */
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitBlameSolo.blamePreviousRevision',
      async (
        shaArg?: string,
        repoRootArg?: string,
        relativePathArg?: string,
        parentShaArg?: string,
        parentPathArg?: string,
        originalLineArg?: number,
        sourceUriArg?: string,
        sourceLineArg?: number,
      ) => {
        let args: [string, string, string, string, string, number] | undefined;
        let source: { uri: vscode.Uri; line: number } | undefined;
        if (shaArg && repoRootArg && relativePathArg && parentShaArg && parentPathArg && originalLineArg !== undefined) {
          args = [shaArg, repoRootArg, relativePathArg, parentShaArg, parentPathArg, originalLineArg];
          if (sourceUriArg) {
            source = { uri: vscode.Uri.parse(sourceUriArg), line: sourceLineArg ?? 0 };
          }
        } else {
          const target = await blameAtCursor();
          if (!target) {
            return;
          }
          const { blame } = target;
          if (!blame.previous) {
            void vscode.window.showInformationMessage(
              `Git Blame Solo: commit ${blame.sha.slice(0, 7)} created this line; there is no earlier revision.`,
            );
            return;
          }
          args = [blame.sha, target.repoRoot, blame.filename, blame.previous.sha, blame.previous.filename, blame.originalLine];
          source = { uri: target.document.uri, line: target.line };
        }
        const current =
          source?.uri.scheme === 'file' ? source : source && currentFileForRevision.get(source.uri.toString());

        const [sha, repoRoot, relativePath, parentSha, parentPath, originalLine] = args;
        const parentLine = await getParentLine({
          repoRoot,
          sha,
          relativePath,
          parentSha,
          parentRelativePath: parentPath,
          line: originalLine,
        });
        const revisionUri = buildGitShowUri(parentSha, repoRoot, parentPath);
        try {
          const document = await vscode.workspace.openTextDocument(revisionUri);
          const line = Math.min(parentLine, Math.max(document.lineCount - 1, 0));
          const position = new vscode.Position(line, 0);
          const selection = new vscode.Range(position, position);

          if (!current) {
            // Opened from a revision this command didn't open, so there is no known current file to compare with.
            await vscode.window.showTextDocument(document, { preview: true, selection });
            vscode.window.activeTextEditor?.revealRange(selection, vscode.TextEditorRevealType.InCenter);
            return;
          }

          currentFileForRevision.set(revisionUri.toString(), current);
          const currentPosition = new vscode.Position(current.line, 0);
          const title = `${path.basename(current.uri.fsPath)} (${parentSha.slice(0, 7)} ↔ Current)`;
          await vscode.commands.executeCommand('vscode.diff', revisionUri, current.uri, title, {
            preview: true,
            selection: new vscode.Range(currentPosition, currentPosition),
          });
          // Put the cursor on the line in the past revision and focus that side, so its blame shows right away.
          const revisionEditor = vscode.window.visibleTextEditors.find(
            (editor) => editor.document.uri.toString() === revisionUri.toString(),
          );
          if (revisionEditor) {
            revisionEditor.selection = new vscode.Selection(position, position);
            revisionEditor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
          }
          await vscode.commands.executeCommand('workbench.action.compareEditor.focusSecondarySide');
        } catch {
          void vscode.window.showWarningMessage(
            `Git Blame Solo: could not open ${parentPath} at ${parentSha.slice(0, 7)}.`,
          );
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitBlameSolo.showLineHistory',
      async (shaArg?: string, repoRootArg?: string, relativePathArg?: string, lineArg?: number) => {
        if (shaArg && repoRootArg && relativePathArg && lineArg !== undefined) {
          await showLineHistory({ sha: shaArg, repoRoot: repoRootArg, relativePath: relativePathArg, line: lineArg });
          return;
        }
        const target = await blameAtCursor();
        if (!target) {
          return;
        }
        // Trace from the commit that last changed the line, at the line's position in that commit:
        // later commits didn't touch it, and this works for unsaved edits and past revisions alike.
        await showLineHistory({
          sha: target.blame.sha,
          repoRoot: target.repoRoot,
          relativePath: target.blame.filename,
          line: target.blame.originalLine,
        });
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitBlameSolo.copyCommitHash', async (shaArg?: string) => {
      let sha = shaArg;
      if (!sha) {
        const target = await blameAtCursor();
        if (!target) {
          return;
        }
        sha = target.blame.sha;
      }
      await vscode.env.clipboard.writeText(sha);
      void vscode.window.setStatusBarMessage(`$(check) Copied ${sha.slice(0, 7)} to clipboard`, 3000);
    }),
  );

  if (vscode.window.activeTextEditor) {
    decorator.onDidChangeActiveEditor(vscode.window.activeTextEditor);
  }
  fileBlame.refreshAll();
}

export function deactivate(): void {
  // All resources are disposed via context.subscriptions.
}
