import { CommitDetails } from '../types';

const MAX_ENTRIES = 200;

export class CommitCache {
  private readonly entries = new Map<string, Promise<CommitDetails | undefined>>();

  async getOrCompute(
    sha: string,
    compute: () => Promise<CommitDetails | undefined>,
  ): Promise<CommitDetails | undefined> {
    const cached = this.entries.get(sha);
    if (cached) {
      return cached;
    }

    const promise = compute();
    this.entries.set(sha, promise);
    this.evictIfNeeded();

    try {
      return await promise;
    } catch (err) {
      this.entries.delete(sha);
      throw err;
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
