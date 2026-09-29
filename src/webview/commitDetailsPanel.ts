import * as path from 'path';
import * as vscode from 'vscode';
import { applyPatchReverse } from '../git/gitApply';
import { GitCliError } from '../git/gitCli';
import { buildHunkPatch, isRevertibleHunk } from '../git/gitCommitDiff';
import { RemoteCommitLink } from '../git/gitRemote';
import { CommitDetails, FileDiff, SourceLocation } from '../types';
import { renderCommitDetailsHtml } from './commitDetailsHtml';

type WebviewMessage =
  | { type: 'openFile'; path: string }
  | { type: 'openSource' }
  | { type: 'openDiff'; path: string; oldPath?: string }
  | { type: 'openRemote'; target: 'commit' | 'pullRequest' }
  | { type: 'copySha' }
  | { type: 'revertHunk'; path: string; hunkIndex: number };

export class CommitDetailsPanel {
  private static current: CommitDetailsPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private repoRoot: string;
  private commitSha = '';
  private source: SourceLocation | undefined;
  private remoteLink: RemoteCommitLink | undefined;
  private diffs: FileDiff[] = [];

  static show(
    commit: CommitDetails,
    diffs: FileDiff[],
    repoRoot: string,
    source?: SourceLocation,
    remoteLink?: RemoteCommitLink,
    focusPath?: string,
  ): void {
    if (CommitDetailsPanel.current) {
      CommitDetailsPanel.current.update(commit, diffs, repoRoot, source, remoteLink, focusPath);
      CommitDetailsPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'gitBlameSoloCommitDetails',
      'Commit Details',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    CommitDetailsPanel.current = new CommitDetailsPanel(panel, commit, diffs, repoRoot, source, remoteLink, focusPath);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    commit: CommitDetails,
    diffs: FileDiff[],
    repoRoot: string,
    source: SourceLocation | undefined,
    remoteLink: RemoteCommitLink | undefined,
    focusPath: string | undefined,
  ) {
    this.panel = panel;
    this.repoRoot = repoRoot;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.handleMessage(message),
      null,
      this.disposables,
    );

    this.update(commit, diffs, repoRoot, source, remoteLink, focusPath);
  }

  private update(
    commit: CommitDetails,
    diffs: FileDiff[],
    repoRoot: string,
    source: SourceLocation | undefined,
    remoteLink: RemoteCommitLink | undefined,
    focusPath: string | undefined,
  ): void {
    this.repoRoot = repoRoot;
    this.commitSha = commit.sha;
    this.source = source;
    this.remoteLink = remoteLink;
    this.diffs = diffs;
    this.panel.title = `Commit ${commit.sha.slice(0, 7)}`;
    const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    this.panel.webview.html = renderCommitDetailsHtml({ commit, diffs, source, remoteLink, focusPath }, nonce);
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
    if (message.type === 'openDiff') {
      await vscode.commands.executeCommand(
        'gitBlameSolo.openDiff',
        this.commitSha,
        this.repoRoot,
        message.path,
        message.oldPath,
      );
      return;
    }
    if (message.type === 'copySha') {
      await vscode.commands.executeCommand('gitBlameSolo.copyCommitHash', this.commitSha);
      return;
    }
    if (message.type === 'openRemote') {
      const url = message.target === 'pullRequest' ? this.remoteLink?.pullRequest?.url : this.remoteLink?.url;
      if (url) {
        await vscode.env.openExternal(vscode.Uri.parse(url));
      }
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
      const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(this.source.uri));
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

  private dispose(): void {
    CommitDetailsPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }
}
