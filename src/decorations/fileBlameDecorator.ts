import * as vscode from 'vscode';
import { BlameCache } from '../cache/blameCache';
import { GitBlameSoloConfig, isExcluded } from '../config';
import { BLAMEABLE_SCHEMES, blameTarget, resolveBlameTarget } from '../git/blameTarget';
import { getCurrentUserEmail } from '../git/gitRemote';
import { buildFileBlameColumn, heatColor } from '../util/fileBlameColumn';

export interface FileBlameDecoratorDeps {
  blameCache: BlameCache;
  getConfig: () => GitBlameSoloConfig;
}

/**
 * Shows blame for every line of each visible editor in a column before the
 * text, when `gitBlameSolo.fileBlame.enabled` is on.
 */
export class FileBlameDecorator implements vscode.Disposable {
  private readonly decorationType: vscode.TextEditorDecorationType;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** Bumped per editor on every update, so a slower earlier update never overwrites a newer one. */
  private readonly generations = new WeakMap<vscode.TextEditor, number>();

  constructor(private readonly deps: FileBlameDecoratorDeps) {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      before: {
        color: new vscode.ThemeColor('editorCodeLens.foreground'),
        margin: '0 1.5ch 0 0',
        // Setting a height makes VS Code render the column inline-block, so the
        // heatmap fills the whole line instead of leaving a gap between lines.
        height: '100%',
      },
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
  }

  /** Redraws every visible editor. */
  refreshAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      void this.update(editor);
    }
  }

  /** Redraws the editors showing an edited document once edits pause. */
  onDidChangeDocument(document: vscode.TextDocument): void {
    if (!this.deps.getConfig().fileBlameEnabled) {
      return;
    }
    const key = document.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        for (const editor of vscode.window.visibleTextEditors) {
          if (editor.document === document) {
            void this.update(editor);
          }
        }
      }, this.deps.getConfig().debounceMs),
    );
  }

  dispose(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    this.decorationType.dispose();
  }

  private async update(editor: vscode.TextEditor): Promise<void> {
    const config = this.deps.getConfig();
    const document = editor.document;
    const generation = (this.generations.get(editor) ?? 0) + 1;
    this.generations.set(editor, generation);
    const isCurrent = () => this.generations.get(editor) === generation && !document.isClosed;

    if (
      !config.fileBlameEnabled ||
      !BLAMEABLE_SCHEMES.includes(document.uri.scheme) ||
      document.getText().length > config.maxFileSizeBytes ||
      isExcluded(document, config)
    ) {
      editor.setDecorations(this.decorationType, []);
      return;
    }

    const target = await resolveBlameTarget(document.uri);
    const blame = target
      ? await this.deps.blameCache.getFile(document, () => blameTarget(target, document, config.blameOptions))
      : undefined;
    if (!isCurrent()) {
      return;
    }
    if (!target || !blame) {
      editor.setDecorations(this.decorationType, []);
      return;
    }

    const currentUserEmail = config.currentUserLabel ? await getCurrentUserEmail(target.repoRoot) : undefined;
    if (!isCurrent()) {
      return;
    }

    const column = buildFileBlameColumn(blame, document.lineCount, {
      template: config.fileBlameTemplate,
      dateStyle: config.dateStyle,
      uncommittedLabel: config.uncommittedLabel,
      currentUserLabel: config.currentUserLabel,
      currentUserEmail,
    });
    editor.setDecorations(
      this.decorationType,
      column.map((entry, line) => ({
        range: new vscode.Range(line, 0, line, 0),
        renderOptions: {
          before: {
            contentText: entry.text,
            backgroundColor: config.fileBlameHeatmap ? heatColor(entry.heat) : undefined,
          },
        },
      })),
    );
  }
}
