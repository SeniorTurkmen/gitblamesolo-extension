import * as path from 'path';
import * as vscode from 'vscode';
import { CommitDetails, CommitFileChange, FileChangeStatus } from '../types';
import { formatDate } from '../util/dateFormat';

interface WebviewMessage {
  type: 'openFile';
  path: string;
}

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

  static show(commit: CommitDetails, repoRoot: string): void {
    if (CommitDetailsPanel.current) {
      CommitDetailsPanel.current.update(commit, repoRoot);
      CommitDetailsPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'gitBlameSoloCommitDetails',
      'Commit Details',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    CommitDetailsPanel.current = new CommitDetailsPanel(panel, commit, repoRoot);
  }

  private constructor(panel: vscode.WebviewPanel, commit: CommitDetails, repoRoot: string) {
    this.panel = panel;
    this.repoRoot = repoRoot;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.handleMessage(message),
      null,
      this.disposables,
    );

    this.update(commit, repoRoot);
  }

  private update(commit: CommitDetails, repoRoot: string): void {
    this.repoRoot = repoRoot;
    this.panel.title = `Commit ${commit.sha.slice(0, 7)}`;
    this.panel.webview.html = this.renderHtml(commit);
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    if (message.type === 'openFile') {
      const absolutePath = path.join(this.repoRoot, message.path);
      try {
        const document = await vscode.workspace.openTextDocument(absolutePath);
        await vscode.window.showTextDocument(document, { preview: true });
      } catch {
        void vscode.window.showWarningMessage(`Git Blame Solo: could not open "${message.path}".`);
      }
    }
  }

  private renderHtml(commit: CommitDetails): string {
    const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;

    const filesHtml = commit.files.length
      ? commit.files.map((f) => this.renderFileRow(f)).join('\n')
      : '<li class="empty">No file changes recorded.</li>';

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
      margin-bottom: 0.4rem;
    }
    ul.files {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    ul.files li {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.2rem 0.3rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.88rem;
    }
    ul.files li:hover {
      background: var(--vscode-list-hoverBackground);
    }
    ul.files li.empty {
      cursor: default;
      color: var(--vscode-descriptionForeground);
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
    }
    .old-path {
      color: var(--vscode-descriptionForeground);
      text-decoration: line-through;
      margin-right: 0.25rem;
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
  <ul class="files">
    ${filesHtml}
  </ul>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('li[data-path]').forEach((el) => {
      el.addEventListener('click', () => {
        vscode.postMessage({ type: 'openFile', path: el.getAttribute('data-path') });
      });
    });
  </script>
</body>
</html>`;
  }

  private renderFileRow(file: CommitFileChange): string {
    const statusLetter = file.status;
    const statusLabel = STATUS_LABELS[statusLetter] ?? statusLetter;
    const oldPathHtml = file.oldPath
      ? `<span class="old-path">${escapeHtml(file.oldPath)} &rarr;</span>`
      : '';
    return `<li data-path="${escapeHtml(file.path)}" title="${escapeHtml(statusLabel)}">
      <span class="status status-${escapeHtml(statusLetter)}">${escapeHtml(statusLetter)}</span>
      <span class="path">${oldPathHtml}${escapeHtml(file.path)}</span>
    </li>`;
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
