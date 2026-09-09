import type { InputPage } from './parameters.ts';
import type { CaseRecord } from './upstream.ts';
import { UpstreamError } from './upstream.ts';
import { CacheStore } from './cache-store.ts';
import type { Log, Snapshot } from './cache-store.ts';

export class UnavailableError extends Error {}
export interface CacheResult extends Snapshot { status: 'HIT' | 'REFRESH' | 'STALE' }
export interface CachePolicy { freshMs: number; maxAgeMs: number; retryMs: number }

export class PageCache {
  private pending = new Map<string, Promise<CacheResult>>();
  private retryAfter = new Map<string, number>();
  private store: CacheStore;
  private policy: CachePolicy;
  private loader: (input: InputPage) => Promise<CaseRecord[]>;
  private log: Log;
  private clock: () => number;

  constructor(store: CacheStore, policy: CachePolicy,
    loader: (input: InputPage) => Promise<CaseRecord[]>,
    log: Log, clock: () => number = Date.now) {
    this.store = store;
    this.policy = policy;
    this.loader = loader;
    this.log = log;
    this.clock = clock;
  }

  async get(input: InputPage): Promise<CacheResult> {
    const key = `${input.inputPageNumber}-${input.inputPageSize}`;
    const active = this.pending.get(key);
    if (active) return active;
    if (this.pending.size >= 8) throw new UnavailableError('The service is busy. Retry shortly.');
    const request = this.resolve(key, input);
    this.pending.set(key, request);
    try { return await request; }
    finally { this.pending.delete(key); }
  }

  private async resolve(key: string, input: InputPage): Promise<CacheResult> {
    let previous: Snapshot | null;
    try { previous = await this.store.read(key, this.clock()); }
    catch { throw new UnavailableError('The persistent cache is unavailable.'); }
    if (previous && this.clock() - previous.fetchedAt < this.policy.freshMs) {
      return { ...previous, status: 'HIT' };
    }
    if (this.clock() < (this.retryAfter.get(key) ?? 0)) return this.stale(previous);
    try {
      const items = await this.loader(input);
      const snapshot = { items, fetchedAt: this.clock() };
      await this.store.write(key, snapshot);
      this.retryAfter.delete(key);
      this.log('cache_refreshed', { key, count: items.length });
      return { ...snapshot, status: 'REFRESH' };
    } catch (error) {
      this.retryAfter.delete(key);
      this.retryAfter.set(key, this.clock() + this.policy.retryMs);
      if (this.retryAfter.size > 256) {
        const oldest = this.retryAfter.keys().next().value;
        if (oldest !== undefined) this.retryAfter.delete(oldest);
      }
      this.log('cache_refresh_failed', { key, reason: error instanceof UpstreamError
        ? error.message : 'Unable to persist refreshed data.' });
      return this.stale(previous);
    }
  }

  private stale(snapshot: Snapshot | null): CacheResult {
    if (!snapshot || this.clock() - snapshot.fetchedAt >= this.policy.maxAgeMs) {
      throw new UnavailableError('EDC data is unavailable and no usable cached page remains.');
    }
    this.log('cache_stale', { ageSeconds: Math.floor((this.clock() - snapshot.fetchedAt) / 1000) });
    return { ...snapshot, status: 'STALE' };
  }
}
