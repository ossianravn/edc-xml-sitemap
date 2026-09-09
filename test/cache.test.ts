import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PageCache, UnavailableError } from '../src/cache.ts';
import { CacheStore } from '../src/cache-store.ts';
import { createEdcLoader, UpstreamError } from '../src/upstream.ts';
import { readConfig } from '../src/config.ts';

const input = { inputPageNumber: 1, inputPageSize: 100 };
const items = [{ caseNumber: '123', urlPath: '/alle-boliger/villa/zip/road/123/',
  statusChangeDate: '2026-09-09T12:00:00Z' }];
const policy = { freshMs: 1000, maxAgeMs: 5000, retryMs: 500 };
const quiet = () => {};

test('cache coalesces requests, survives restart, retries outages and expires by original fetch time', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'edc-cache-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new CacheStore(directory, quiet);
  await store.initialize();
  let now = 100_000, calls = 0, unavailable = false;
  const loader = async () => {
    calls++;
    if (unavailable) throw new UpstreamError('EDC unavailable.');
    return items;
  };
  const makeCache = () => new PageCache(store, policy, loader, quiet, () => now);
  const cache = makeCache();
  const results = await Promise.all([cache.get(input), cache.get(input), cache.get(input)]);
  assert.equal(calls, 1);
  assert.equal(results[0]?.status, 'REFRESH');
  now += 999;
  const restarted = makeCache();
  assert.equal((await restarted.get(input)).status, 'HIT');
  assert.equal(calls, 1);
  unavailable = true;
  now++;
  const stale = await restarted.get(input);
  assert.equal(stale.status, 'STALE');
  assert.equal(stale.fetchedAt, 100_000);
  await restarted.get(input);
  assert.equal(calls, 2, 'outage requests are throttled');
  now += 500;
  unavailable = false;
  assert.equal((await restarted.get(input)).status, 'REFRESH');
  assert.equal(calls, 3);
  unavailable = true;
  now += 5000;
  await assert.rejects(restarted.get(input), UnavailableError);
  const persisted = JSON.parse(await readFile(join(directory, '1-100.json'), 'utf8'));
  assert.equal(persisted.fetchedAt, 101_500, 'failed refresh must not reset the cache clock');
});

test('input page identity is isolated and invalid persisted data is refreshed', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'edc-cache-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const events: string[] = [];
  const store = new CacheStore(directory, event => events.push(event));
  await store.initialize();
  await writeFile(join(directory, '1-100.json'), '{broken');
  let calls = 0;
  const cache = new PageCache(store, policy, async () => { calls++; return items; }, quiet);
  await cache.get(input);
  await cache.get({ ...input, inputPageNumber: 2 });
  await cache.get({ ...input, inputPageSize: 50 });
  await cache.get(input);
  assert.equal(calls, 3);
  assert.ok(events.includes('cache_invalid'));
});

test('upstream adapter sends one exact page, ignores advertised items and rejects broken contracts', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (url, options) => {
    calls++;
    const target = new URL(String(url));
    assert.equal(target.origin, 'https://www.edc.dk');
    assert.equal(target.searchParams.get('pageNr'), '1');
    assert.equal(target.searchParams.get('pageSize'), '100');
    assert.equal(target.searchParams.get('c-gruppe'), 'Private');
    assert.equal(options?.redirect, 'error');
    return Response.json({ currentPage: 1, itemsPerPage: 100, items, advertisedItems: items });
  };
  assert.deepEqual(await createEdcLoader(1000, fetcher)(input), items);
  assert.equal(calls, 1);
  for (const payload of [{ currentPage: 1, itemsPerPage: 100 },
    { currentPage: 2, itemsPerPage: 100, items },
    { currentPage: 1, itemsPerPage: 100, items: [null] }]) {
    await assert.rejects(createEdcLoader(1000, async () => Response.json(payload))(input), UpstreamError);
  }
  await assert.rejects(createEdcLoader(1000, async () => new Response('bad', { status: 500 }))(input), UpstreamError);
});

test('configuration rejects unusable cache lifetimes before serving traffic', () => {
  assert.equal(readConfig({}).cachePolicy.freshMs, 3_600_000);
  assert.throws(() => readConfig({ CACHE_TTL_SECONDS: '3600', CACHE_MAX_AGE_SECONDS: '100' }));
  assert.throws(() => readConfig({ PORT: '0' }));
});
