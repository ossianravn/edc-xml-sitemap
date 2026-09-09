import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { decodeItems, isObject } from './upstream.ts';
import type { CaseRecord } from './upstream.ts';

export interface Snapshot { fetchedAt: number; items: CaseRecord[] }
export type Log = (event: string, details: Record<string, string | number>) => void;

function hasCode(error: unknown, code: string): boolean {
  return isObject(error) && error.code === code;
}

export class CacheStore {
  private pruning: Promise<void> | null = null;
  private directory: string;
  private log: Log;
  private maxEntries: number;

  constructor(directory: string, log: Log, maxEntries = 256) {
    this.directory = directory;
    this.log = log;
    this.maxEntries = maxEntries;
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    // Fail startup if the mounted directory cannot be written by the container user.
    const probe = join(this.directory, `.probe-${randomUUID()}`);
    await writeFile(probe, '', { flag: 'wx' });
    await unlink(probe);
  }

  async read(key: string, now: number): Promise<Snapshot | null> {
    let text: string;
    try { text = await readFile(join(this.directory, `${key}.json`), 'utf8'); }
    catch (error) {
      if (hasCode(error, 'ENOENT')) return null;
      throw new Error('Unable to read the persistent cache.');
    }
    try {
      const value: unknown = JSON.parse(text);
      if (!isObject(value) || value.version !== 1 || typeof value.fetchedAt !== 'number' ||
          !Number.isSafeInteger(value.fetchedAt) || value.fetchedAt < 0 || value.fetchedAt > now) {
        throw new Error('Invalid cache metadata.');
      }
      return { fetchedAt: value.fetchedAt, items: decodeItems(value.items) };
    } catch {
      this.log('cache_invalid', { key });
      return null;
    }
  }

  async write(key: string, snapshot: Snapshot): Promise<void> {
    const temporary = join(this.directory, `${key}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify({ version: 1, ...snapshot }), { flag: 'wx' });
      await rename(temporary, join(this.directory, `${key}.json`));
    } finally {
      try { await unlink(temporary); }
      catch (error) {
        if (!hasCode(error, 'ENOENT')) this.log('cache_temp_cleanup_failed', { key });
      }
    }
    // Serialize pruning so concurrent page refreshes cannot race over deletions.
    const previous = this.pruning;
    const pruning = (async () => {
      if (previous) await previous;
      try { await this.prune(); }
      catch { this.log('cache_prune_failed', {}); }
    })();
    this.pruning = pruning;
    await pruning;
    if (this.pruning === pruning) this.pruning = null;
  }

  private async prune(): Promise<void> {
    const names = (await readdir(this.directory)).filter(name => /^\d+-\d+\.json$/.test(name));
    if (names.length <= this.maxEntries) return;
    const entries = await Promise.all(names.map(async name => {
      const path = join(this.directory, name);
      return { path, time: (await stat(path)).mtimeMs };
    }));
    entries.sort((a, b) => a.time - b.time);
    for (const entry of entries.slice(0, entries.length - this.maxEntries)) {
      await unlink(entry.path);
    }
  }
}
