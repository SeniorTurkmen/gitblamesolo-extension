import * as path from 'path';
import * as vscode from 'vscode';
import { applyPatchReverse } from '../git/gitApply';
import { GitCliError } from '../git/gitCli';
import { buildHunkPatch, isRevertibleHunk } from '../git/gitCommitDiff';
import { CommitDetails, CommitFileChange, DiffHunk, DiffLine, FileChangeStatus, FileDiff, SourceLocation } from '../types';
import { formatDate } from '../util/dateFormat';

type WebviewMessage =
  | { type: 'openFile'; path: string }
  | { type: 'openSource' }
  | { type: 'revertHunk'; path: string; hunkIndex: number };

const STATUS_LABELS: Record<FileChangeStatus, string> = {
  A: 'Added',
  M: 'Modified',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  T: 'Type changed',
  U: 'Unmerged',
  X: 'Unknown',
};

export class CommitDetailsPanel {
  private static current: CommitDetailsPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private repoRoot: string;
  private source: SourceLocation | undefined;
  private diffs: FileDiff[] = [];

  static show(commit: CommitDetails, diffs: FileDiff[], repoRoot: string, source?: SourceLocation): void {
    if (CommitDetailsPanel.current) {
      CommitDetailsPanel.current.update(commit, diffs, repoRoot, source);
      CommitDetailsPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'gitBlameSoloCommitDetails',
      'Commit Details',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    CommitDetailsPanel.current = new CommitDetailsPanel(panel, commit, diffs, repoRoot, source);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    commit: CommitDetails,
    diffs: FileDiff[],
    repoRoot: string,
    source: SourceLocation | undefined,
  ) {
    this.panel = panel;
    this.repoRoot = repoRoot;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.handleMessage(message),
      null,
      this.disposables,
    );

    this.update(commit, diffs, repoRoot, source);
  }

  private update(commit: CommitDetails, diffs: FileDiff[], repoRoot: string, source: SourceLocation | undefined): void {
    this.repoRoot = repoRoot;
    this.source = source;
    this.diffs = diffs;
    this.panel.title = `Commit ${commit.sha.slice(0, 7)}`;
    this.panel.webview.html = this.renderHtml(commit, diffs);
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    if (message.type === 'openFile') {
      await this.openFile(message.path);
      return;
    }
    if (message.type === 'openSource') {
      await this.openSource();
      return;
    }
    if (message.type === 'revertHunk') {
      await this.revertHunk(message.path, message.hunkIndex);
    }
  }

  private async openFile(relativePath: string): Promise<void> {
    const absolutePath = path.join(this.repoRoot, relativePath);
    try {
      const document = await vscode.workspace.openTextDocument(absolutePath);
      await vscode.window.showTextDocument(document, { preview: true });
    } catch {
      void vscode.window.showWarningMessage(`Git Blame Solo: could not open "${relativePath}".`);
    }
  }

  private async openSource(): Promise<void> {
    if (!this.source) {
      return;
    }
    try {
      const document = await vscode.workspace.openTextDocument(this.source.filePath);
      const editor = await vscode.window.showTextDocument(document, { preview: true });
      const position = new vscode.Position(this.source.line, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    } catch {
      void vscode.window.showWarningMessage('Git Blame Solo: could not open the source location.');
    }
  }

  private async revertHunk(relativePath: string, hunkIndex: number): Promise<void> {
    const fileDiff = this.diffs.find((d) => d.path === relativePath);
    const hunk = fileDiff?.hunks[hunkIndex];
    if (!fileDiff || !hunk || !isRevertibleHunk(hunk)) {
      void vscode.window.showWarningMessage('Git Blame Solo: this hunk cannot be reverted.');
      return;
    }

    const absolutePath = path.join(this.repoRoot, relativePath);
    const openDocument = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === absolutePath);
    if (openDocument?.isDirty) {
      void vscode.window.showWarningMessage(
        `Git Blame Solo: save or discard your changes to "${relativePath}" before reverting a hunk in it.`,
      );
      return;
    }

    const lineRange =
      hunk.newCount > 1 ? `lines ${hunk.newStart}-${hunk.newStart + hunk.newCount - 1}` : `line ${hunk.newStart}`;
    const choice = await vscode.window.showWarningMessage(
      `Revert this hunk in "${relativePath}"?`,
      {
        modal: true,
        detail: `This undoes the change shown for ${lineRange} in the current working copy of the file. This cannot be undone from here — you would need to re-apply the change manually.`,
      },
      'Revert Hunk',
    );
    if (choice !== 'Revert Hunk') {
      return;
    }

    const patch = buildHunkPatch(relativePath, hunk);
    try {
      await applyPatchReverse(patch, this.repoRoot);
    } catch (err) {
      const detail = err instanceof GitCliError ? err.stderr.trim() || err.message : String(err);
      console.error('Git Blame Solo: git apply --reverse failed:', detail);
      void vscode.window.showWarningMessage(
        `Git Blame Solo: could not revert this hunk in "${relativePath}" (it may have changed since this commit). ${detail}`,
      );
      return;
    }

    void this.panel.webview.postMessage({ type: 'hunkReverted', path: relativePath, hunkIndex });
    const openAction = await vscode.window.showInformationMessage(`Reverted hunk in "${relativePath}".`, 'Open File');
    if (openAction === 'Open File') {
      await this.openFile(relativePath);
    }
  }

  private renderHtml(commit: CommitDetails, diffs: FileDiff[]): string {
    const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    const diffsByPath = new Map(diffs.map((d) => [d.path, d]));

    const sectionsHtml = commit.files.length
      ? commit.files.map((f) => this.renderFileSection(f, diffsByPath.get(f.path))).join('\n')
      : '<p class="empty">No file changes recorded.</p>';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      padding: 1rem 1.25rem;
    }
    h2 {
      margin: 0 0 0.25rem 0;
      font-size: 1.05rem;
      word-break: break-word;
    }
    .meta {
      color: var(--vscode-descriptionForeground);
      font-size: 0.85rem;
      margin-bottom: 0.75rem;
    }
    .hash {
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .body {
      white-space: pre-wrap;
      margin-bottom: 1rem;
      font-size: 0.9rem;
    }
    h3 {
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 0.5rem;
    }
    .empty {
      color: var(--vscode-descriptionForeground);
    }
    .file-section {
      border: 1px solid var(--vscode-widget-border, transparent);
      border-radius: 4px;
      margin-bottom: 0.75rem;
      overflow: hidden;
    }
    .file-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0.5rem;
      cursor: pointer;
      background: var(--vscode-sideBarSectionHeader-background, var(--vscode-editorWidget-background));
      font-size: 0.88rem;
    }
    .file-header:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .status {
      flex-shrink: 0;
      width: 1.4rem;
      text-align: center;
      font-weight: 600;
      border-radius: 3px;
    }
    .status-A { color: var(--vscode-gitDecoration-addedResourceForeground, #4caf50); }
    .status-M { color: var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d); }
    .status-D { color: var(--vscode-gitDecoration-deletedResourceForeground, #f44336); }
    .status-R { color: var(--vscode-gitDecoration-renamedResourceForeground, #73c991); }
    .path {
      overflow-wrap: anywhere;
      flex: 1;
    }
    .old-path {
      color: var(--vscode-descriptionForeground);
      text-decoration: line-through;
      margin-right: 0.25rem;
    }
    .diff-body {
      overflow-x: auto;
    }
    .diff-line {
      white-space: pre;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.82rem;
      line-height: 1.4;
      padding: 0 0.5rem;
    }
    .diff-marker {
      display: inline-block;
      width: 1.2ch;
      user-select: none;
      opacity: 0.7;
    }
    .diff-add {
      background: var(--vscode-diffEditor-insertedTextBackground, rgba(46, 160, 67, 0.15));
    }
    .diff-del {
      background: var(--vscode-diffEditor-removedTextBackground, rgba(248, 81, 73, 0.15));
    }
    .diff-context {
      opacity: 0.75;
    }
    .diff-meta {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      padding: 0.3rem 0.5rem;
    }
    .diff-line-source {
      position: relative;
      cursor: pointer;
      outline: 1px solid var(--vscode-textLink-foreground);
      outline-offset: -1px;
    }
    .diff-line-source:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .diff-line-source::after {
      content: '\\2190 opened from here';
      position: absolute;
      right: 0.5rem;
      color: var(--vscode-textLink-foreground);
      font-style: italic;
      opacity: 0.85;
    }
    .hunk-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-editorWidget-background);
      margin-top: 0.35rem;
      padding: 0.15rem 0.5rem;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.82rem;
    }
    .revert-btn {
      flex-shrink: 0;
      font-family: var(--vscode-font-family);
      font-size: 0.75rem;
      padding: 0.1rem 0.5rem;
      border-radius: 3px;
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-secondaryBackground, transparent);
      color: var(--vscode-button-secondaryForeground, var(--vscode-textLink-foreground));
      cursor: pointer;
    }
    .revert-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground));
    }
    .revert-btn:disabled {
      cursor: default;
      opacity: 0.6;
    }
    .revert-btn.reverted {
      color: var(--vscode-gitDecoration-deletedResourceForeground, #f44336);
      border-color: transparent;
      background: transparent;
    }
  </style>
</head>
<body>
  <h2>${escapeHtml(commit.summary)}</h2>
  <div class="meta">
    ${escapeHtml(commit.authorName)} &lt;${escapeHtml(commit.authorEmail)}&gt; &bull;
    ${escapeHtml(formatDate(commit.authorTimestamp, 'absolute'))} &bull;
    <span class="hash">${escapeHtml(commit.sha)}</span>
  </div>
  ${commit.body ? `<div class="body">${escapeHtml(commit.body)}</div>` : ''}
  <h3>Changed files (${commit.files.length})</h3>
  ${sectionsHtml}
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('[data-path]').forEach((el) => {
      el.addEventListener('click', () => {
        vscode.postMessage({ type: 'openFile', path: el.getAttribute('data-path') });
      });
    });
    document.querySelectorAll('.diff-line-source').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        vscode.postMessage({ type: 'openSource' });
      });
    });
    document.querySelectorAll('.revert-btn').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        vscode.postMessage({
          type: 'revertHunk',
          path: el.getAttribute('data-file'),
          hunkIndex: Number(el.getAttribute('data-hunk')),
        });
      });
    });
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message && message.type === 'hunkReverted') {
        const btn = document.querySelector(
          '.revert-btn[data-file="' + CSS.escape(message.path) + '"][data-hunk="' + message.hunkIndex + '"]',
        );
        if (btn) {
          btn.textContent = 'Reverted';
          btn.classList.add('reverted');
          btn.disabled = true;
        }
      }
    });
    const sourceLine = document.querySelector('.diff-line-source');
    if (sourceLine) {
      sourceLine.scrollIntoView({ block: 'center' });
    }
  </script>
</body>
</html>`;
  }

  private renderFileSection(file: CommitFileChange, diff: FileDiff | undefined): string {
    const statusLetter = file.status;
    const statusLabel = STATUS_LABELS[statusLetter] ?? statusLetter;
    const oldPathHtml = file.oldPath
      ? `<span class="old-path">${escapeHtml(file.oldPath)} &rarr;</span>`
      : '';

    const header = `<div class="file-header" data-path="${escapeHtml(file.path)}" title="Click to open ${escapeHtml(statusLabel)}">
      <span class="status status-${escapeHtml(statusLetter)}">${escapeHtml(statusLetter)}</span>
      <span class="path">${oldPathHtml}${escapeHtml(file.path)}</span>
    </div>`;

    const body = this.renderDiffBody(file.path, diff, this.sourceCommitLineFor(file.path));
    return `<div class="file-section">${header}${body}</div>`;
  }

  private sourceCommitLineFor(filePath: string): number | undefined {
    if (!this.source) {
      return undefined;
    }
    const relativeSourcePath = path.relative(this.repoRoot, this.source.filePath).split(path.sep).join('/');
    return relativeSourcePath === filePath ? this.source.commitLine : undefined;
  }

  private renderDiffBody(filePath: string, diff: FileDiff | undefined, matchCommitLine: number | undefined): string {
    if (!diff) {
      return '<div class="diff-meta">No diff available for this file.</div>';
    }
    if (diff.hunks.length === 0) {
      return '<div class="diff-meta">No content changes.</div>';
    }

    const hunksHtml = diff.hunks
      .map((hunk, index) => this.renderHunk(filePath, hunk, index, matchCommitLine))
      .join('\n');
    const truncatedNotice = diff.truncated
      ? '<div class="diff-meta">&hellip; diff truncated, open the file to see the rest.</div>'
      : '';
    return `<div class="diff-body">${hunksHtml}${truncatedNotice}</div>`;
  }

  private renderHunk(filePath: string, hunk: DiffHunk, hunkIndex: number, matchCommitLine: number | undefined): string {
    const revertButton = isRevertibleHunk(hunk)
      ? `<button class="revert-btn" data-file="${escapeHtml(filePath)}" data-hunk="${hunkIndex}" title="Undo this change in the current working copy">Revert Hunk</button>`
      : '';
    const headerHtml = `<div class="hunk-header"><span>${escapeHtml(hunk.header)}</span>${revertButton}</div>`;
    const lines = hunk.lines.map((line) => this.renderDiffLine(line, matchCommitLine)).join('\n');
    return `${headerHtml}${lines}`;
  }

  private renderDiffLine(line: DiffLine, matchCommitLine: number | undefined): string {
    if (line.kind === 'meta') {
      return `<div class="diff-line diff-meta">${escapeHtml(line.text)}</div>`;
    }
    const marker = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' ';
    const isSourceLine = matchCommitLine !== undefined && line.newLine === matchCommitLine;
    const sourceClass = isSourceLine ? ' diff-line-source' : '';
    const title = isSourceLine ? ' title="Click to jump back to where this was opened from"' : '';
    return `<div class="diff-line diff-${line.kind}${sourceClass}"${title}><span class="diff-marker">${marker}</span>${escapeHtml(line.text)}</div>`;
  }

  private dispose(): void {
    CommitDetailsPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
