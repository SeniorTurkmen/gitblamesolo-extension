import * as vscode from 'vscode';
import { numberHunkLines, PeekLine } from '../util/peekLines';

/** Injected text collapses plain spaces, so the gutter pads with no-break spaces. */
const NBSP = ' ';
const MARKERS: Record<PeekLine['kind'], string> = { add: '+', del: '−', context: NBSP };

export const CHANGE_PEEK_SCHEME = 'gitBlameSoloChange';

/** One commit's change to a line, shown as an entry in the peek's list. */
export interface ChangePeekBlock {
  /** A unified hunk, as the hover's "What changed" shows it. */
  hunk: string;
  /** The traced line, 1-based in the hunk's new version, which the peek opens at. */
  focusNewLine: number;
  /** The list entry's name, such as the commit's hash and subject. */
  title: string;
  /** Shown after the title, such as the commit's author and date. */
  description: string;
}

export interface ChangePeekRequest {
  /** The editor line the peek opens under. */
  sourceUri: vscode.Uri;
  sourceLine: number;
  /** Newest first; the peek opens at the first. */
  blocks: ChangePeekBlock[];
  languageId: string;
}

/** Keeps a title or description from splitting the document's path. */
function pathSegment(text: string): string {
  return text.replace(/\//g, '∕').replace(/\s+/g, ' ').trim() || '-';
}

/**
 * Shows changed blocks inline, under their line, in VS Code's peek view: the
 * removed and added lines on red and green, with their old and new line
 * numbers, like the peek of a local change. Each block is a read-only document
 * of its lines without their +/- markers, highlighted as the file's language,
 * and an entry in the peek's list, so a line's history can be stepped through
 * there.
 */
export class ChangePeek implements vscode.TextDocumentContentProvider, vscode.Disposable {
  /** Keyed by the document's authority, which is unique to its block and, unlike its path, never re-encoded. */
  private readonly blocks = new Map<string, PeekLine[]>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly added = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
  });
  private readonly removed = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('diffEditor.removedLineBackground'),
  });
  private readonly gutter = vscode.window.createTextEditorDecorationType({
    before: { color: new vscode.ThemeColor('editorLineNumber.foreground'), margin: '0 1.5em 0 0' },
  });
  private next = 0;

  constructor() {
    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(CHANGE_PEEK_SCHEME, this),
      // The peek's editor shows up among the visible editors when it opens and whenever it switches to another block.
      vscode.window.onDidChangeVisibleTextEditors((editors) => editors.forEach((editor) => this.decorate(editor))),
      this.added,
      this.removed,
      this.gutter,
    );
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.blocks.clear();
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return (this.blocks.get(this.key(uri)) ?? []).map((line) => line.text).join('\n');
  }

  async show(request: ChangePeekRequest): Promise<void> {
    // Only one peek is open at a time. Its documents can't be dropped when they close, as setting their language
    // closes and reopens them, so the previous peek's go when the next opens.
    this.blocks.clear();
    const peek = this.next++;
    const locations: vscode.Location[] = [];
    for (const [index, block] of request.blocks.entries()) {
      const lines = numberHunkLines(block.hunk);
      if (lines.length === 0) {
        continue;
      }
      // The list names each document by its file name, then its folder, and sorts documents by URI:
      // the authority keeps them in history order, and the path carries the title and description.
      const uri = vscode.Uri.from({
        scheme: CHANGE_PEEK_SCHEME,
        authority: `${peek}.${String(index).padStart(4, '0')}`,
        path: `/${pathSegment(block.description)}/${pathSegment(block.title)}`,
      });
      this.blocks.set(this.key(uri), lines);
      const document = await vscode.workspace.openTextDocument(uri);
      try {
        await vscode.languages.setTextDocumentLanguage(document, request.languageId);
      } catch {
        // An unknown language leaves the block as plain text.
      }
      const focus = Math.max(
        0,
        lines.findIndex((line) => line.newLine === block.focusNewLine),
      );
      locations.push(new vscode.Location(uri, new vscode.Position(focus, 0)));
    }
    if (locations.length === 0) {
      return;
    }
    await vscode.commands.executeCommand(
      'editor.action.peekLocations',
      request.sourceUri,
      new vscode.Position(request.sourceLine, 0),
      locations,
      'peek',
    );
    vscode.window.visibleTextEditors.forEach((editor) => this.decorate(editor));
  }

  private key(uri: vscode.Uri): string {
    return uri.scheme === CHANGE_PEEK_SCHEME ? uri.authority : '';
  }

  private decorate(editor: vscode.TextEditor): void {
    const lines = this.blocks.get(this.key(editor.document.uri));
    if (!lines) {
      return;
    }
    // The block's own line numbers mean nothing; the gutter shows the file's instead.
    editor.options = { lineNumbers: vscode.TextEditorLineNumbersStyle.Off };
    const width = Math.max(...lines.map((line) => String(Math.max(line.oldLine ?? 0, line.newLine ?? 0)).length));
    const pad = (n: number | undefined) => (n === undefined ? '' : String(n)).padStart(width, NBSP);
    const rangesOf = (kind: PeekLine['kind']) =>
      lines.flatMap((line, i) => (line.kind === kind ? [new vscode.Range(i, 0, i, 0)] : []));
    editor.setDecorations(this.added, rangesOf('add'));
    editor.setDecorations(this.removed, rangesOf('del'));
    editor.setDecorations(
      this.gutter,
      lines.map((line, i) => ({
        range: new vscode.Range(i, 0, i, 0),
        renderOptions: {
          before: { contentText: `${pad(line.oldLine)}${NBSP}${NBSP}${pad(line.newLine)}${NBSP}${MARKERS[line.kind]}` },
        },
      })),
    );
  }
}
