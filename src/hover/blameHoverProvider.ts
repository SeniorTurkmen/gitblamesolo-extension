import * as fs from 'fs';
import * as vscode from 'vscode';
import { BlameCache } from '../cache/blameCache';
import { CommitCache } from '../cache/commitCache';
import { LineDiffCache } from '../cache/lineDiffCache';
import { GitBlameSoloConfig, isExcluded } from '../config';
import { BLAMEABLE_SCHEMES, blameTarget, resolveBlameTarget } from '../git/blameTarget';
import { getLineDiffHunk, getUncommittedHunk } from '../git/gitDiff';
import { getCommitDetails } from '../git/gitLog';
import { getCommitLink, pullRequestLabel } from '../git/gitRemote';
import { UnpushedCache } from '../git/gitUnpushed';
import { formatAuthor } from '../util/authorFormat';
import { formatDate } from '../util/dateFormat';
import { countDiffStats, parseDiffHunkLines } from '../util/diffRender';
import { emojify } from '../util/emoji';

function buildShowDetailsCommandUri(
  sha: string,
  repoRoot: string,
  sourceUri: string,
  sourceLine: number,
  sourceCommitLine: number,
  sourceCommitPath: string,
): string {
  const args = encodeURIComponent(
    JSON.stringify([sha, repoRoot, sourceUri, sourceLine, sourceCommitLine, sourceCommitPath]),
  );
  return `command:gitBlameSolo.showCommitDetails?${args}`;
}

function buildBlamePreviousCommandUri(
  sha: string,
  repoRoot: string,
  relativePath: string,
  previous: { sha: string; filename: string },
  originalLine: number,
  sourceUri: string,
  sourceLine: number,
): string {
  const args = encodeURIComponent(
    JSON.stringify([sha, repoRoot, relativePath, previous.sha, previous.filename, originalLine, sourceUri, sourceLine]),
  );
  return `command:gitBlameSolo.blamePreviousRevision?${args}`;
}

function buildOpenDiffCommandUri(
  sha: string,
  repoRoot: string,
  relativePath: string,
  oldRelativePath: string | undefined,
  line: number,
): string {
  const args = encodeURIComponent(JSON.stringify([sha, repoRoot, relativePath, oldRelativePath, line]));
  return `command:gitBlameSolo.openDiff?${args}`;
}

function buildLineHistoryCommandUri(sha: string, repoRoot: string, relativePath: string, line: number): string {
  const args = encodeURIComponent(JSON.stringify([sha, repoRoot, relativePath, line]));
  return `command:gitBlameSolo.showLineHistory?${args}`;
}

/** The author as a link that opens the git log filtered to their commits. */
function authorLink(name: string, email: string, showEmail: boolean, repoRoot: string): string {
  const args = encodeURIComponent(JSON.stringify([repoRoot, email || name]));
  const label = escapeAngleBrackets(formatAuthor(name, email, showEmail)).replace(/[[\]\\]/g, '\\$&');
  const tooltip = `Show every commit by ${name}`.replace(/"/g, "'");
  return `[${label}](command:gitBlameSolo.showAuthorHistory?${args} "${tooltip}")`;
}

/** The short SHA with a button that copies the full one. */
/** The "What changed" section: a hunk with its added and removed line counts, then `link`. */
function appendDiffBlock(md: vscode.MarkdownString, diffHunk: string | undefined, link: string): void {
  const lines = diffHunk ? parseDiffHunkLines(diffHunk) : [];
  if (!diffHunk || lines.length === 0) {
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
  md.appendMarkdown(`$(diff) **What changed**${stats ? ` &nbsp; ${stats}` : ''}\n`);
  md.appendCodeblock(diffHunk, 'diff');
  md.appendMarkdown(`\n${link}`);
}

function appendSha(md: vscode.MarkdownString, sha: string, repoRoot: string, unpushed: boolean): void {
  const copyUri = `command:gitBlameSolo.copyCommitHash?${encodeURIComponent(JSON.stringify([sha]))}`;
  const copyMessageUri = `command:gitBlameSolo.copyCommitMessage?${encodeURIComponent(JSON.stringify([sha, repoRoot]))}`;
  md.appendMarkdown(
    `\`${sha.slice(0, 7)}\` [$(copy)](${copyUri} "Copy commit SHA") &nbsp; [$(note) Copy message](${copyMessageUri} "Copy the full commit message")`,
  );
  if (unpushed) {
    md.appendMarkdown(' &nbsp;&nbsp; $(cloud-upload) Not pushed yet');
  }
}

/** Keeps "<email>" literal instead of letting Markdown turn it into an autolink. */
function escapeAngleBrackets(text: string): string {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function newMarkdown(): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.supportThemeIcons = true;
  md.isTrusted = {
    enabledCommands: [
      'gitBlameSolo.showCommitDetails',
      'gitBlameSolo.openDiff',
      'gitBlameSolo.copyCommitHash',
      'gitBlameSolo.copyCommitMessage',
      'gitBlameSolo.compareWithRevision',
      'gitBlameSolo.blamePreviousRevision',
      'gitBlameSolo.showLineHistory',
      'gitBlameSolo.showAuthorHistory',
    ],
  };
  return md;
}

export interface BlameHoverProviderDeps {
  blameCache: BlameCache;
  commitCache: CommitCache;
  lineDiffCache: LineDiffCache;
  unpushedCache: UnpushedCache;
  getConfig: () => GitBlameSoloConfig;
}

/**
 * The annotation is injected after the end of the active line, and VS Code
 * reports a hover over injected text at the line's end column. Hovering the
 * empty space past the end of that line lands there too.
 */
function isOverAnnotation(document: vscode.TextDocument, position: vscode.Position, config: GitBlameSoloConfig): boolean {
  const editor = vscode.window.activeTextEditor;
  return (
    config.enabled &&
    editor?.document === document &&
    editor.selection.active.line === position.line &&
    position.character >= document.lineAt(position.line).range.end.character
  );
}

/**
 * The file blame column is injected before each line's text, and VS Code
 * reports a hover over it at the line's first column.
 */
function isOverFileBlame(position: vscode.Position, config: GitBlameSoloConfig): boolean {
  return config.fileBlameEnabled && position.character === 0;
}

export class BlameHoverProvider implements vscode.HoverProvider {
  constructor(private readonly deps: BlameHoverProviderDeps) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Hover | undefined> {
    const config = this.deps.getConfig();
    if (!config.hoverEnabled || !BLAMEABLE_SCHEMES.includes(document.uri.scheme)) {
      return undefined;
    }
    if (document.getText().length > config.maxFileSizeBytes || isExcluded(document, config)) {
      return undefined;
    }
    const overFileBlame = isOverFileBlame(position, config);
    if (config.hoverTrigger === 'annotation' && !overFileBlame && !isOverAnnotation(document, position, config)) {
      return undefined;
    }

    // Results land in caches shared with the inline decorator, so git runs are
    // never aborted on hover cancellation: an aborted run would cache `undefined`
    // and blank the line until the document changes.
    const target = await resolveBlameTarget(document.uri);
    if (!target || token.isCancellationRequested) {
      return undefined;
    }
    const repoRoot = target.repoRoot;

    const line = position.line;
    const blame = await this.deps.blameCache.getLine(document, line, () =>
      blameTarget(target, document, config.blameOptions),
    );

    if (!blame || token.isCancellationRequested) {
      return undefined;
    }

    const lineRange = document.lineAt(line).range;
    const range =
      config.hoverTrigger === 'line'
        ? lineRange
        : overFileBlame
          ? new vscode.Range(lineRange.start, lineRange.start)
          : new vscode.Range(lineRange.end, lineRange.end);

    if (blame.isUncommitted) {
      const md = newMarkdown();
      md.appendMarkdown(`$(circle-large-filled) **${config.uncommittedLabel}**\n\n`);
      if (document.isDirty) {
        md.appendMarkdown('$(edit) File has unsaved changes');
      } else if (document.uri.scheme === 'file') {
        const mtimeSeconds = await this.getMtimeSeconds(document.uri.fsPath);
        md.appendMarkdown(`$(save) File saved ${formatDate(mtimeSeconds, 'absolute')}`);
      }
      // Compared with the last commit, unsaved edits included, as blame sees them.
      const diffHunk = await getUncommittedHunk(repoRoot, target.relativePath, document.getText(), line);
      if (token.isCancellationRequested) {
        return undefined;
      }
      const compareUri = `command:gitBlameSolo.compareWithRevision?${encodeURIComponent(
        JSON.stringify([repoRoot, 'HEAD', target.relativePath, target.relativePath]),
      )}`;
      appendDiffBlock(md, diffHunk, `[$(link-external) Open in Diff Editor](${compareUri} "Compare the file with its last commit")`);
      return new vscode.Hover(md, range);
    }

    const diffHunkPromise = this.deps.lineDiffCache.getOrCompute(
      blame.sha,
      `${blame.filename}#${blame.originalLine}`,
      () =>
        getLineDiffHunk({
          sha: blame.sha,
          relativePath: blame.filename,
          line: blame.originalLine,
          repoRoot,
        }),
    );

    const commit = await this.deps.commitCache.getOrCompute(blame.sha, () =>
      getCommitDetails(blame.sha, repoRoot),
    );
    const diffHunk = await diffHunkPromise;
    const unpushed = config.showUnpushed && (await this.deps.unpushedCache.isUnpushed(repoRoot, blame.sha));
    const remoteLink = await getCommitLink(
      repoRoot,
      blame.sha,
      commit ? `${commit.summary}\n\n${commit.body}` : blame.summary,
    );

    if (token.isCancellationRequested) {
      return undefined;
    }

    if (!commit) {
      const md = newMarkdown();
      md.appendMarkdown(`$(git-commit) **${emojify(blame.summary)}**\n\n`);
      md.appendMarkdown(
        `$(account) ${authorLink(blame.authorName, blame.authorEmail, config.showAuthorEmail, repoRoot)} &nbsp;&nbsp; $(clock) ${formatDate(blame.authorTimestamp, 'absolute')}\n\n`,
      );
      appendSha(md, blame.sha, repoRoot, unpushed);
      this.appendDiff(md, diffHunk, blame.sha, repoRoot, blame.filename, blame.previous?.filename, blame.originalLine);
      return new vscode.Hover(md, range);
    }

    const md = newMarkdown();
    md.appendMarkdown(`$(git-commit) **${emojify(commit.summary)}**\n\n`);
    md.appendMarkdown(
      `$(account) ${authorLink(commit.authorName, commit.authorEmail, config.showAuthorEmail, repoRoot)} &nbsp;&nbsp; $(clock) ${formatDate(commit.authorTimestamp, 'absolute')}\n\n`,
    );
    if (commit.coAuthors.length > 0) {
      const names = commit.coAuthors.map((p) => formatAuthor(p.name, p.email, config.showAuthorEmail)).join(', ');
      md.appendMarkdown(`$(organization) Co-authored by ${escapeAngleBrackets(names)}\n\n`);
    }
    if (commit.body) {
      md.appendMarkdown(`${emojify(commit.body)}\n\n`);
    }
    appendSha(md, commit.sha, repoRoot, unpushed);
    this.appendDiff(md, diffHunk, commit.sha, repoRoot, blame.filename, blame.previous?.filename, blame.originalLine);

    md.appendMarkdown('\n\n---\n\n');
    const fileCount = commit.files.length;
    const fileLabel = fileCount === 1 ? '1 file' : `${fileCount} files`;
    const commandUri = buildShowDetailsCommandUri(
      commit.sha,
      repoRoot,
      document.uri.toString(),
      line,
      blame.originalLine + 1,
      blame.filename,
    );
    md.appendMarkdown(`$(files) [View changed files (${fileLabel})](${commandUri})`);
    const historyUri = buildLineHistoryCommandUri(blame.sha, repoRoot, blame.filename, blame.originalLine);
    md.appendMarkdown(` &nbsp;&nbsp; $(list-unordered) [Line history](${historyUri} "Every commit that changed this line")`);
    if (blame.previous) {
      const previousUri = buildBlamePreviousCommandUri(
        blame.sha,
        repoRoot,
        blame.filename,
        blame.previous,
        blame.originalLine,
        document.uri.toString(),
        line,
      );
      md.appendMarkdown(
        ` &nbsp;&nbsp; $(history) [Blame previous revision](${previousUri} "Compare the file as it was before this commit with its current version")`,
      );
    }
    if (remoteLink) {
      md.appendMarkdown(` &nbsp;&nbsp; $(globe) [Open on ${remoteLink.provider}](${remoteLink.url})`);
      if (remoteLink.pullRequest) {
        const label = pullRequestLabel(remoteLink.provider, remoteLink.pullRequest.number);
        md.appendMarkdown(` &nbsp;&nbsp; $(git-pull-request) [${label}](${remoteLink.pullRequest.url})`);
      }
    }
    return new vscode.Hover(md, range);
  }

  private appendDiff(
    md: vscode.MarkdownString,
    diffHunk: string | undefined,
    sha: string,
    repoRoot: string,
    relativePath: string,
    oldRelativePath: string | undefined,
    line: number,
  ): void {
    if (!diffHunk) {
      return;
    }
    const openDiffUri = buildOpenDiffCommandUri(sha, repoRoot, relativePath, oldRelativePath, line);
    appendDiffBlock(md, diffHunk, `[$(link-external) Open in Diff Editor](${openDiffUri})`);
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
