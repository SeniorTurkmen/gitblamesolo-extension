# Git Blame Solo

[![CI](https://github.com/SeniorTurkmen/gitblamesolo-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/SeniorTurkmen/gitblamesolo-extension/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.90.0-007ACC.svg)](https://code.visualstudio.com/)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

Shows who last changed the current line — author, date, commit message — right at the end of the line. If the line hasn't been committed yet, it shows "Uncommitted changes" and when the file was last saved. Hover over any line to see the full commit details (hash, author, date, full message) in a popup.

## Features

- Inline blame annotation at the end of the active line (similar to GitLens's "current line blame").
- Hovering any line shows full commit details plus a "What changed" diff of the **entire changed block** the line belongs to — not just that one line, but every contiguous line changed in the same hunk — with an added/removed line-count summary.
- An **"Open in Diff Editor"** link in the hover opens the change in VS Code's real, native diff editor (comparing the commit against its parent).
- The hover's **"View changed files"** link opens a panel listing every file the commit touched, each with its **full colored diff** (added/removed lines clearly marked). Clicking a file's header opens it in the editor; an **"Open Diff"** button opens the same native diff editor per file. The panel also marks the exact line you opened it from directly inside that file's diff, and clicking it jumps back to that spot.
- A **"Revert Hunk"** button next to each hunk in the panel undoes just that hunk in the current working copy via `git apply --reverse`. It's blocked if the file has unsaved changes, always asks for confirmation first, and leaves the file untouched with a clear error if the hunk no longer matches the file's current content.
- Uncommitted changes are computed by diffing the live editor buffer against git history (`git blame --contents -`), so lines you haven't saved yet are already flagged correctly.
- Commands: `Git Blame Solo: Toggle Inline Blame`, `Show Commit Details`, `Copy Commit Hash`.

## Known limitation

The timestamp shown for uncommitted lines is based on the file's last save time on disk (`mtime`), not on every individual keystroke.

## Development

```bash
npm install
npm run watch     # esbuild watch mode
```

Press `F5` to launch the "Run Extension" configuration and try it out in an Extension Development Host.

## Testing

```bash
npm run typecheck   # full type-check via tsc --noEmit
npm run test:unit   # pure function tests (parser, cache, date formatting) — 23 passing
npm test            # end-to-end integration tests in an Extension Development Host
```

## Packaging

```bash
npm run package
npx vsce package
```

## Contributing

Contributions are welcome! Bug reports, feature requests, and pull requests are all appreciated.

Before opening a PR, please make sure:

```bash
npm run typecheck
npm run lint
npm run test:unit
```

all pass. If you're changing anything under `src/git/`, `src/cache/`, or `src/util/`, add or update a unit test alongside it — those modules are plain Node/TypeScript with no `vscode` dependency, so they run instantly under `npm run test:unit`. Anything under `src/decorations/`, `src/hover/`, `src/webview/`, or `src/extension.ts` needs `vscode` and is covered by `npm test` (Extension Development Host) or manual testing via `F5`.

## License

[MIT](LICENSE)
