# Git Blame Solo

[![CI](https://github.com/SeniorTurkmen/gitblamesolo-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/SeniorTurkmen/gitblamesolo-extension/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.90.0-007ACC.svg)](https://code.visualstudio.com/)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

**Git Blame Solo answers "who changed this line, when, and why?" without making you leave the editor.**

Move your cursor to any line and a quiet annotation at the end of it shows the author, how long ago it changed, and the commit message. Hover the line to see the full commit and the exact change it introduced. One more click gives you every file in that commit with colored diffs, and you can revert a single hunk from there if you need to.

It does one thing, stays out of the way, and has no dependencies beyond the `git` you already have installed.

![Git Blame Solo overview](docs/images/overview.png)

---

## Table of contents

- [Features](#features)
  - [Inline blame on the current line](#inline-blame-on-the-current-line)
  - [Uncommitted changes, even before you save](#uncommitted-changes-even-before-you-save)
  - [Rich hover: the commit and what it changed](#rich-hover-the-commit-and-what-it-changed)
  - [Native diff editor](#native-diff-editor)
  - [Commit details panel](#commit-details-panel)
  - [Revert a single hunk](#revert-a-single-hunk)
  - [Commands](#commands)
- [Requirements](#requirements)
- [Settings](#settings)
- [Known limitations](#known-limitations)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

---

## Features

### Inline blame on the current line

As your cursor moves, a faded annotation appears at the end of the active line:

```
Jane Doe, 3 days ago • Fix race condition in session refresh
```

- Only the **active line** is annotated, so the rest of your code stays uncluttered.
- Recomputation is **debounced** (150 ms by default), so scrolling or holding an arrow key doesn't spawn a flood of `git` processes.
- The whole file is blamed **once per document** and cached, so moving between lines never runs `git` again. Edits shift the cached result instead of discarding it, and saving re-blames the file.
- The format is fully customizable through a template. See [`gitBlameSolo.decorationTemplate`](#settings).
- Your own commits read as **"You"** instead of your name.
- Prefer the status bar? Turn on [`gitBlameSolo.statusBar.enabled`](#settings), and optionally turn off `gitBlameSolo.enabled`.
- Commits listed in a **`.git-blame-ignore-revs`** file at the repository root, such as bulk reformatting, are skipped automatically, as GitHub does.

![Inline blame annotation at the end of the current line](docs/images/inline-blame.png)

### Uncommitted changes, even before you save

When a line hasn't been committed yet, the annotation says **"Uncommitted changes"** along with when the file was last modified.

Blame is computed against the **live editor buffer**: the extension pipes the buffer's contents to `git blame --contents -`. Lines you just typed are flagged correctly **before you save**, and line numbers never drift out of sync with what's on disk.

### Rich hover: the commit and what it changed

Hover the inline annotation at the end of the current line to open a popup containing:

| Section | What you see |
| --- | --- |
| **Header** | Commit subject, author (with email), absolute date, and short hash |
| **Body** | The full commit message body, if there is one |
| **What changed** | A colored `diff` of the **entire changed block** the line belongs to (every contiguous line changed in the same hunk, not only the hovered line), with an added/removed line count |
| **Actions** | **Open in Diff Editor**, **View changed files (N files)**, and **Open on GitHub** (or GitLab, Bitbucket, Azure DevOps) when the repository has a remote |

This shows you the context of a change right away: you see the rest of the block that changed with the line, not just the one line in isolation.

By default the popup only opens over the annotation, so hovering your code for other tooltips (types, errors, docs) isn't crowded by blame. To get it anywhere on any line instead, set [`gitBlameSolo.hover.trigger`](#settings) to `"line"`.

![Hover popup with commit details and the changed block](docs/images/hover.png)

### Native diff editor

**Open in Diff Editor** in the hover opens the file in VS Code's built-in side-by-side diff editor, comparing the commit (`<sha>`) against its parent (`<sha>^`). Syntax highlighting, inline/side-by-side toggling, and navigating between changes all work as usual.

![Native VS Code diff editor opened from the hover](docs/images/diff-editor.png)

### Commit details panel

**View changed files** in the hover (or the **Git Blame Solo: Show Commit Details** command) opens a panel with the whole commit:

- The commit message, author, date, and hash at the top.
- **Every file the commit touched**, each with its **full colored diff**. Added and removed lines are clearly marked.
- Click a **file header** to open that file in the editor.
- The **Open Diff** button opens that file's change in the native diff editor.
- **The line you started from is highlighted** inside its file's diff, so you don't lose your place in a large commit. Clicking the highlighted line takes you back to that spot in the editor.

![Commit details panel listing every changed file with diffs](docs/images/commit-panel.png)

### Revert a single hunk

Each hunk in the panel has a **Revert Hunk** button. It undoes **only that hunk** in your working copy using `git apply --reverse` and leaves the rest of the commit alone.

Several safeguards are built in:

1. **Unsaved changes block the revert.** If the file has unsaved edits, you're asked to save or discard them first.
2. **Always asks first.** A modal dialog shows exactly which lines will be affected before anything changes.
3. **Fails safely.** If the file has changed since that commit and the hunk no longer applies cleanly, the file is **left untouched** and you get a clear error message.

After a successful revert, the button changes to **Reverted**, and a notification offers to open the file.

![Revert Hunk confirmation dialog](docs/images/revert-hunk.png)

### Commands

Open the Command Palette (<kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>) and type **Git Blame Solo**:

| Command | Description |
| --- | --- |
| `Git Blame Solo: Toggle Inline Blame` | Turns the end-of-line annotation on or off (saved to your user settings). |
| `Git Blame Solo: Show Commit Details` | Opens the commit details panel for the line under the cursor. Also available from the editor's right-click menu. |
| `Git Blame Solo: Copy Commit Hash` | Copies the full hash of the commit that last changed the current line to the clipboard. |
| `Git Blame Solo: Open Commit on Remote` | Opens the commit that last changed the current line on GitHub, GitLab, Bitbucket, or Azure DevOps. |
| `Git Blame Solo: Refresh` | Re-reads everything cached from git: blame, repository roots, the remote URL, and your `user.email`. Use it after changing your git config or remotes. |
| `Git Blame Solo: Hide Author Email` / `Show Author Email` | Hides or shows the author's email in the hover (saved to your user settings). Only the one that applies is listed. |

None of the commands has a default shortcut. To add one, open **Keyboard Shortcuts** (<kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>K</kbd> <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>S</kbd>) and search for **Git Blame Solo**.

---

## Requirements

- VS Code **1.90** or later.
- `git` available on your `PATH`. If it isn't, the extension shows a one-time warning and turns off blame and hover.
- The file must be inside a git repository. Files outside a repository are ignored.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `gitBlameSolo.enabled` | `true` | Show the inline blame annotation for the current line. |
| `gitBlameSolo.dateStyle` | `"relative"` | `"relative"` (e.g. *3 days ago*) or `"absolute"` date formatting in the annotation and hover. |
| `gitBlameSolo.decorationTemplate` | `"${author}, ${date} • ${message}"` | Template for the inline annotation. Placeholders: `${author}` `${date}` `${message}` `${hash}`. |
| `gitBlameSolo.decorationColor` | `""` | Theme color id (e.g. `editorLineNumber.foreground`) or hex color (e.g. `#888888`). Empty uses `editorCodeLens.foreground`. |
| `gitBlameSolo.debounceMs` | `150` | Milliseconds to wait after the cursor stops moving before recomputing blame. |
| `gitBlameSolo.hover.enabled` | `true` | Show full commit details on hover. |
| `gitBlameSolo.hover.trigger` | `"annotation"` | `"annotation"` shows the hover only over the inline annotation at the end of the current line (needs `gitBlameSolo.enabled`). `"line"` shows it anywhere on any line. |
| `gitBlameSolo.maxFileSizeKB` | `5000` | Files larger than this are skipped for performance. |
| `gitBlameSolo.uncommittedLabel` | `"Uncommitted changes"` | Label shown for lines that haven't been committed yet. |
| `gitBlameSolo.currentUserLabel` | `"You"` | Shown instead of the author's name in the annotation and status bar when the author's email matches your `git config user.email`. Empty always shows the name. |
| `gitBlameSolo.showAuthorEmail` | `true` | Show the author's email next to their name in the hover. Also toggled by the **Show/Hide Author Email** commands. The inline annotation and status bar never show it; the commit details panel always does. |
| `gitBlameSolo.statusBar.enabled` | `false` | Show blame for the current line in the status bar. Clicking it opens the commit details panel. |
| `gitBlameSolo.statusBar.template` | `"${author}, ${date}"` | Template for the status bar item. Same placeholders as `decorationTemplate`. |
| `gitBlameSolo.ignoreWhitespace` | `false` | Ignore whitespace-only changes when finding who last changed a line (`git blame -w`). |
| `gitBlameSolo.detectMovedLines` | `"off"` | `"withinFile"` follows lines moved or copied within the file (`-M`). `"acrossFiles"` also follows lines moved from other files changed in the same commit (`-C`); slower on large repositories. |
| `gitBlameSolo.ignoreRevsFile` | `".git-blame-ignore-revs"` | File at the repository root listing commits to skip, such as bulk reformatting (`--ignore-revs-file`). Skipped when the file doesn't exist; empty disables it. |
| `gitBlameSolo.exclude` | `[]` | Glob patterns for files that get no annotation, status bar entry, or hover, for example `"**/*.min.js"`. |

For example, to show the short hash first with an absolute date:

```jsonc
{
  "gitBlameSolo.decorationTemplate": "${hash} · ${author} · ${date}",
  "gitBlameSolo.dateStyle": "absolute"
}
```

## Known limitations

- The timestamp shown for uncommitted lines is the file's **last save time on disk** (`mtime`), not the time of each individual keystroke.
- Between saves, any line you edit reads as uncommitted, even if you change it back to its committed text. Saving the file corrects it.
- The remote URL and your `user.email` are read once per repository. After changing them with `git config` or `git remote`, run **Git Blame Solo: Refresh**.
- Files larger than `gitBlameSolo.maxFileSizeKB` are skipped.
- Only local files (`file:` scheme) are supported. Virtual or remote file systems aren't blamed.

---

## Development

```bash
npm install
npm run watch     # esbuild watch mode
```

Press <kbd>F5</kbd> to launch the **Run Extension** configuration and try the extension in an Extension Development Host.

### Project layout

```
src/
├── extension.ts        # activation, command registration
├── config.ts           # typed access to gitBlameSolo.* settings
├── git/                # thin wrappers around the git CLI + output parsers
├── cache/              # per-document / per-commit caches
├── decorations/        # end-of-line annotation
├── hover/              # hover provider
├── webview/            # commit details panel
└── util/               # date formatting, diff rendering
```

### Testing

```bash
npm run typecheck   # full type-check via tsc --noEmit
npm run test:unit   # pure function tests (parsers, caches, date formatting)
npm test            # end-to-end integration tests in an Extension Development Host
```

### Packaging

```bash
npm run package
npx vsce package --no-dependencies
```

### Publishing to Open VSX

A published GitHub release runs [`.github/workflows/publish.yml`](.github/workflows/publish.yml), which publishes the extension with [trusted publishing](https://github.com/eclipse-openvsx/openvsx/blob/master/cli/README.md#trusted-publishing). No access token is stored in the repo.

Creating the `SeniorTurkmen` namespace makes you a contributor, not an owner. The [Trusted publishers](https://open-vsx.org/user-settings/trusted-publishers) page only lists namespaces you own, so it stays empty until ownership is granted.

Until then, publish with an access token:

1. Create a token at [Access tokens](https://open-vsx.org/user-settings/tokens).
2. Add it to this repo as the Actions secret `OVSX_PAT`.
3. Run **Publish to Open VSX** from the Actions tab. The workflow uses that secret when it is set.

After you [claim the namespace](https://github.com/EclipseFdn/open-vsx.org/issues/new/choose) and Eclipse grants it, the Trusted publishers page lists `SeniorTurkmen`. Add this repository there with workflow file `publish.yml` and no environment, then remove `OVSX_PAT`. Later releases publish with the workflow's OIDC token and no stored secret.

## Contributing

Contributions are welcome! Bug reports, feature requests, and pull requests are all appreciated.

Before opening a PR, please make sure these all pass:

```bash
npm run typecheck
npm run lint
npm run test:unit
```

If you're changing anything under `src/git/`, `src/cache/`, or `src/util/`, add or update a unit test alongside it. Those modules are plain Node/TypeScript with no `vscode` dependency, so they run instantly under `npm run test:unit`. Anything under `src/decorations/`, `src/hover/`, `src/webview/`, or `src/extension.ts` needs `vscode` and is covered by `npm test` (Extension Development Host) or manual testing via <kbd>F5</kbd>.

## License

[MIT](LICENSE)
