import * as vscode from 'vscode';
import { BlameOptions, MovedLinesDetection } from './git/gitBlame';
import { DateStyle } from './util/dateFormat';

/** What the mouse must be over to show the blame hover. */
export type HoverTrigger = 'annotation' | 'line';

export interface GitBlameSoloConfig {
  enabled: boolean;
  dateStyle: DateStyle;
  decorationTemplate: string;
  decorationColor: string | undefined;
  debounceMs: number;
  hoverEnabled: boolean;
  hoverTrigger: HoverTrigger;
  maxFileSizeBytes: number;
  uncommittedLabel: string;
  currentUserLabel: string;
  showAuthorEmail: boolean;
  statusBarEnabled: boolean;
  statusBarTemplate: string;
  blameOptions: BlameOptions;
  exclude: string[];
  fileBlameEnabled: boolean;
  fileBlameTemplate: string;
  fileBlameHeatmap: boolean;
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
    hoverTrigger: cfg.get<HoverTrigger>('hover.trigger', 'annotation'),
    maxFileSizeBytes: cfg.get<number>('maxFileSizeKB', 5000) * 1024,
    uncommittedLabel: cfg.get<string>('uncommittedLabel', 'Uncommitted changes'),
    currentUserLabel: cfg.get<string>('currentUserLabel', 'You'),
    showAuthorEmail: cfg.get<boolean>('showAuthorEmail', true),
    statusBarEnabled: cfg.get<boolean>('statusBar.enabled', false),
    statusBarTemplate: cfg.get<string>('statusBar.template', '${author}, ${date}'),
    blameOptions: {
      ignoreWhitespace: cfg.get<boolean>('ignoreWhitespace', false),
      detectMovedLines: cfg.get<MovedLinesDetection>('detectMovedLines', 'off'),
      ignoreRevsFile: cfg.get<string>('ignoreRevsFile', '.git-blame-ignore-revs'),
    },
    exclude: cfg.get<string[]>('exclude', []),
    fileBlameEnabled: cfg.get<boolean>('fileBlame.enabled', false),
    fileBlameTemplate: cfg.get<string>('fileBlame.template', '${author}, ${date}'),
    fileBlameHeatmap: cfg.get<boolean>('fileBlame.heatmap', true),
  };
}

export function onConfigChanged(listener: (e: vscode.ConfigurationChangeEvent) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('gitBlameSolo')) {
      listener(e);
    }
  });
}

/** Whether the user excluded this document from the annotation, status bar, and hover. */
export function isExcluded(document: vscode.TextDocument, config: GitBlameSoloConfig): boolean {
  return config.exclude.some((pattern) => vscode.languages.match({ pattern }, document) > 0);
}
