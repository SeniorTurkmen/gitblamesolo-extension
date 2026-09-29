/** The parts of a contributes.configuration property that the settings picker uses. */
export interface SettingSchema {
  type: 'boolean' | 'string' | 'number' | 'array';
  default: unknown;
  description?: string;
  enum?: string[];
  enumDescriptions?: string[];
}

export interface SettingEntry {
  /** Key without the "gitBlameSolo." prefix, e.g. "statusBar.template". */
  key: string;
  title: string;
  schema: SettingSchema;
}

export const SETTINGS_SECTION = 'gitBlameSolo';

/** Reads the extension's settings from its package.json, in declaration order. */
export function readSettingEntries(packageJson: unknown): SettingEntry[] {
  const properties = (packageJson as { contributes?: { configuration?: { properties?: Record<string, SettingSchema> } } })
    ?.contributes?.configuration?.properties;
  if (!properties) {
    return [];
  }
  const prefix = `${SETTINGS_SECTION}.`;
  return Object.entries(properties)
    .filter(([fullKey]) => fullKey.startsWith(prefix))
    .map(([fullKey, schema]) => {
      const key = fullKey.slice(prefix.length);
      return { key, title: settingTitle(key), schema };
    });
}

/** "statusBar.template" → "Status Bar: Template", the way the Settings editor titles settings. */
export function settingTitle(key: string): string {
  return key
    .split('.')
    .map((part) =>
      part
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/^./, (c) => c.toUpperCase()),
    )
    .join(': ');
}

export function formatSettingValue(value: unknown): string {
  if (typeof value === 'boolean') {
    return value ? 'On' : 'Off';
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? '(none)' : value.join(', ');
  }
  if (value === '' || value === undefined || value === null) {
    return '(empty)';
  }
  return String(value);
}

/** Returns an error message for invalid number input, or undefined when it is valid. */
export function validateNumberInput(text: string): string | undefined {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) {
    return 'Enter a whole number of 0 or more.';
  }
  return undefined;
}
