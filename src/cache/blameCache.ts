import { FileBlame, toBlameInfo, UNCOMMITTED_LINE } from '../git/gitBlame';
import { BlameInfo } from '../types';

interface DocumentLike {
  uri: { toString(): string };
  version: number;
}

/** Structural subset of vscode.TextDocumentContentChangeEvent. */
export interface ContentChangeLike {
  range: { start: { line: number }; end: { line: number } };
  text: string;
}

interface Entry {
  version: number;
  promise: Promise<FileBlame | undefined>;
  settled: boolean;
  lines: FileBlame | undefined;
}

const MAX_DOCUMENTS = 50;

/**
 * Holds one whole-file blame per document, so moving between lines never
 * spawns git. Edits shift the existing result instead of discarding it: lines
 * outside the edit keep their blame and edited lines read as uncommitted. That
 * is slightly pessimistic (an edit that restores the original text still reads
 * as uncommitted), so callers `refresh` once typing pauses to get an exact
 * result for the unsaved text.
 */
export class BlameCache {
  private readonly entries = new Map<string, Entry>();

  async getLine(
    document: DocumentLike,
    line: number,
    compute: () => Promise<FileBlame | undefined>,
  ): Promise<BlameInfo | undefined> {
    const entry = this.entryFor(document, compute);
    await entry.promise;
    // Read `entry.lines` rather than the resolved value: edits applied after
    // the blame settled replace the array.
    return toBlameInfo(entry.lines, line);
  }

  /** Shifts a settled blame to match an edited document. */
  applyChanges(document: DocumentLike, changes: readonly ContentChangeLike[]): void {
    const key = document.uri.toString();
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }
    if (!entry.settled) {
      // The pending blame describes older content we can no longer map onto.
      this.entries.delete(key);
      return;
    }

    if (entry.lines) {
      let lines = entry.lines;
      // Changes within one event apply in order, each against the result of the previous one.
      for (const change of changes) {
        const start = change.range.start.line;
        const removed = change.range.end.line - start + 1;
        const added = countLines(change.text);
        lines = [
          ...lines.slice(0, start),
          ...new Array<typeof UNCOMMITTED_LINE>(added).fill(UNCOMMITTED_LINE),
          ...lines.slice(start + removed),
        ];
      }
      entry.lines = lines;
    }
    entry.version = document.version;
  }

  /**
   * Re-blames a document whose blame was shifted by edits, keeping the shifted
   * result until the new one arrives. Resolves to true when the cached blame
   * was replaced; a result for content edited in the meantime is dropped.
   */
  async refresh(document: DocumentLike, compute: () => Promise<FileBlame | undefined>): Promise<boolean> {
    const entry = this.entries.get(document.uri.toString());
    if (!entry?.settled || entry.version !== document.version) {
      return false;
    }
    const version = entry.version;
    let lines: FileBlame | undefined;
    try {
      lines = await compute();
    } catch {
      return false;
    }
    if (!lines || this.entries.get(document.uri.toString()) !== entry || entry.version !== version) {
      return false;
    }
    entry.lines = lines;
    return true;
  }

  delete(uri: { toString(): string }): void {
    this.entries.delete(uri.toString());
  }

  clear(): void {
    this.entries.clear();
  }

  private entryFor(document: DocumentLike, compute: () => Promise<FileBlame | undefined>): Entry {
    const key = document.uri.toString();
    const existing = this.entries.get(key);
    if (existing && existing.version === document.version) {
      // Re-insert to keep the map in least-recently-used order.
      this.entries.delete(key);
      this.entries.set(key, existing);
      return existing;
    }

    const entry: Entry = { version: document.version, promise: compute(), settled: false, lines: undefined };
    entry.promise.then(
      (lines) => {
        entry.lines = lines;
        entry.settled = true;
      },
      () => {
        if (this.entries.get(key) === entry) {
          this.entries.delete(key);
        }
      },
    );
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.evictIfNeeded();
    return entry;
  }

  private evictIfNeeded(): void {
    while (this.entries.size > MAX_DOCUMENTS) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.entries.delete(oldestKey);
    }
  }
}

function countLines(text: string): number {
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      count++;
    }
  }
  return count;
}
