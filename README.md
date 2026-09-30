# Git Blame Solo

[![CI](https://github.com/SeniorTurkmen/gitblamesolo-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/SeniorTurkmen/gitblamesolo-extension/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.90.0-007ACC.svg)](https://code.visualstudio.com/)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

**Git Blame Solo answers "who changed this line, when, and why?" and shows how the code got there, without making you leave the editor.**

Move your cursor to any line and a quiet annotation at the end of it shows the author, how long ago it changed, and the commit message. Hover the line to see the full commit and the exact change it introduced. One more click gives you every file in that commit with colored diffs, and you can revert a single hunk from there if you need to.

For the bigger picture, the git log shows the repository's commits with a branch graph, and a file's history lists every commit that changed it. It stays out of the way and has no dependencies beyond the `git` you already have installed.

![Git Blame Solo overview](docs/images/overview.png)

---

## Table of contents

- [Features](#features)
  - [Inline blame on the current line](#inline-blame-on-the-current-line)
  - [File blame](#file-blame)
  - [Uncommitted changes, even before you save](#uncommitted-changes-even-before-you-save)
  - [Rich hover: the commit and what it changed](#rich-hover-the-commit-and-what-it-changed)
  - [Native diff editor](#native-diff-editor)
  - [Commit details panel](#commit-details-panel)
  - [Git log and file history](#git-log-and-file-history)
  - [Author history](#author-history)
  - [Previous versions of a file](#previous-versions-of-a-file)
  - [Compare branches, tags, and commits](#compare-branches-tags-and-commits)
  - [Line history](#line-history)
  - [Step back through a line's history](#step-back-through-a-lines-history)
  - [Revert a single hunk](#revert-a-single-hunk)
  - [Commands](#commands)
- [Requirements](#requirements)
- [Installation](#installation)
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

- Only the **active line** is annotated, so the rest of your code stays uncluttered. To see every line's blame at once, turn on [file blame](#file-blame).
- Recomputation is **debounced** (150 ms by default), so scrolling or holding an arrow key doesn't spawn a flood of `git` processes.
- The whole file is blamed **once per document** and cached, so moving between lines never runs `git` again. Edits shift the cached result instead of discarding it, and the file is blamed again once you pause typing or save.
- The format is fully customizable through a template. See [`gitBlameSolo.decorationTemplate`](#settings).
- Your own commits read as **"You"** instead of your name.
- Dates follow **your region's conventions**: *vor 3 Tagen*, *3 gün önce*, *22.09.2026, 14:39*. By default they follow your operating system's region settings; set [`gitBlameSolo.dateLocale`](#settings) to `vscode` for VS Code's display language, or to a tag such as `en-GB`. The `iso` [date style](#settings) shows *2026-09-22 14:39* everywhere.
- Prefer the status bar? Turn on [`gitBlameSolo.statusBar.enabled`](#settings), and optionally turn off `gitBlameSolo.enabled`.
- Turn on [`gitBlameSolo.renderEmoji`](#settings) to show shortcodes such as `:sparkles:` and `:bug:` in commit messages as the [gitmoji](https://gitmoji.dev) they stand for: ✨ and 🐛, in the annotation, hover, git log, and commit details.
- Turn on [`gitBlameSolo.highlightCommitLines`](#settings) to **highlight every other line of the file from the same commit** as the current line, with marks in the scroll bar, so you see the whole change at a glance. The colors are the `gitBlameSolo.commitLinesBackground` and `gitBlameSolo.commitLinesOverviewRuler` theme colors.
- Commits listed in a **`.git-blame-ignore-revs`** file at the repository root, such as bulk reformatting, are skipped automatically, as GitHub does.

![Inline blame annotation at the end of the current line](docs/images/inline-blame.png)

With `gitBlameSolo.highlightCommitLines` on, moving between lines shows which other lines each commit changed:

![Clicking through lines from different commits; each time, the other lines of the same commit are highlighted and marked in the scroll bar](docs/images/commit-lines.gif)

### File blame

Turn on `gitBlameSolo.fileBlame.enabled`, or run **Git Blame Solo: Toggle File Blame** (also a button in the editor title bar), to show blame for every line of the file in a column before the text:

```
Jane Doe, 3 days ago    export function refresh() {
                          const session = load();
John Roe, 2 years ago     if (!session) {
```

- Only the first line of each block of lines from the same commit is labelled, so the blocks stand out. The column is formatted with [`gitBlameSolo.fileBlame.template`](#settings) and cut at 50 characters.
- A **heatmap** tints the column by how recent each line's commit is among the file's commits, from blue for the oldest to orange for the newest and uncommitted lines. Turn it off with `gitBlameSolo.fileBlame.heatmap`.
- Hovering the column shows the same hover as the inline annotation, for any line.
- It uses the same cached whole-file blame as the inline annotation, so it runs no extra `git` commands.

File blame is off by default.

### Uncommitted changes, even before you save

When a line hasn't been committed yet, the annotation says **"Uncommitted changes"**. Git keeps no time for uncommitted lines, so the annotation adds when the file was last saved (*file saved 3 days ago*), or *(file not saved)* while the file has unsaved changes.

Blame is computed against the **live editor buffer**: the extension pipes the buffer's contents to `git blame --contents -`. Lines you just typed are flagged correctly **before you save**, and line numbers never drift out of sync with what's on disk.

While you type, edited lines read as uncommitted right away without running `git`. About a second after you stop typing, the buffer is blamed again, so a line you changed back to its committed text shows its commit again without saving.

Hovering an uncommitted line shows how many lines changed since the last commit, unsaved edits included. **Show change inline** opens VS Code's change peek at that line, with the committed lines above your version, and **Open in Diff Editor** compares the whole file with its last commit.

### Rich hover: the commit and what it changed

Hover the inline annotation at the end of the current line to open a popup containing:

| Section | What you see |
| --- | --- |
| **Header** | Commit subject, author (with email), absolute date, and short hash with a button that copies the full hash, and **Copy message** for the full commit message. With [`gitBlameSolo.showUnpushed`](#settings) on, commits no remote branch contains yet are marked **Not pushed yet**. Click the author to see all of their commits in the [git log](#git-log-and-file-history) |
| **Co-authors** | Everyone credited with a `Co-authored-by:` trailer, if any |
| **Body** | The full commit message body, if there is one, without the co-author trailers |
| **What changed** | A colored `diff` of the **entire changed block** the line belongs to (every contiguous changed line, not only the hovered line) with up to three unchanged lines around it, and an added/removed line count. Other changes a few lines away are left out, so the block reads on its own |
| **Actions** | **Open in Diff Editor** (at the line), **View changed files (N files)**, **Line history**, **Blame previous revision** when the line existed before the commit, and **Open on GitHub** (or GitLab, Bitbucket, Azure DevOps) when the repository has a remote, plus **PR #N** (**MR !N** on GitLab) when the commit message names the pull request it came from |

This shows you the context of a change right away: you see the rest of the block that changed with the line, not just the one line in isolation.

By default the popup only opens over the annotation, so hovering your code for other tooltips (types, errors, docs) isn't crowded by blame. To get it anywhere on any line instead, set [`gitBlameSolo.hover.trigger`](#settings) to `"line"`.

![Hover popup with commit details and the changed block](docs/images/hover.png)

### Native diff editor

**Open in Diff Editor** in the hover opens the file in VS Code's built-in side-by-side diff editor, comparing the commit (`<sha>`) against its parent (`<sha>^`). Syntax highlighting, inline/side-by-side toggling, and navigating between changes all work as usual.

![Native VS Code diff editor opened from the hover](docs/images/diff-editor.png)

### Commit details panel

**View changed files** in the hover (or the **Git Blame Solo: Show Commit Details** command) opens a panel with the whole commit:

- The commit message, author, co-authors, date, and hash at the top. The button next to the hash copies it.
- **Every file the commit touched**, each with its **full colored diff**. Added and removed lines are clearly marked.
- Click a **file header** to open that file in the editor. The arrow at its start folds or unfolds the file's diff, and **Collapse all** / **Expand all** fold every file at once.
- The **Open Diff** button opens that file's change in the native diff editor.
- **The line you started from is highlighted** inside its file's diff, so you don't lose your place in a large commit. Clicking the highlighted line takes you back to that spot in the editor.
- **The file you came from is marked** with a colored border and an "Opened from this file" badge, and the panel scrolls to it. The commit's other files start folded, so that file stands out. This works from the blame hover and from a file's history, even if the file had another name in that commit.

![Commit details panel listing every changed file with diffs](docs/images/commit-panel.png)

![Commit details opened from a file's history: the other files are folded and the file you came from is outlined with an "Opened from this file" badge](docs/images/commit-details-focus.png)

### Git log and file history

**Git Blame Solo: Show Git Log** (also the commit icon in the Source Control view's title bar) opens a panel listing the repository's commits, newest first, with a **commit graph** showing how branches split and merge. Branches, remote branches, and tags are shown as badges on their commits, and the checked-out branch is highlighted.

![Git log panel with the commit graph, branch and tag badges, authors, dates, and hashes](docs/images/git-log.png)

- **Pick which history to show:** the current branch, all branches (including remote branches and tags), or any single local or remote branch.
- **Search** commit messages and **filter by author** (name or email). Both match the text as typed, ignoring case. Click an author in the list to show only their commits.
- **File history:** **Git Blame Solo: Show File History** (the history icon in the editor title bar, or the right-click menu of a file in the Explorer, an editor tab, or the Source Control view) shows only the commits that changed that file, following renames. Clear the file chip in the toolbar to see every commit again. A commit opened from a file's history marks that file in the commit details panel.
- **Click a commit** (or press <kbd>Enter</kbd> on it) to open the commit details panel with its diffs. The button next to the hash copies it. Use the arrow keys to move between commits.
- With [`gitBlameSolo.showUnpushed`](#settings) on, commits on the current branch that no remote branch contains yet get a **not pushed** badge.
- Commits load 200 at a time; **Load more** fetches the next page.

The graph is hidden while a search, author, or file filter is on, because the filtered list leaves out the commits the lines would pass through.

![Searching commit messages in the git log, then switching from all branches to one branch](docs/images/git-log.gif)

Opening a commit from a file's history takes you straight to that file in the commit details panel, with the commit's other files folded:

![File history of one file; clicking a commit opens its details with that file marked and the other files folded, then Expand all and Collapse all](docs/images/file-history.gif)

### Author history

**Git Blame Solo: Show Author History**, or a click on the author in the blame hover, opens the git log of every branch filtered to that author's commits. In the git log, clicking an author's name does the same. The filter uses the author's email, so every spelling of their name is included.

![Hovering the inline blame, clicking the author's name, and getting the git log filtered to their commits](docs/images/author-history.gif)

### Previous versions of a file

In a file's history, hover a commit for two more buttons:

- **Open** opens the file as it was in that commit, read-only, with blame and the hover working there too.
- **Compare** opens that version in the diff editor against your working copy.

Both follow renames, so a commit from before the file was renamed opens under its old name. **Git Blame Solo: Open File at Revision…** and **Compare with Revision…** do the same from a list of the file's commits; they are in the editor title bar's **…** menu and the right-click menus of files in the Explorer and editor tabs.

![File history: Open shows the file as it was in a commit, and Compare diffs another commit's version against the working copy](docs/images/file-revisions.gif)

### Compare branches, tags, and commits

**Git Blame Solo: Compare Branches, Tags, or Commits…** (also the compare button in the Source Control view's title bar) compares two branches, tags, or commits, or one of them with your working copy:

- Pick each side from your branches, remote branches, and tags, or type a commit hash or an expression such as `HEAD~3`.
- Every file that differs opens in one multi-diff editor, with renames detected.
- In the git log, **Compare…** on a commit starts the comparison from that commit.
- **Compare File Between Revisions…** diffs one file between two of the commits that changed it.

![Comparing the v0.2.0 tag with the working copy: every changed file opens in one multi-diff editor](docs/images/compare.gif)

### Line history

**Line history** in the hover (or the **Git Blame Solo: Show Line History** command) lists every commit that changed the current line, newest first, using `git log -L`. The line is followed across edits and renames, and the list works for unsaved edits and past revisions too.

Type to filter by message, author, or hash. Pick a commit to open its change to the file in the diff editor, at the line. The buttons on each entry open the commit details panel or copy the commit hash. The list shows up to 100 commits.

### Step back through a line's history

**Blame previous revision** in the hover (or the **Git Blame Solo: Blame Previous Revision** command) opens the file as it was just before the commit that last changed the line, side by side with its current version in the diff editor, with the cursor on the matching line on both sides. The past revision on the left has inline blame and the hover too, so you can keep stepping back to see who wrote the line before, and why, until you reach the commit that created it. Each step still compares with the current file, and renames are followed along the way.

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
| `Git Blame Solo: Change Setting…` | Lists every Git Blame Solo setting with its current value. Pick one to change it: on/off and fixed choices from a list, text and numbers in an input box, and exclude patterns added or removed one at a time. Every setting can also be reset to its default. |
| `Git Blame Solo: Toggle Inline Blame` | Turns the end-of-line annotation on or off (saved to your user settings). |
| `Git Blame Solo: Toggle File Blame` | Turns the file blame column on or off (saved to your user settings). |
| `Git Blame Solo: Show Commit Details` | Opens the commit details panel for the line under the cursor. Also available from the editor's right-click menu. |
| `Git Blame Solo: Copy Commit Hash` | Copies the full hash of the commit that last changed the current line to the clipboard. |
| `Git Blame Solo: Copy Commit Message` | Copies the full message of the commit that last changed the current line to the clipboard. |
| `Git Blame Solo: Show Git Log` | Opens the git log with the commit graph for the repository of the active file (or one you pick). |
| `Git Blame Solo: Show File History` | Opens the git log filtered to the commits that changed the active file. |
| `Git Blame Solo: Open File at Revision…` | Lists the commits that changed the active file; opens the file as it was in the one you pick. |
| `Git Blame Solo: Compare with Revision…` | Lists the commits that changed the active file; compares its version in the one you pick with your working copy. |
| `Git Blame Solo: Compare Branches, Tags, or Commits…` | Compares two branches, tags, or commits, or one with your working copy, in a multi-diff editor. |
| `Git Blame Solo: Compare File Between Revisions…` | Diffs the active file between two of the commits that changed it. |
| `Git Blame Solo: Show Author History` | Opens the git log of every branch, filtered to the commits by the author of the current line. |
| `Git Blame Solo: Show Line History` | Lists every commit that changed the current line. Picking one opens its change in the diff editor. |
| `Git Blame Solo: Blame Previous Revision` | Compares the file as it was before the commit that last changed the current line with its current version, at that line. |
| `Git Blame Solo: Open Commit on Remote` | Opens the commit that last changed the current line on GitHub, GitLab, Bitbucket, or Azure DevOps. |
| `Git Blame Solo: Refresh` | Re-reads everything cached from git: blame, repository roots, the remote URL, and your `user.email`. Rarely needed: changes to the repository's and your global git config are picked up automatically. |
| `Git Blame Solo: Hide Author Email` / `Show Author Email` | Hides or shows the author's email in the hover (saved to your user settings). Only the one that applies is listed. |

None of the commands has a default shortcut. To add one, open **Keyboard Shortcuts** (<kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>K</kbd> <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>S</kbd>) and search for **Git Blame Solo**.

---

## Requirements

- VS Code **1.90** or later.
- `git` available on your `PATH`. If it isn't, the extension shows a one-time warning and turns off blame and hover.
- The file must be inside a git repository. Files outside a repository are ignored.

## Installation

Search for **Git Blame Solo** in the Extensions view, or run:

```bash
code --install-extension SeniorTurkmen.gitblamesolo
```

It is published to the Visual Studio Marketplace and to Open VSX.

## Settings

Every setting below can also be changed from the Command Palette with **Git Blame Solo: Change Setting…**. It lists each setting with its current value; pick one to toggle it, choose from its values, or type a new one. The change applies right away:

![Git Blame Solo: Change Setting… lists every setting with its current value; switching Date Style from relative to absolute updates the inline annotation at once](docs/images/change-setting.gif)

| Setting | Default | Description |
| --- | --- | --- |
| `gitBlameSolo.enabled` | `true` | Show the inline blame annotation for the current line. |
| `gitBlameSolo.dateStyle` | `"relative"` | `"relative"` (e.g. *3 days ago*), `"absolute"` (the date locale's format, e.g. *22.09.2026, 14:39* in German), or `"iso"` (*2026-09-22 14:39* everywhere). Hovers and tooltips always show the exact date. |
| `gitBlameSolo.dateLocale` | `"system"` | Whose date conventions to follow: `"system"` for your operating system's region settings, `"vscode"` for VS Code's display language, or a tag such as `en-GB`, `de-DE`, or `tr-TR`. |
| `gitBlameSolo.decorationTemplate` | `"${author}, ${date} • ${message}"` | Template for the inline annotation. Placeholders: `${author}` `${date}` `${message}` `${hash}`. |
| `gitBlameSolo.decorationColor` | `""` | Theme color id (e.g. `editorLineNumber.foreground`) or hex color (e.g. `#888888`). Empty uses `editorCodeLens.foreground`. |
| `gitBlameSolo.debounceMs` | `150` | Milliseconds to wait after the cursor stops moving before recomputing blame. |
| `gitBlameSolo.hover.enabled` | `true` | Show full commit details on hover. |
| `gitBlameSolo.hover.trigger` | `"annotation"` | `"annotation"` shows the hover only over the inline annotation at the end of the current line (needs `gitBlameSolo.enabled`) and over the file blame column. `"line"` shows it anywhere on any line. |
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
| `gitBlameSolo.fileBlame.enabled` | `false` | Show blame for every line of the file in a column before the text. Also toggled by **Git Blame Solo: Toggle File Blame**. |
| `gitBlameSolo.fileBlame.template` | `"${author}, ${date}"` | Template for the file blame column. Same placeholders as `decorationTemplate`. |
| `gitBlameSolo.fileBlame.heatmap` | `true` | Tint the file blame column by how recent each line's commit is, from blue (oldest) to orange (newest). |
| `gitBlameSolo.renderEmoji` | `false` | Show emoji shortcodes in commit messages, such as `:sparkles:` from gitmoji, as the emoji they stand for. |
| `gitBlameSolo.showUnpushed` | `false` | Mark commits that no remote branch contains yet as not pushed, in the hover and the git log. Repositories without remotes are not marked. |
| `gitBlameSolo.highlightCommitLines` | `false` | Highlight the other lines of the file from the current line's commit, with marks in the scroll bar. |
| `gitBlameSolo.editorTitleButtons` | `true` | Show the **File History** and **Toggle File Blame** buttons in the editor title bar. |

For example, to show the short hash first with an absolute date:

```jsonc
{
  "gitBlameSolo.decorationTemplate": "${hash} · ${author} · ${date}",
  "gitBlameSolo.dateStyle": "absolute"
}
```

## Known limitations

- The time shown for uncommitted lines is when the file was last saved, not when that line changed. While the file has unsaved changes, no time is shown.
- The remote URL and your `user.email` are re-read when the repository's config file or your global git config (`~/.gitconfig`, `~/.config/git/config`, or `$GIT_CONFIG_GLOBAL`) changes. Changes elsewhere, such as the system config or a file pulled in with `include`, need **Git Blame Solo: Refresh**.
- Files larger than `gitBlameSolo.maxFileSizeKB` are skipped.
- Only local files and the past revisions this extension opens are blamed. Other virtual or remote file systems aren't.

---

## Development

Requires Node.js 22 or later.

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
├── webview/            # commit details and git log panels
└── util/               # date formatting, diff rendering, commit graph layout
```

### Testing

```bash
npm run typecheck   # full type-check via tsc --noEmit
npm run test:unit   # pure function tests (parsers, caches, date formatting)
npm test            # end-to-end integration tests in an Extension Development Host
```

### Packaging

```bash
npx vsce package --no-dependencies   # builds dist/ via vscode:prepublish
```

### Publishing

Publishing a GitHub release runs [`.github/workflows/publish.yml`](.github/workflows/publish.yml). The release tag must match the `package.json` version, for example `v0.1.1`. The workflow:

1. Packages the extension once into a `.vsix`.
2. Publishes that same package to the Visual Studio Marketplace and to Open VSX, in separate jobs, so a failure in one doesn't block the other.
3. Attaches the `.vsix` to the GitHub release.

To publish the current `package.json` version without a new release, or to retry a single store, run **Publish** from the Actions tab and pick `both`, `marketplace`, or `openvsx`.

#### Visual Studio Marketplace

The Marketplace job signs in to Microsoft Entra ID as a user-assigned managed identity, using the workflow's GitHub OIDC token, and publishes with `vsce publish --azure-credential`. No Marketplace token is stored, so the [retirement of global Azure DevOps PATs](https://aka.ms/GlobalPATDeprecation) doesn't affect it. One-time setup:

1. **Managed identity.** In the [Azure portal](https://portal.azure.com), create a **User Assigned Managed Identity** in any subscription (a free one works). Note its **Client ID**, and the **Tenant ID** of your directory.
2. **Federated credential.** On the identity, open **Settings → Federated credentials → Add credential**, pick **GitHub Actions deploying Azure resources**, and enter organization `SeniorTurkmen`, repository `gitblamesolo-extension`, entity **Environment**, environment `marketplace`.
3. **GitHub.** In this repository's settings, create the environment `marketplace`, and add the Actions **variables** (not secrets) `AZURE_CLIENT_ID` and `AZURE_TENANT_ID`.
4. **Member ID.** Run **Publish** from the Actions tab with target `marketplace-identity`. The run summary shows the ID the Marketplace knows the identity by.
5. **Publisher.** On the [Marketplace publisher management page](https://marketplace.visualstudio.com/manage), create the publisher `SeniorTurkmen` if it doesn't exist yet (the ID must match `publisher` in `package.json`). Under **Members**, add the ID from step 4 with the **Contributor** role.

After that, releases publish to the Marketplace automatically. To publish the current version on its own, run **Publish** with target `marketplace`.

#### Open VSX

The Open VSX job publishes with [trusted publishing](https://github.com/eclipse-openvsx/openvsx/blob/master/cli/README.md#trusted-publishing), so no access token is stored in the repo.

Creating the `SeniorTurkmen` namespace makes you a contributor, not an owner. The [Trusted publishers](https://open-vsx.org/user-settings/trusted-publishers) page only lists namespaces you own, so it stays empty until ownership is granted.

Until then, publish with an access token:

1. Create a token at [Access tokens](https://open-vsx.org/user-settings/tokens).
2. Add it to this repo as the Actions secret `OVSX_PAT`. The workflow uses that secret when it is set.

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
