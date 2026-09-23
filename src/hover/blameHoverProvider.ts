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
import { countDiffStats, DiffRenderLine, parseDiffHunkLines } from '../util/diffRender';

function buildShowDetailsCommandUri(
  sha: string,
  repoRoot: string,
  sourceFilePath: string,
  sourceLine: number,
  sourceCommitLine: number,
): string {
  const args = encodeURIComponent(JSON.stringify([sha, repoRoot, sourceFilePath, sourceLine, sourceCommitLine]));
  return `command:gitBlameSolo.showCommitDetails?${args}`;
}

function newMarkdown(): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.supportThemeIcons = true;
  return md;
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
      const md = newMarkdown();
      md.appendMarkdown(`$(circle-large-filled) **${config.uncommittedLabel}**\n\n`);
      md.appendMarkdown(`$(clock) Last modified ${formatDate(mtimeSeconds, 'absolute')}`);
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
      const md = newMarkdown();
      md.appendMarkdown(`$(git-commit) **${blame.summary}**\n\n`);
      md.appendMarkdown(
        `$(account) ${blame.authorName} &nbsp;&nbsp; $(clock) ${formatDate(blame.authorTimestamp, 'absolute')}\n\n`,
      );
      md.appendMarkdown(`\`${blame.sha.slice(0, 7)}\``);
      this.appendDiff(md, diffHunk);
      return new vscode.Hover(md, range);
    }

    const md = newMarkdown();
    md.isTrusted = { enabledCommands: ['gitBlameSolo.showCommitDetails'] };
    md.appendMarkdown(`$(git-commit) **${commit.summary}**\n\n`);
    md.appendMarkdown(
      `$(account) ${commit.authorName} &nbsp;&nbsp; $(clock) ${formatDate(commit.authorTimestamp, 'absolute')}\n\n`,
    );
    if (commit.body) {
      md.appendMarkdown(`${commit.body}\n\n`);
    }
    md.appendMarkdown(`\`${commit.sha.slice(0, 7)}\``);
    this.appendDiff(md, diffHunk);

    md.appendMarkdown('\n\n---\n\n');
    const fileCount = commit.files.length;
    const fileLabel = fileCount === 1 ? '1 file' : `${fileCount} files`;
    const commandUri = buildShowDetailsCommandUri(
      commit.sha,
      repo.rootFsPath,
      document.uri.fsPath,
      line,
      blame.originalLine + 1,
    );
    md.appendMarkdown(`$(files) [View changed files (${fileLabel})](${commandUri})`);
    return new vscode.Hover(md, range);
  }

  private appendDiff(md: vscode.MarkdownString, diffHunk: string | undefined): void {
    if (!diffHunk) {
      return;
    }
    const lines = parseDiffHunkLines(diffHunk);
    if (lines.length === 0) {
      return;
    }

    const { added, removed } = countDiffStats(lines);
    const stats = [
      added > 0 ? `$(diff-added) ${added}` : undefined,
      removed > 0 ? `$(diff-removed) ${removed}` : undefined,
    ]
      .filter(Boolean)
      .join(' &nbsp; ');

    md.appendMarkdown('\n\n---\n\n');
    md.appendMarkdown(`$(diff) **What changed**${stats ? ` &nbsp; ${stats}` : ''}\n\n`);

    // Rendered as icon-prefixed inline code inside one continuous blockquote —
    // this guarantees add/remove coloring via codicons (which always pick up the
    // theme's git decoration colors) instead of depending on whether the current
    // theme defines strong diff-syntax colors for a plain ```diff code block.
    const body = lines.map((line) => this.renderHoverDiffLine(line)).join('\n> ');
    md.appendMarkdown(`> ${body}`);
  }

  private renderHoverDiffLine(line: DiffRenderLine): string {
    const text = line.text.length > 0 ? escapeInlineCode(line.text) : ' ';
    const code = `\`${text}\``;
    if (line.kind === 'add') {
      return `$(diff-added) ${code}`;
    }
    if (line.kind === 'del') {
      return `$(diff-removed) ${code}`;
    }
    return `&nbsp;&nbsp;${code}`;
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

/**
 * Inline code spans break if the content contains a backtick; since we render
 * arbitrary source lines this way, swap literal backticks for a look-alike
 * character rather than trying to pick a longer, content-free delimiter run.
 */
function escapeInlineCode(text: string): string {
  return text.replace(/`/g, 'ˋ');
}
