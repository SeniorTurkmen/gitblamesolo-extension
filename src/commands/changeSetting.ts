import * as vscode from 'vscode';
import {
  formatSettingValue,
  readSettingEntries,
  SettingEntry,
  SETTINGS_SECTION,
  validateNumberInput,
} from '../util/settingsSchema';

interface SettingItem extends vscode.QuickPickItem {
  entry?: SettingEntry;
  openSettingsUi?: boolean;
}

interface ValueItem<T> extends vscode.QuickPickItem {
  value?: T;
  reset?: boolean;
  edit?: boolean;
  add?: boolean;
}

/**
 * Lists every Git Blame Solo setting with its current value and edits the
 * picked one with an editor that fits its type. The list comes from the
 * extension's package.json, so new settings show up without changes here.
 */
export async function changeSetting(extension: vscode.Extension<unknown>): Promise<void> {
  const entries = readSettingEntries(extension.packageJSON);
  const config = vscode.workspace.getConfiguration(SETTINGS_SECTION);

  const items: SettingItem[] = entries.map((entry) => ({
    label: entry.title,
    description: formatSettingValue(config.get(entry.key)),
    detail: entry.schema.description,
    entry,
  }));
  items.push(
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    { label: '$(gear) Open in Settings Editor', openSettingsUi: true },
  );

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Git Blame Solo: Change Setting',
    placeHolder: 'Pick a setting to change',
    matchOnDetail: true,
  });
  if (!picked) {
    return;
  }
  if (picked.openSettingsUi) {
    await vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${extension.id}`);
    return;
  }
  if (picked.entry) {
    await editSetting(picked.entry);
  }
}

async function editSetting(entry: SettingEntry): Promise<void> {
  const config = vscode.workspace.getConfiguration(SETTINGS_SECTION);
  const current = config.get(entry.key);
  const { schema } = entry;

  let next: { value: unknown } | 'reset' | undefined;
  if (schema.type === 'boolean') {
    next = await pickValue(entry, current, [
      { label: 'On', value: true },
      { label: 'Off', value: false },
    ]);
  } else if (schema.enum) {
    next = await pickValue(
      entry,
      current,
      schema.enum.map((option, i) => ({ label: option, value: option, detail: schema.enumDescriptions?.[i] })),
    );
  } else if (schema.type === 'array') {
    next = await editList(entry, Array.isArray(current) ? (current as string[]) : []);
  } else {
    next = await editText(entry, current);
  }

  if (next === undefined) {
    return;
  }
  const target = targetFor(entry.key);
  await config.update(entry.key, next === 'reset' ? undefined : next.value, target);
  if (target !== vscode.ConfigurationTarget.Global) {
    void vscode.window.showInformationMessage(
      `Git Blame Solo: "${entry.title}" is set for this workspace, so the change was saved to the workspace settings.`,
    );
  }
}

async function pickValue<T>(
  entry: SettingEntry,
  current: unknown,
  options: Array<ValueItem<T>>,
): Promise<{ value: unknown } | 'reset' | undefined> {
  const items: Array<ValueItem<T>> = options.map((option) => ({
    ...option,
    description: option.value === current ? '$(check) current' : undefined,
  }));
  items.push(resetItem(entry));

  const picked = await vscode.window.showQuickPick(items, { title: entry.title, placeHolder: entry.schema.description });
  if (!picked) {
    return undefined;
  }
  return picked.reset ? 'reset' : { value: picked.value };
}

async function editText(entry: SettingEntry, current: unknown): Promise<{ value: unknown } | 'reset' | undefined> {
  const choice = await vscode.window.showQuickPick<ValueItem<never>>(
    [{ label: '$(edit) Edit value…', description: formatSettingValue(current), edit: true }, resetItem(entry)],
    { title: entry.title, placeHolder: entry.schema.description },
  );
  if (!choice) {
    return undefined;
  }
  if (choice.reset) {
    return 'reset';
  }

  const isNumber = entry.schema.type === 'number';
  const text = await vscode.window.showInputBox({
    title: entry.title,
    prompt: entry.schema.description,
    value: current === undefined ? '' : String(current),
    validateInput: isNumber ? validateNumberInput : undefined,
  });
  if (text === undefined) {
    return undefined;
  }
  return { value: isNumber ? Number(text.trim()) : text };
}

/** Lists the current entries (pick one to remove) plus actions to add one or reset. */
async function editList(entry: SettingEntry, current: string[]): Promise<{ value: unknown } | 'reset' | undefined> {
  const items: Array<ValueItem<string>> = [
    { label: '$(add) Add pattern…', add: true },
    ...current.map((pattern) => ({ label: pattern, value: pattern, description: 'pick to remove' })),
    resetItem(entry),
  ];
  const picked = await vscode.window.showQuickPick(items, { title: entry.title, placeHolder: entry.schema.description });
  if (!picked) {
    return undefined;
  }
  if (picked.reset) {
    return 'reset';
  }
  if (picked.add) {
    const pattern = await vscode.window.showInputBox({
      title: `${entry.title}: Add`,
      prompt: 'Glob pattern, for example **/*.min.js',
      validateInput: (text) => (text.trim() ? undefined : 'Enter a glob pattern.'),
    });
    return pattern === undefined ? undefined : { value: [...current, pattern.trim()] };
  }
  return { value: current.filter((pattern) => pattern !== picked.value) };
}

function resetItem<T>(entry: SettingEntry): ValueItem<T> {
  return {
    label: '$(discard) Reset to default',
    description: formatSettingValue(entry.schema.default),
    reset: true,
  };
}

/**
 * Writes where the effective value comes from, so a workspace override
 * doesn't silently win over a change saved to user settings.
 */
function targetFor(key: string): vscode.ConfigurationTarget {
  const inspected = vscode.workspace.getConfiguration(SETTINGS_SECTION).inspect(key);
  if (inspected?.workspaceFolderValue !== undefined) {
    return vscode.ConfigurationTarget.WorkspaceFolder;
  }
  if (inspected?.workspaceValue !== undefined) {
    return vscode.ConfigurationTarget.Workspace;
  }
  return vscode.ConfigurationTarget.Global;
}
