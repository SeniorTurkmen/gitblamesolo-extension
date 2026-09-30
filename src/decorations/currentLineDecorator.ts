import * as fs from 'fs';
import * as vscode from 'vscode';
import { BlameCache } from '../cache/blameCache';
import { GitBlameSoloConfig, isExcluded } from '../config';
import { BLAMEABLE_SCHEMES, blameTarget, resolveBlameTarget } from '../git/blameTarget';
import { getCurrentUserEmail } from '../git/gitRemote';
import { BlameInfo } from '../types';
import { commitLineRuns } from '../util/commitLines';
import { formatDecorationText, formatUncommittedText } from '../util/dateFormat';

export interface CurrentLineDecoratorDeps {
  blameCache: BlameCache;
  getConfig: () => GitBlameSoloConfig;
}

/** Shows blame for the active line as an end-of-line annotation and/or a status bar item. */
export class CurrentLineBlameDecorator implements vscode.Disposable {
  private readonly decorationType: vscode.TextEditorDecorationType;
  /** Marks the other lines from the current line's commit. */
  private readonly commitLinesType: vscode.TextEditorDecorationType;
  /** The editor showing commit lines, so they can be cleared when another editor takes over. */
  private commitLinesEditor: vscode.TextEditor | undefined;
  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly deps: CurrentLineDecoratorDeps;
  private timer: NodeJS.Timeout | undefined;
  private generation = 0;

  constructor(deps: CurrentLineDecoratorDeps) {
    this.deps = deps;
    this.decorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: false,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
    });
    this.commitLinesType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor('gitBlameSolo.commitLinesBackground'),
      overviewRulerColor: new vscode.ThemeColor('gitBlameSolo.commitLinesOverviewRuler'),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
    this.statusBarItem = vscode.window.createStatusBarItem('gitBlameSolo.statusBar', vscode.StatusBarAlignment.Left, 100);
    this.statusBarItem.name = 'Git Blame Solo';
  }

  onDidChangeSelection(e: vscode.TextEditorSelectionChangeEvent): void {
    this.schedule(e.textEditor);
  }

  onDidChangeActiveEditor(editor: vscode.TextEditor | undefined): void {
    if (editor) {
      this.update(editor);
    } else {
      this.generation++;
      this.statusBarItem.hide();
      this.clearCommitLines();
    }
  }

  onDidChangeDocument(e: vscode.TextDocumentChangeEvent): void {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document === e.document) {
      this.schedule(editor);
    }
  }

  refreshNow(): void {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      this.update(editor);
    } else {
      this.statusBarItem.hide();
    }
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.decorationType.dispose();
    this.commitLinesType.dispose();
    this.statusBarItem.dispose();
  }

  private schedule(editor: vscode.TextEditor): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    const debounceMs = this.deps.getConfig().debounceMs;
    this.timer = setTimeout(() => this.update(editor), debounceMs);
  }

  private clear(editor: vscode.TextEditor): void {
    editor.setDecorations(this.decorationType, []);
    this.statusBarItem.hide();
    this.clearCommitLines();
  }

  private clearCommitLines(): void {
    this.commitLinesEditor?.setDecorations(this.commitLinesType, []);
    this.commitLinesEditor = undefined;
  }

  /** Marks every line of the file that the current line's commit last changed. */
  private showCommitLines(editor: vscode.TextEditor, runs: { start: number; end: number }[]): void {
    if (this.commitLinesEditor && this.commitLinesEditor !== editor) {
      this.clearCommitLines();
    }
    editor.setDecorations(
      this.commitLinesType,
      runs.map((run) => new vscode.Range(run.start, 0, run.end, 0)),
    );
    this.commitLinesEditor = editor;
  }

  private async update(editor: vscode.TextEditor): Promise<void> {
    const config = this.deps.getConfig();
    const myGeneration = ++this.generation;
    const document = editor.document;

    if (
      (!config.enabled && !config.statusBarEnabled && !config.highlightCommitLines) ||
      !BLAMEABLE_SCHEMES.includes(document.uri.scheme) ||
      document.getText().length > config.maxFileSizeBytes ||
      isExcluded(document, config)
    ) {
      this.clear(editor);
      return;
    }

    const target = await resolveBlameTarget(document.uri);
    if (myGeneration !== this.generation) {
      return;
    }
    if (!target) {
      this.clear(editor);
      return;
    }

    const line = editor.selection.active.line;
    const blame = await this.deps.blameCache.getLine(document, line, () =>
      blameTarget(target, document, config.blameOptions),
    );
    if (myGeneration !== this.generation) {
      return;
    }
    if (!blame) {
      this.clear(editor);
      return;
    }

    let inlineLabel: string;
    let statusLabel: string;
    if (blame.isUncommitted) {
      // A past revision has no save time; only a clean file on disk does.
      const savedAt =
        document.isDirty || document.uri.scheme !== 'file' ? undefined : await this.getMtimeSeconds(document.uri.fsPath);
      if (myGeneration !== this.generation) {
        return;
      }
      inlineLabel = formatUncommittedText(config.uncommittedLabel, savedAt, config.dateStyle);
      statusLabel = config.uncommittedLabel;
    } else {
      const author = await this.authorLabel(blame, target.repoRoot, config);
      if (myGeneration !== this.generation) {
        return;
      }
      const data = { author, authorTimestamp: blame.authorTimestamp, summary: blame.summary, sha: blame.sha };
      inlineLabel = formatDecorationText(data, config.decorationTemplate, config.dateStyle);
      statusLabel = formatDecorationText(data, config.statusBarTemplate, config.dateStyle);
    }

    if (config.enabled) {
      const endOfLine = document.lineAt(line).range.end;
      editor.setDecorations(this.decorationType, [
        {
          range: new vscode.Range(endOfLine, endOfLine),
          renderOptions: {
            after: {
              contentText: `   ${inlineLabel}`,
              color: config.decorationColor ?? new vscode.ThemeColor('editorCodeLens.foreground'),
              fontStyle: 'italic',
              margin: '0 0 0 1em',
            },
          },
        },
      ]);
    } else {
      editor.setDecorations(this.decorationType, []);
    }

    if (config.highlightCommitLines && !blame.isUncommitted) {
      // The line's blame came from the cached whole-file blame, so this runs no git.
      const fileBlame = await this.deps.blameCache.getFile(document, () =>
        blameTarget(target, document, config.blameOptions),
      );
      if (myGeneration !== this.generation) {
        return;
      }
      this.showCommitLines(editor, fileBlame ? commitLineRuns(fileBlame, blame.sha) : []);
    } else {
      this.clearCommitLines();
    }

    if (config.statusBarEnabled) {
      this.statusBarItem.text = `$(git-commit) ${escapeStatusBarText(statusLabel)}`;
      this.statusBarItem.tooltip = blame.isUncommitted
        ? undefined
        : `${blame.summary}\n${blame.authorName} • ${blame.sha.slice(0, 7)}\n\nClick to show commit details`;
      this.statusBarItem.command = blame.isUncommitted ? undefined : 'gitBlameSolo.showCommitDetails';
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  private async authorLabel(blame: BlameInfo, repoRoot: string, config: GitBlameSoloConfig): Promise<string> {
    if (!config.currentUserLabel) {
      return blame.authorName;
    }
    const email = await getCurrentUserEmail(repoRoot);
    return email && email.toLowerCase() === blame.authorEmail.toLowerCase() ? config.currentUserLabel : blame.authorName;
  }

  private async getMtimeSeconds(fsPath: string): Promise<number> {
    try {
      const stat = await fs.promises.stat(fsPath);
      return Math.floor(stat.mtimeMs / 1000);
    } catch {
      return Math.floor(Date.now() / 1000);
    }
  }
}

/** Keeps "$(...)" in commit messages from being rendered as icons. */
function escapeStatusBarText(text: string): string {
  return text.replace(/\$\(/g, '$​(');
}
