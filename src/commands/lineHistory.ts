import * as vscode from 'vscode';
import { getLineHistory, LineHistoryEntry, LineHistoryOptions } from '../git/gitLineHistory';
import { formatDate } from '../util/dateFormat';

const DETAILS_BUTTON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('files'),
  tooltip: 'Show commit details',
};
const COPY_BUTTON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('copy'),
  tooltip: 'Copy commit SHA',
};

interface HistoryItem extends vscode.QuickPickItem {
  entry: LineHistoryEntry;
}

/**
 * Lists every commit that changed a line, newest first. Picking one opens that
 * commit's change to the file in the diff editor, at the line.
 */
export async function showLineHistory(options: LineHistoryOptions): Promise<void> {
  const picker = vscode.window.createQuickPick<HistoryItem>();
  picker.title = `Line history: ${options.relativePath}:${options.line + 1}`;
  picker.placeholder = 'Pick a commit to open its change in the diff editor';
  picker.matchOnDescription = true;
  picker.matchOnDetail = true;
  picker.busy = true;
  picker.show();

  let hidden = false;
  const disposables: vscode.Disposable[] = [
    picker.onDidHide(() => {
      hidden = true;
      disposables.forEach((d) => d.dispose());
      picker.dispose();
    }),
    picker.onDidAccept(() => {
      const entry = picker.selectedItems[0]?.entry;
      if (!entry) {
        return;
      }
      picker.hide();
      void vscode.commands.executeCommand(
        'gitBlameSolo.openDiff',
        entry.sha,
        options.repoRoot,
        entry.path,
        entry.oldPath,
        entry.line,
      );
    }),
    picker.onDidTriggerItemButton(({ item, button }) => {
      if (button === DETAILS_BUTTON) {
        picker.hide();
        void vscode.commands.executeCommand('gitBlameSolo.showCommitDetails', item.entry.sha, options.repoRoot);
      } else if (button === COPY_BUTTON) {
        void vscode.commands.executeCommand('gitBlameSolo.copyCommitHash', item.entry.sha);
      }
    }),
  ];

  const history = await getLineHistory(options);
  if (hidden) {
    return;
  }
  picker.busy = false;
  if (!history || history.length === 0) {
    picker.placeholder = 'No history found for this line';
    return;
  }
  picker.items = history.map((entry) => ({
    label: entry.summary,
    description: `${entry.authorName} · ${formatDate(entry.authorTimestamp, 'relative')}`,
    detail: `$(git-commit) ${entry.sha.slice(0, 7)}${entry.oldPath && entry.oldPath !== entry.path ? ` · renamed from ${entry.oldPath}` : ''}`,
    buttons: [DETAILS_BUTTON, COPY_BUTTON],
    entry,
  }));
}
