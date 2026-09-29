import { BranchList, CommitRef, HistoryEntry, HistoryFilter } from '../git/gitHistory';
import { DateStyle, formatDate } from '../util/dateFormat';
import { GraphRow } from '../util/historyGraph';
import { escapeHtml } from './html';

/** Width of one graph lane and height of one row, in pixels. */
export const LANE_WIDTH = 14;
export const ROW_HEIGHT = 26;
const GRAPH_COLORS = 8;

export interface HistoryShellView {
  filter: HistoryFilter;
  branches: BranchList;
}

export interface HistoryRowOptions {
  dateStyle: DateStyle;
  /** Replaces the author's name for commits by `currentUserEmail`; empty to always show the name. */
  currentUserLabel: string;
  currentUserEmail?: string;
  now?: number;
}

function laneX(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2;
}

/** One row of the commit graph as an SVG drawing in pixel coordinates. */
export function renderGraphSvg(row: GraphRow): string {
  const middle = ROW_HEIGHT / 2;
  const lines = row.segments.map((segment) => {
    const [y1, y2] = segment.half === 'top' ? [0, middle] : [middle, ROW_HEIGHT];
    return `<line class="g${segment.color % GRAPH_COLORS}" x1="${laneX(segment.fromLane)}" y1="${y1}" x2="${laneX(segment.toLane)}" y2="${y2}" />`;
  });
  const dot = `<circle class="g${row.color % GRAPH_COLORS}" cx="${laneX(row.lane)}" cy="${middle}" r="4" />`;
  return `<svg class="graph" aria-hidden="true">${lines.join('')}${dot}</svg>`;
}

/**
 * Branch and tag badges. A branch HEAD points at is marked current; a HEAD
 * that points at no branch is shown on its own.
 */
export function renderRefs(refs: readonly CommitRef[]): string {
  const headIndex = refs.findIndex((ref) => ref.kind === 'head');
  const headBranch = headIndex !== -1 && refs[headIndex + 1]?.kind === 'branch' ? refs[headIndex + 1] : undefined;
  return refs
    .map((ref) => {
      if (ref.kind === 'head') {
        return headBranch ? '' : '<span class="ref ref-head" title="Detached HEAD">HEAD</span>';
      }
      const current = ref === headBranch ? ' ref-current' : '';
      const title = { branch: 'Branch', remote: 'Remote branch', tag: 'Tag' }[ref.kind] + (current ? ' (checked out)' : '');
      return `<span class="ref ref-${ref.kind}${current}" title="${title}">${escapeHtml(ref.name)}</span>`;
    })
    .join('');
}

/** Commit rows; `graph` holds one layout row per entry, or is undefined when the graph is hidden. */
export function renderHistoryRows(
  entries: readonly HistoryEntry[],
  graph: readonly GraphRow[] | undefined,
  options: HistoryRowOptions,
): string {
  return entries
    .map((entry, i) => {
      const isCurrentUser =
        options.currentUserLabel &&
        options.currentUserEmail &&
        options.currentUserEmail.toLowerCase() === entry.authorEmail.toLowerCase();
      const author = isCurrentUser ? options.currentUserLabel : entry.authorName;
      const graphCell = graph?.[i] ? `<span class="graph-cell">${renderGraphSvg(graph[i])}</span>` : '';
      return (
        `<div class="row" data-sha="${escapeHtml(entry.sha)}" tabindex="-1">` +
        graphCell +
        `<span class="summary">${renderRefs(entry.refs)}<span class="text">${escapeHtml(entry.summary)}</span></span>` +
        `<span class="author" title="${escapeHtml(`${entry.authorName} <${entry.authorEmail}>`)}">${escapeHtml(author)}</span>` +
        `<span class="date" title="${escapeHtml(formatDate(entry.authorTimestamp, 'absolute'))}">${escapeHtml(
          formatDate(entry.authorTimestamp, options.dateStyle, undefined, options.now),
        )}</span>` +
        `<span class="sha">${escapeHtml(entry.sha.slice(0, 7))}</span>` +
        `<button class="copy" title="Copy commit hash" aria-label="Copy commit hash">Copy</button>` +
        `</div>`
      );
    })
    .join('');
}

function renderScopeOptions(view: HistoryShellView): string {
  const { scope } = view.filter;
  const selected = (value: string, isSelected: boolean) =>
    `value="${escapeHtml(value)}"${isSelected ? ' selected' : ''}`;
  const current = view.branches.current ? ` (${escapeHtml(view.branches.current)})` : '';
  const refOption = (name: string) =>
    `<option ${selected(`ref:${name}`, scope.kind === 'ref' && scope.ref === name)}>${escapeHtml(name)}</option>`;
  // A ref that is not a branch, such as a tag or a commit, still needs an option to show as selected.
  const otherRef =
    scope.kind === 'ref' && !view.branches.local.includes(scope.ref) && !view.branches.remote.includes(scope.ref)
      ? refOption(scope.ref)
      : '';
  return [
    `<option ${selected('head', scope.kind === 'head')}>Current branch${current}</option>`,
    `<option ${selected('all', scope.kind === 'all')}>All branches</option>`,
    otherRef,
    view.branches.local.length ? `<optgroup label="Branches">${view.branches.local.map(refOption).join('')}</optgroup>` : '',
    view.branches.remote.length
      ? `<optgroup label="Remote branches">${view.branches.remote.map(refOption).join('')}</optgroup>`
      : '',
  ].join('');
}

/** The page around the commit rows, which the panel fills in with messages. */
export function renderHistoryShell(view: HistoryShellView, nonce: string): string {
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  const { filter } = view;
  const pathChip = filter.path
    ? `<span class="chip" title="Only commits that changed this file">File: ${escapeHtml(filter.path)}<button id="clear-path" title="Show all files" aria-label="Show all files">&times;</button></span>`
    : '';
  const graphColors = [
    'var(--vscode-charts-blue, #3794ff)',
    'var(--vscode-charts-green, #89d185)',
    'var(--vscode-charts-orange, #d18616)',
    'var(--vscode-charts-purple, #b180d7)',
    'var(--vscode-charts-red, #f14c4c)',
    'var(--vscode-charts-yellow, #cca700)',
    'var(--vscode-terminal-ansiCyan, #29b8db)',
    'var(--vscode-terminal-ansiMagenta, #bc3fbc)',
  ]
    .map((color, i) => `.g${i} { stroke: ${color}; fill: ${color}; }`)
    .join('\n  ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    padding: 0;
    margin: 0;
  }
  .toolbar {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    padding: 8px 12px;
    background: var(--vscode-editor-background);
    border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, transparent));
  }
  select, input {
    font: inherit;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    padding: 3px 6px;
  }
  select { color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); border-color: var(--vscode-dropdown-border, transparent); }
  input { width: 14em; }
  button {
    font: inherit;
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
    border: none;
    padding: 3px 10px;
    cursor: pointer;
  }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 4px 2px 8px;
    border-radius: 10px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
  }
  .chip button { padding: 0 6px; background: transparent; color: inherit; }
  #list { --graph-width: 0px; }
  .row {
    display: grid;
    grid-template-columns: var(--graph-width) minmax(0, 1fr) minmax(6em, 14em) 9em 5.5em 3.5em;
    align-items: center;
    column-gap: 8px;
    height: ${ROW_HEIGHT}px;
    padding: 0 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .row:hover { background: var(--vscode-list-hoverBackground); }
  .row.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .row:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .graph-cell { height: ${ROW_HEIGHT}px; overflow: visible; }
  .graph { width: var(--graph-width); height: ${ROW_HEIGHT}px; overflow: visible; }
  .graph line { stroke-width: 2; fill: none; }
  .graph circle { stroke: var(--vscode-editor-background); stroke-width: 1.5; }
  .row:not(:has(.graph-cell)) { grid-template-columns: minmax(0, 1fr) minmax(6em, 14em) 9em 5.5em 3.5em; }
  .summary { overflow: hidden; text-overflow: ellipsis; }
  .author, .date { overflow: hidden; text-overflow: ellipsis; color: var(--vscode-descriptionForeground); }
  .row.selected .author, .row.selected .date, .row.selected .sha { color: inherit; }
  .sha { font-family: var(--vscode-editor-font-family, monospace); color: var(--vscode-descriptionForeground); }
  .copy { visibility: hidden; padding: 0 6px; font-size: 0.9em; }
  .row:hover .copy, .row.selected .copy { visibility: visible; }
  .ref {
    display: inline-block;
    margin-right: 6px;
    padding: 0 6px;
    border-radius: 3px;
    font-size: 0.9em;
    line-height: 1.5;
    border: 1px solid var(--vscode-badge-background);
  }
  .ref-branch { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .ref-current { font-weight: bold; }
  .ref-remote { color: var(--vscode-gitDecoration-untrackedResourceForeground, var(--vscode-descriptionForeground)); }
  .ref-tag { color: var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-descriptionForeground)); border-style: dashed; }
  .ref-head { background: var(--vscode-statusBarItem-warningBackground, #c69026); color: var(--vscode-statusBarItem-warningForeground, #fff); border-color: transparent; }
  .footer { display: flex; gap: 12px; align-items: center; padding: 10px 12px; color: var(--vscode-descriptionForeground); }
  .empty { padding: 16px 12px; color: var(--vscode-descriptionForeground); }
  ${graphColors}
</style>
</head>
<body>
<div class="toolbar">
  <select id="scope" title="Which commits to list">${renderScopeOptions(view)}</select>
  <input id="search" type="search" placeholder="Search messages" value="${escapeHtml(filter.search ?? '')}" />
  <input id="author" type="search" placeholder="Author" value="${escapeHtml(filter.author ?? '')}" />
  ${pathChip}
  <button id="refresh" title="Reload the history">Refresh</button>
</div>
<div id="list" role="list"></div>
<div class="footer"><button id="more" hidden>Load more</button><span id="status">Loading…</span></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const list = document.getElementById('list');
  const more = document.getElementById('more');
  const status = document.getElementById('status');
  const scope = document.getElementById('scope');
  const search = document.getElementById('search');
  const author = document.getElementById('author');
  let path = ${JSON.stringify(filter.path ?? '').replace(/</g, '\\u003c')};
  let timer;

  function sendFilter() {
    clearTimeout(timer);
    status.textContent = 'Loading…';
    vscode.postMessage({ type: 'filter', scope: scope.value, search: search.value, author: author.value, path });
  }
  function sendFilterSoon() {
    clearTimeout(timer);
    timer = setTimeout(sendFilter, 400);
  }
  scope.addEventListener('change', sendFilter);
  for (const input of [search, author]) {
    input.addEventListener('input', sendFilterSoon);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendFilter(); });
  }
  const clearPath = document.getElementById('clear-path');
  if (clearPath) {
    clearPath.addEventListener('click', () => { path = ''; clearPath.parentElement.remove(); sendFilter(); });
  }
  document.getElementById('refresh').addEventListener('click', sendFilter);
  more.addEventListener('click', () => { more.disabled = true; vscode.postMessage({ type: 'more' }); });

  function select(row) {
    for (const r of list.querySelectorAll('.row.selected')) r.classList.remove('selected');
    row.classList.add('selected');
    row.focus();
  }
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    select(row);
    if (e.target.closest('.copy')) {
      vscode.postMessage({ type: 'copySha', sha: row.dataset.sha });
    } else {
      vscode.postMessage({ type: 'openCommit', sha: row.dataset.sha });
    }
  });
  list.addEventListener('keydown', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    const next = e.key === 'ArrowDown' ? row.nextElementSibling : e.key === 'ArrowUp' ? row.previousElementSibling : null;
    if (next && next.classList.contains('row')) { e.preventDefault(); select(next); }
    if (e.key === 'Enter') vscode.postMessage({ type: 'openCommit', sha: row.dataset.sha });
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type !== 'rows') return;
    list.style.setProperty('--graph-width', message.graphLanes * ${LANE_WIDTH} + 'px');
    if (message.append) {
      list.insertAdjacentHTML('beforeend', message.html);
    } else {
      list.innerHTML = message.html;
      if (!message.html) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = message.emptyText;
        list.appendChild(empty);
      }
      window.scrollTo(0, 0);
    }
    more.hidden = !message.hasMore;
    more.disabled = false;
    status.textContent = message.status;
  });
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
