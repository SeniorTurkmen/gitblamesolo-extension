import * as fs from 'fs';
import * as vscode from 'vscode';
import { BlameCache } from '../cache/blameCache';
import { CommitCache } from '../cache/commitCache';
import { GitBlameSoloConfig } from '../config';
import { blameLine } from '../git/gitBlame';
import { getCommitDetails } from '../git/gitLog';
import { resolveRepository } from '../git/gitRepository';
import { formatDate } from '../util/dateFormat';

export interface BlameHoverProviderDeps {
  blameCache: BlameCache;
  commitCache: CommitCache;
  getConfig: () => GitBlameSoloConfig;
}

export class BlameHoverProvider implements vscode.HoverProvider {
  constructor(private readonly deps: BlameHoverProviderDeps) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Hover | undefined> {
    const config = this.deps.getConfig();
    if (!config.hoverEnabled || document.uri.scheme !== 'file') {
      return undefined;
    }
    if (document.getText().length > config.maxFileSizeBytes) {
      return undefined;
    }

    const controller = new AbortController();
    token.onCancellationRequested(() => controller.abort());

    const repo = await resolveRepository(document.uri);
    if (!repo || token.isCancellationRequested) {
      return undefined;
    }

    const line = position.line;
    const blame = await this.deps.blameCache.getOrCompute(document, line, () =>
      blameLine({
        filePath: document.uri.fsPath,
        content: document.getText(),
        line,
        repoRoot: repo.rootFsPath,
        signal: controller.signal,
      }),
    );

    if (!blame || token.isCancellationRequested) {
      return undefined;
    }

    const range = document.lineAt(line).range;

    if (blame.isUncommitted) {
      const mtimeSeconds = await this.getMtimeSeconds(document.uri.fsPath);
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**${config.uncommittedLabel}**\n\n`);
      md.appendMarkdown(`Last modified: ${formatDate(mtimeSeconds, 'absolute')}`);
      return new vscode.Hover(md, range);
    }

    const commit = await this.deps.commitCache.getOrCompute(blame.sha, () =>
      getCommitDetails(blame.sha, repo.rootFsPath, controller.signal),
    );

    if (token.isCancellationRequested) {
      return undefined;
    }

    if (!commit) {
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**${blame.summary}**\n\n`);
      md.appendMarkdown(`${blame.authorName} • ${formatDate(blame.authorTimestamp, 'absolute')}\n\n`);
      md.appendMarkdown(`\`${blame.sha}\``);
      return new vscode.Hover(md, range);
    }

    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${commit.summary}**\n\n`);
    md.appendMarkdown(
      `${commit.authorName} <${commit.authorEmail}> • ${formatDate(commit.authorTimestamp, 'absolute')}\n\n`,
    );
    if (commit.body) {
      md.appendMarkdown(`${commit.body}\n\n`);
    }
    md.appendMarkdown(`\`${commit.sha}\``);
    return new vscode.Hover(md, range);
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
