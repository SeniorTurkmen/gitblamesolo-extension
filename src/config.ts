import * as vscode from 'vscode';
import { DateStyle } from './util/dateFormat';

export interface GitBlameSoloConfig {
  enabled: boolean;
  dateStyle: DateStyle;
  decorationTemplate: string;
  decorationColor: string | undefined;
  debounceMs: number;
  hoverEnabled: boolean;
  maxFileSizeBytes: number;
  uncommittedLabel: string;
}

export function getConfig(): GitBlameSoloConfig {
  const cfg = vscode.workspace.getConfiguration('gitBlameSolo');
  const decorationColor = cfg.get<string>('decorationColor', '');

  return {
    enabled: cfg.get<boolean>('enabled', true),
    dateStyle: cfg.get<DateStyle>('dateStyle', 'relative'),
    decorationTemplate: cfg.get<string>('decorationTemplate', '${author}, ${date} • ${message}'),
    decorationColor: decorationColor.length > 0 ? decorationColor : undefined,
    debounceMs: cfg.get<number>('debounceMs', 150),
    hoverEnabled: cfg.get<boolean>('hover.enabled', true),
    maxFileSizeBytes: cfg.get<number>('maxFileSizeKB', 5000) * 1024,
    uncommittedLabel: cfg.get<string>('uncommittedLabel', 'Uncommitted changes'),
  };
}

export function onConfigChanged(listener: (config: GitBlameSoloConfig) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('gitBlameSolo')) {
      listener(getConfig());
    }
  });
}
