import { isRevertibleHunk } from '../git/gitCommitDiff';
import { pullRequestLabel, RemoteCommitLink } from '../git/gitRemote';
import { CommitDetails, CommitFileChange, DiffHunk, DiffLine, FileChangeStatus, FileDiff, SourceLocation } from '../types';
import { formatDate } from '../util/dateFormat';

/** Everything the commit details page shows. */
export interface CommitDetailsView {
  commit: CommitDetails;
  diffs: FileDiff[];
  /** Where the panel was opened from; that line is marked in its file's diff. */
  source?: SourceLocation;
  remoteLink?: RemoteCommitLink;
}

// Codicons "copy" and "check" (CC BY 4.0), inlined because webviews don't load the icon font.
const COPY_ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M4 4l1-1h5.414L14 6.586V14l-1 1H5l-1-1V4zm9 3l-3-3H5v10h8V7z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M3 1L2 2v10l1 1V2h6.414l-1-1H3z"/></svg>';
const CHECK_ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M14.431 3.323l-8.47 10-.79-.036-3.35-4.77.818-.574 2.978 4.24 8.051-9.506.764.646z"/></svg>';

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

export function renderCommitDetailsHtml(view: CommitDetailsView, nonce: string): string {
  const { commit, diffs } = view;
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  const diffsByPath = new Map(diffs.map((d) => [d.path, d]));

  const sectionsHtml = commit.files.length
    ? commit.files.map((f) => renderFileSection(view, f, diffsByPath.get(f.path))).join('\n')
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
  .copy-sha-btn {
    display: inline-flex;
    align-items: center;
    vertical-align: middle;
    padding: 2px;
    margin-left: 0.25rem;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--vscode-icon-foreground, currentColor);
    cursor: pointer;
  }
  .copy-sha-btn:hover {
    background: var(--vscode-toolbar-hoverBackground);
  }
  .copy-sha-btn.copied {
    color: var(--vscode-testing-iconPassed, currentColor);
  }
  .remote-btn {
    margin-left: 0.5rem;
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
  .diff-editor-btn {
    flex-shrink: 0;
    font-family: var(--vscode-font-family);
    font-size: 0.75rem;
    padding: 0.1rem 0.5rem;
    border-radius: 3px;
    border: 1px solid var(--vscode-button-border, transparent);
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    cursor: pointer;
  }
  .diff-editor-btn:hover {
    background: var(--vscode-button-hoverBackground);
  }
</style>
</head>
<body>
<h2>${escapeHtml(commit.summary)}</h2>
<div class="meta">
  ${escapeHtml(commit.authorName)} &lt;${escapeHtml(commit.authorEmail)}&gt; &bull;
  ${escapeHtml(formatDate(commit.authorTimestamp, 'absolute'))} &bull;
  <span class="hash">${escapeHtml(commit.sha)}</span>
  <button class="copy-sha-btn" title="Copy commit SHA" aria-label="Copy commit SHA">${COPY_ICON}</button>
  ${renderRemoteButtons(view.remoteLink)}
</div>
${
  commit.coAuthors.length > 0
    ? `<div class="meta">Co-authored by ${commit.coAuthors
        .map((p) => `${escapeHtml(p.name)} &lt;${escapeHtml(p.email)}&gt;`)
        .join(', ')}</div>`
    : ''
}
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
  document.querySelectorAll('.copy-sha-btn').forEach((el) => {
    el.addEventListener('click', () => {
      vscode.postMessage({ type: 'copySha' });
      el.innerHTML = ${JSON.stringify(CHECK_ICON)};
      el.classList.add('copied');
      el.title = 'Copied';
      setTimeout(() => {
        el.innerHTML = ${JSON.stringify(COPY_ICON)};
        el.classList.remove('copied');
        el.title = 'Copy commit SHA';
      }, 1500);
    });
  });
  document.querySelectorAll('.remote-btn').forEach((el) => {
    el.addEventListener('click', () => vscode.postMessage({ type: 'openRemote', target: el.dataset.target }));
  });
  document.querySelectorAll('.diff-editor-btn:not(.remote-btn)').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      vscode.postMessage({
        type: 'openDiff',
        path: el.getAttribute('data-file'),
        oldPath: el.getAttribute('data-old-file') || undefined,
      });
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

function renderFileSection(view: CommitDetailsView, file: CommitFileChange, diff: FileDiff | undefined): string {
  const statusLetter = file.status;
  const statusLabel = STATUS_LABELS[statusLetter] ?? statusLetter;
  const oldPathHtml = file.oldPath
    ? `<span class="old-path">${escapeHtml(file.oldPath)} &rarr;</span>`
    : '';

  const header = `<div class="file-header" data-path="${escapeHtml(file.path)}" title="Click to open ${escapeHtml(statusLabel)}">
    <span class="status status-${escapeHtml(statusLetter)}">${escapeHtml(statusLetter)}</span>
    <span class="path">${oldPathHtml}${escapeHtml(file.path)}</span>
    <button class="diff-editor-btn" data-file="${escapeHtml(file.path)}" data-old-file="${escapeHtml(file.oldPath ?? '')}" title="Open this file's change in VS Code's diff editor">Open Diff</button>
  </div>`;

  const body = renderDiffBody(file.path, diff, sourceCommitLineFor(view.source, file.path));
  return `<div class="file-section">${header}${body}</div>`;
}

function renderRemoteButtons(link: RemoteCommitLink | undefined): string {
  if (!link) {
    return '';
  }
  const buttons = [
    `<button class="diff-editor-btn remote-btn" data-target="commit" title="${escapeHtml(link.url)}">Open on ${escapeHtml(link.provider)}</button>`,
  ];
  if (link.pullRequest) {
    buttons.push(
      `<button class="diff-editor-btn remote-btn" data-target="pullRequest" title="${escapeHtml(link.pullRequest.url)}">Open ${pullRequestLabel(link.provider, link.pullRequest.number)}</button>`,
    );
  }
  return buttons.join('');
}

function sourceCommitLineFor(source: SourceLocation | undefined, filePath: string): number | undefined {
  return source?.commitPath === filePath ? source.commitLine : undefined;
}

function renderDiffBody(filePath: string, diff: FileDiff | undefined, matchCommitLine: number | undefined): string {
  if (!diff) {
    return '<div class="diff-meta">No diff available for this file.</div>';
  }
  if (diff.hunks.length === 0) {
    return '<div class="diff-meta">No content changes.</div>';
  }

  const hunksHtml = diff.hunks
    .map((hunk, index) => renderHunk(filePath, hunk, index, matchCommitLine))
    .join('\n');
  const truncatedNotice = diff.truncated
    ? '<div class="diff-meta">&hellip; diff truncated, open the file to see the rest.</div>'
    : '';
  return `<div class="diff-body">${hunksHtml}${truncatedNotice}</div>`;
}

function renderHunk(filePath: string, hunk: DiffHunk, hunkIndex: number, matchCommitLine: number | undefined): string {
  const revertButton = isRevertibleHunk(hunk)
    ? `<button class="revert-btn" data-file="${escapeHtml(filePath)}" data-hunk="${hunkIndex}" title="Undo this change in the current working copy">Revert Hunk</button>`
    : '';
  const headerHtml = `<div class="hunk-header"><span>${escapeHtml(hunk.header)}</span>${revertButton}</div>`;
  const lines = hunk.lines.map((line) => renderDiffLine(line, matchCommitLine)).join('\n');
  return `${headerHtml}${lines}`;
}

function renderDiffLine(line: DiffLine, matchCommitLine: number | undefined): string {
  if (line.kind === 'meta') {
    return `<div class="diff-line diff-meta">${escapeHtml(line.text)}</div>`;
  }
  const marker = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' ';
  const isSourceLine = matchCommitLine !== undefined && line.newLine === matchCommitLine;
  const sourceClass = isSourceLine ? ' diff-line-source' : '';
  const title = isSourceLine ? ' title="Click to jump back to where this was opened from"' : '';
  return `<div class="diff-line diff-${line.kind}${sourceClass}"${title}><span class="diff-marker">${marker}</span>${escapeHtml(line.text)}</div>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
