import * as fs from 'fs';
import * as vscode from 'vscode';
import { BlameCache } from '../cache/blameCache';
import { GitBlameSoloConfig } from '../config';
import { blameLine } from '../git/gitBlame';
import { resolveRepository } from '../git/gitRepository';
import { formatDate, formatDecorationText } from '../util/dateFormat';

export interface CurrentLineDecoratorDeps {
  blameCache: BlameCache;
  getConfig: () => GitBlameSoloConfig;
}

export class CurrentLineBlameDecorator implements vscode.Disposable {
  private readonly decorationType: vscode.TextEditorDecorationType;
  private readonly deps: CurrentLineDecoratorDeps;
  private timer: NodeJS.Timeout | undefined;
  private generation = 0;

  constructor(deps: CurrentLineDecoratorDeps) {
    this.deps = deps;
    this.decorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: false,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
    });
  }

  onDidChangeSelection(e: vscode.TextEditorSelectionChangeEvent): void {
    this.schedule(e.textEditor);
  }

  onDidChangeActiveEditor(editor: vscode.TextEditor | undefined): void {
    if (editor) {
      this.update(editor);
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
    }
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.decorationType.dispose();
  }

  private schedule(editor: vscode.TextEditor): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    const debounceMs = this.deps.getConfig().debounceMs;
    this.timer = setTimeout(() => this.update(editor), debounceMs);
  }

  private async update(editor: vscode.TextEditor): Promise<void> {
    const config = this.deps.getConfig();
    const myGeneration = ++this.generation;
    const document = editor.document;

    if (!config.enabled || document.uri.scheme !== 'file') {
      editor.setDecorations(this.decorationType, []);
      return;
    }

    if (document.getText().length > config.maxFileSizeBytes) {
      editor.setDecorations(this.decorationType, []);
      return;
    }

    const repo = await resolveRepository(document.uri);
    if (myGeneration !== this.generation) {
      return;
    }
    if (!repo) {
      editor.setDecorations(this.decorationType, []);
      return;
    }

    const line = editor.selection.active.line;
    const blame = await this.deps.blameCache.getOrCompute(document, line, () =>
      blameLine({
        filePath: document.uri.fsPath,
        content: document.getText(),
        line,
        repoRoot: repo.rootFsPath,
      }),
    );

    if (myGeneration !== this.generation) {
      return;
    }

    if (!blame) {
      editor.setDecorations(this.decorationType, []);
      return;
    }

    let label: string;
    if (blame.isUncommitted) {
      const mtimeSeconds = await this.getMtimeSeconds(document.uri.fsPath);
      if (myGeneration !== this.generation) {
        return;
      }
      const timeText = formatDate(mtimeSeconds, config.dateStyle);
      label = `${config.uncommittedLabel}, ${timeText}`;
    } else {
      label = formatDecorationText(
        {
          author: blame.authorName,
          authorTimestamp: blame.authorTimestamp,
          summary: blame.summary,
          sha: blame.sha,
        },
        config.decorationTemplate,
        config.dateStyle,
      );
    }

    const endOfLine = document.lineAt(line).range.end;
    editor.setDecorations(this.decorationType, [
      {
        range: new vscode.Range(endOfLine, endOfLine),
        renderOptions: {
          after: {
            contentText: `   ${label}`,
            color: config.decorationColor ?? new vscode.ThemeColor('editorCodeLens.foreground'),
            fontStyle: 'italic',
            margin: '0 0 0 1em',
          },
        },
      },
    ]);
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
