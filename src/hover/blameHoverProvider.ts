import * as fs from 'fs';
import * as vscode from 'vscode';
import { BlameCache } from '../cache/blameCache';
import { CommitCache } from '../cache/commitCache';
import { LineDiffCache } from '../cache/lineDiffCache';
import { GitBlameSoloConfig } from '../config';
import { blameLine } from '../git/gitBlame';
import { getLineDiffHunk } from '../git/gitDiff';
import { getCommitDetails } from '../git/gitLog';
import { resolveRepository } from '../git/gitRepository';
import { formatDate } from '../util/dateFormat';

function buildShowDetailsCommandUri(sha: string, repoRoot: string, sourceFilePath: string, sourceLine: number): string {
  const args = encodeURIComponent(JSON.stringify([sha, repoRoot, sourceFilePath, sourceLine]));
  return `command:gitBlameSolo.showCommitDetails?${args}`;
}

export interface BlameHoverProviderDeps {
  blameCache: BlameCache;
  commitCache: CommitCache;
  lineDiffCache: LineDiffCache;
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

    const diffHunkPromise = this.deps.lineDiffCache.getOrCompute(
      blame.sha,
      `${document.uri.toString()}#${blame.originalLine}`,
      () =>
        getLineDiffHunk({
          sha: blame.sha,
          filePath: document.uri.fsPath,
          line: blame.originalLine,
          repoRoot: repo.rootFsPath,
          signal: controller.signal,
        }),
    );

    const commit = await this.deps.commitCache.getOrCompute(blame.sha, () =>
      getCommitDetails(blame.sha, repo.rootFsPath, controller.signal),
    );
    const diffHunk = await diffHunkPromise;

    if (token.isCancellationRequested) {
      return undefined;
    }

    if (!commit) {
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**${blame.summary}**\n\n`);
      md.appendMarkdown(`${blame.authorName} • ${formatDate(blame.authorTimestamp, 'absolute')}\n\n`);
      md.appendMarkdown(`\`${blame.sha}\``);
      this.appendDiff(md, diffHunk);
      return new vscode.Hover(md, range);
    }

    const md = new vscode.MarkdownString();
    md.isTrusted = { enabledCommands: ['gitBlameSolo.showCommitDetails'] };
    md.appendMarkdown(`**${commit.summary}**\n\n`);
    md.appendMarkdown(
      `${commit.authorName} <${commit.authorEmail}> • ${formatDate(commit.authorTimestamp, 'absolute')}\n\n`,
    );
    if (commit.body) {
      md.appendMarkdown(`${commit.body}\n\n`);
    }
    md.appendMarkdown(`\`${commit.sha}\``);
    this.appendDiff(md, diffHunk);

    const fileCount = commit.files.length;
    const fileLabel = fileCount === 1 ? '1 file' : `${fileCount} files`;
    const commandUri = buildShowDetailsCommandUri(commit.sha, repo.rootFsPath, document.uri.fsPath, line);
    md.appendMarkdown(`\n\n[View changed files (${fileLabel})](${commandUri})`);
    return new vscode.Hover(md, range);
  }

  private appendDiff(md: vscode.MarkdownString, diffHunk: string | undefined): void {
    if (!diffHunk) {
      return;
    }
    md.appendMarkdown('\n\n**What changed:**\n');
    md.appendCodeblock(diffHunk, 'diff');
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
