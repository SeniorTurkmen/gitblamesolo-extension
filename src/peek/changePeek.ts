import * as vscode from 'vscode';
import { numberHunkLines, PeekLine } from '../util/peekLines';

/** Injected text collapses plain spaces, so the gutter pads with no-break spaces. */
const NBSP = '\u00a0';
const MARKERS: Record<PeekLine['kind'], string> = { add: '+', del: '−', context: NBSP };

export const CHANGE_PEEK_SCHEME = 'gitBlameSoloChange';

export interface ChangePeekRequest {
  /** The editor line the peek opens under. */
  sourceUri: vscode.Uri;
  sourceLine: number;
  /** A unified hunk, as the hover's "What changed" shows it. */
  hunk: string;
  /** The hovered line, 1-based in the hunk's new version, which the peek scrolls to. */
  focusNewLine: number;
  /** Shown after the file name in the peek's title. */
  description: string;
  /** Shown under the block, and as the entry in the peek's list on the right. */
  footer: string;
  fileName: string;
  languageId: string;
}

/**
 * Shows a changed block inline, under its line, in VS Code's peek view: the
 * removed and added lines on red and green, with their old and new line
 * numbers, like the peek of a local change. The block is a read-only document
 * of the lines without their +/- markers, highlighted as the file's language.
 */
export class ChangePeek implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly blocks = new Map<string, { lines: PeekLine[]; footer: string }>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly added = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
  });
  private readonly removed = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('diffEditor.removedLineBackground'),
  });
  private readonly footer = vscode.window.createTextEditorDecorationType({
    color: new vscode.ThemeColor('descriptionForeground'),
    fontStyle: 'italic',
  });
  private readonly gutter = vscode.window.createTextEditorDecorationType({
    before: { color: new vscode.ThemeColor('editorLineNumber.foreground'), margin: '0 1.5em 0 0' },
  });
  private next = 0;

  constructor() {
    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(CHANGE_PEEK_SCHEME, this),
      // The peek's editor shows up among the visible editors once it opens, and again whenever it comes back.
      vscode.window.onDidChangeVisibleTextEditors((editors) => editors.forEach((editor) => this.decorate(editor))),
      vscode.workspace.onDidCloseTextDocument((document) => this.blocks.delete(document.uri.toString())),
      this.added,
      this.removed,
      this.footer,
      this.gutter,
    );
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.blocks.clear();
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const block = this.blocks.get(uri.toString());
    return block ? [...block.lines.map((line) => line.text), '', block.footer].join('\n') : '';
  }

  async show(request: ChangePeekRequest): Promise<void> {
    const lines = numberHunkLines(request.hunk);
    if (lines.length === 0) {
      return;
    }
    // The peek's title is the document's name, followed by its folder, so the folder carries the description.
    const uri = vscode.Uri.from({
      scheme: CHANGE_PEEK_SCHEME,
      path: `${request.description.replace(/\//g, '∕')}/${request.fileName}`,
      query: String(this.next++),
    });
    this.blocks.set(uri.toString(), { lines, footer: request.footer });
    const document = await vscode.workspace.openTextDocument(uri);
    try {
      await vscode.languages.setTextDocumentLanguage(document, request.languageId);
    } catch {
      // An unknown language leaves the block as plain text.
    }
    const focus = Math.max(
      0,
      lines.findIndex((line) => line.newLine === request.focusNewLine),
    );
    // The list on the right shows the text of the location's line, so the location is the footer, after a blank line.
    const footerLine = lines.length + 1;
    await vscode.commands.executeCommand(
      'editor.action.peekLocations',
      request.sourceUri,
      new vscode.Position(request.sourceLine, 0),
      [new vscode.Location(uri, new vscode.Position(footerLine, 0))],
      'peek',
    );
    for (const editor of vscode.window.visibleTextEditors) {
      this.decorate(editor);
      if (editor.document.uri.toString() === uri.toString()) {
        // Opening at the footer scrolls the block's start out of view: show it from the top when the hovered
        // line fits on the first screen, and center the hovered line otherwise.
        const visible = editor.visibleRanges[0];
        const height = visible ? visible.end.line - visible.start.line : 0;
        if (focus < height) {
          editor.revealRange(new vscode.Range(0, 0, 0, 0), vscode.TextEditorRevealType.AtTop);
        } else {
          editor.revealRange(new vscode.Range(focus, 0, focus, 0), vscode.TextEditorRevealType.InCenter);
        }
      }
    }
  }

  private decorate(editor: vscode.TextEditor): void {
    const block = this.blocks.get(editor.document.uri.toString());
    if (!block) {
      return;
    }
    const { lines } = block;
    // The block's own line numbers mean nothing; the gutter shows the file's instead.
    editor.options = { lineNumbers: vscode.TextEditorLineNumbersStyle.Off };
    const width = Math.max(...lines.map((line) => String(Math.max(line.oldLine ?? 0, line.newLine ?? 0)).length));
    const pad = (n: number | undefined) => (n === undefined ? '' : String(n)).padStart(width, NBSP);
    const rangesOf = (kind: PeekLine['kind']) =>
      lines.flatMap((line, i) => (line.kind === kind ? [new vscode.Range(i, 0, i, 0)] : []));
    editor.setDecorations(this.added, rangesOf('add'));
    editor.setDecorations(this.removed, rangesOf('del'));
    editor.setDecorations(this.footer, [new vscode.Range(lines.length + 1, 0, lines.length + 1, block.footer.length)]);
    const gutterText = (line: PeekLine) => `${pad(line.oldLine)}${NBSP}${NBSP}${pad(line.newLine)}${NBSP}${MARKERS[line.kind]}`;
    editor.setDecorations(this.gutter, [
      ...lines.map((line, i) => ({
        range: new vscode.Range(i, 0, i, 0),
        renderOptions: { before: { contentText: gutterText(line) } },
      })),
      // An empty gutter lines the footer up with the code.
      {
        range: new vscode.Range(lines.length + 1, 0, lines.length + 1, 0),
        renderOptions: { before: { contentText: gutterText({ kind: 'context', text: '' }) } },
      },
    ]);
  }
}

