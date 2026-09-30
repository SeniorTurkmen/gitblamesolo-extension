# Changelog

## 0.3.0

- Added **localized dates**: dates follow your operating system's region settings instead of always US English, so relative dates read like *vor 3 Tagen* or *3 gün önce* and exact dates like *22.09.2026, 14:39*. Set `gitBlameSolo.dateLocale` to `vscode` for VS Code's display language, or to a tag such as `en-GB`. The new `iso` date style shows *2026-09-22 14:39* in every locale.
- Added **comparisons**: **Git Blame Solo: Compare Branches, Tags, or Commits…** opens every file that differs between two branches, tags, or commits, or between one and your working copy, in one multi-diff editor. It is also in the Source Control title bar and on each commit in the git log. **Compare File Between Revisions…** diffs a file between two of its commits.
- Added **previous versions of a file**: in a file's history, **Open** opens the file as it was in a commit, and **Compare** diffs that version against your working copy, following renames. **Git Blame Solo: Open File at Revision…** and **Compare with Revision…** do the same from a list of the file's commits, from the editor title bar's **…** menu, the Explorer, and editor tabs.
- Added **commit line highlighting**: with `gitBlameSolo.highlightCommitLines` on, every other line of the file from the current line's commit is highlighted, with marks in the scroll bar. Off by default; the colors are the `gitBlameSolo.commitLinesBackground` and `gitBlameSolo.commitLinesOverviewRuler` theme colors.
- Added **author history**: **Git Blame Solo: Show Author History**, the author in the blame hover, or an author in the git log opens the log filtered to that author's commits.

## 0.2.0

- Added the **git log**: **Git Blame Solo: Show Git Log** opens a panel with the repository's commits and a commit graph, showing branches, remote branches, and tags on their commits. Show the current branch, all branches, or a single branch; search commit messages and filter by author. Click a commit to open its details. It is also in the Source Control view's title bar.
- Added **file history**: **Git Blame Solo: Show File History** opens the git log filtered to the commits that changed a file, following renames. It is in the editor title bar and the right-click menus of files in the Explorer, editor tabs, and the Source Control view. Hide the editor title bar buttons with `gitBlameSolo.editorTitleButtons`.
- Each file in the commit details panel can be folded with the arrow in its header, and **Collapse all** / **Expand all** fold or unfold every file.
- The commit details panel marks the file it was opened for, from a file's history or the blame hover, with a colored border and an "Opened from this file" badge, scrolls to it, and starts with the commit's other files folded. A file renamed since the commit is found by its name in the commit.
- Added a **Toggle File Blame** button to the editor title bar.
- Added **file blame**: blame for every line of the file in a column before the text, with a heatmap tinting each line by how recent its commit is. Off by default; turn it on with `gitBlameSolo.fileBlame.enabled` or **Git Blame Solo: Toggle File Blame**, and format it with `gitBlameSolo.fileBlame.template`. Hovering the column shows the blame hover for that line.
- Fixed: files opened through a symlinked folder got no blame, because git reports the repository root with symlinks resolved.
- A line you edit and then change back to its committed text shows its commit again about a second after you stop typing, instead of reading as uncommitted until you save. The buffer is blamed again whenever typing pauses.
- The remote URL and your `user.email` are re-read when the repository's config file or your global git config changes (for example after `git remote set-url` or `git config user.email`), so **Git Blame Solo: Refresh** is no longer needed for that.

## 0.1.2

- The hover and the commit details panel link to the pull request a commit came from, when its message names one: GitHub merge and squash commits ("(#123)"), GitLab "See merge request", Bitbucket "(pull request #N)", and Azure DevOps "Merged PR N:". Other hosts get no pull request link.
- Co-authors from `Co-authored-by:` trailers are listed in the hover (emails follow `gitBlameSolo.showAuthorEmail`) and in the commit details panel. The trailers are no longer repeated in the message body.
- Added **Line history** to the hover and as a command: it lists every commit that changed the current line, newest first, following it across edits and renames (`git log -L`). Picking a commit opens its change in the diff editor at the line; buttons open the commit details or copy the hash.
- **Open in Diff Editor** in the hover now opens at the line instead of the top of the file.

## 0.1.1

- Added **Blame previous revision** to the hover and as a command: it opens the file as it was before the commit that last changed the line in a diff editor against the current file, at the matching line. Blame and the hover work in that past revision too, so you can keep stepping back through a line's history. Renames are followed.
- Fixed: for a file renamed since the commit, the hover's diff and **Open in Diff Editor** used the current path, which didn't exist in that commit, and the commit panel didn't highlight the line you started from.
- Fixed: uncommitted lines showed the file's last save time as if it were when the line changed, so a line typed a moment ago in a file saved 12 days ago read "Uncommitted changes, 12 days ago". The annotation now says "file saved 12 days ago", or "(file not saved)" while the file has unsaved changes, and the hover says the same.
- A copy button next to the commit hash in the hover and the commit details panel copies the full hash.
- Added **Git Blame Solo: Change Setting…**, which lists every setting with its current value and changes or resets the one you pick, without opening the Settings editor.
- The author's email is shown next to their name in the hover. Turn it off with **Git Blame Solo: Hide Author Email** or `gitBlameSolo.showAuthorEmail`. The inline annotation and status bar stay name-only.
- **Behavior change:** the blame hover now opens only over the inline annotation at the end of the current line, not anywhere on any line. Set `gitBlameSolo.hover.trigger` to `"line"` to restore the previous behavior.
- Added the **Git Blame Solo: Refresh** command, which clears cached blame, repository roots, the remote URL, and `user.email`.
- Added **Open on GitHub/GitLab/Bitbucket/Azure DevOps** to the hover and the commit details panel, and the **Git Blame Solo: Open Commit on Remote** command. Other hosts get a `/commit/<sha>` link.
- Added an optional status bar item (`gitBlameSolo.statusBar.enabled`, `gitBlameSolo.statusBar.template`) that opens the commit details when clicked.
- Your own commits read as "You" in the annotation and status bar (`gitBlameSolo.currentUserLabel`).
- Commits listed in `.git-blame-ignore-revs` are skipped when the file exists (`gitBlameSolo.ignoreRevsFile`).
- Added `gitBlameSolo.ignoreWhitespace` (`-w`) and `gitBlameSolo.detectMovedLines` (`-M`/`-C`).
- Added `gitBlameSolo.exclude` to turn off blame for files matching glob patterns.
- Blame is computed for the whole file with a single `git blame --incremental` and cached per document, instead of one `git` process per line. Edits shift the cached result (edited lines read as uncommitted) and saving re-blames the file, so typing no longer runs `git`.
- Fixed: the inline blame for a line could go blank after a hover was dismissed quickly. The cancelled git call cached `undefined`; calls whose results go into the shared caches are no longer cancelled.
- Fixed: blame went stale after a commit, amend, checkout, pull, or reset (for example, freshly committed lines still showed "Uncommitted changes"). The blame cache is now cleared whenever a repository's HEAD moves.

## 0.1.0

- Redesigned the hover's "What changed" section: VS Code codicons, a `+N`/`-N` diff stat, and rules separating the sections. The diff body is still a colored code block.
- The hover shows the whole contiguous change in the same hunk, not only the single line from the commit that last changed it.
- **"Open in Diff Editor"** in the hover and **"Open Diff"** on each file in the commit panel open VS Code's native diff editor (parent commit ↔ this commit). For renamed files, the left side uses the old path.
- **"View changed files"** lists every file the commit changed, with colored diffs, in a panel. If the panel was opened from a line, that line is highlighted and scrolled into view. Long diffs are truncated at 400 lines.
- **"Revert Hunk"** on each hunk: reverts only that block with `git apply --reverse`. If the file has unsaved changes or the hunk no longer matches the current file, it reports an error without touching the file. It always asks for confirmation first.

## 0.0.1

- Initial release: inline git blame annotation for the active line, full commit details on hover for every line, and mtime-based timestamps for uncommitted lines.
