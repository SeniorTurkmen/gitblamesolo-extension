# Changelog

## Unreleased

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
