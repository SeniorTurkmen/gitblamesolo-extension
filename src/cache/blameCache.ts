import { BlameInfo } from '../types';

interface DocumentLike {
  uri: { toString(): string };
  version: number;
}

const MAX_ENTRIES = 500;

export class BlameCache {
  private readonly entries = new Map<string, Promise<BlameInfo | undefined>>();

  async getOrCompute(
    document: DocumentLike,
    line: number,
    compute: () => Promise<BlameInfo | undefined>,
  ): Promise<BlameInfo | undefined> {
    const key = this.keyFor(document, line);
    const cached = this.entries.get(key);
    if (cached) {
      return cached;
    }

    const promise = compute();
    this.entries.set(key, promise);
    this.evictIfNeeded();
    this.invalidateOlderVersions(document);

    try {
      return await promise;
    } catch (err) {
      this.entries.delete(key);
      throw err;
    }
  }

  clear(): void {
    this.entries.clear();
  }

  private keyFor(document: DocumentLike, line: number): string {
    return `${document.uri.toString()}#${document.version}#${line}`;
  }

  private invalidateOlderVersions(document: DocumentLike): void {
    const prefix = `${document.uri.toString()}#`;
    const currentVersionPrefix = `${prefix}${document.version}#`;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix) && !key.startsWith(currentVersionPrefix)) {
        this.entries.delete(key);
      }
    }
  }

  private evictIfNeeded(): void {
    while (this.entries.size > MAX_ENTRIES) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.entries.delete(oldestKey);
    }
  }
}
