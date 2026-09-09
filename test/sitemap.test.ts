import assert from 'node:assert/strict';
import test from 'node:test';
import { parseParameters, RequestError } from '../src/parameters.ts';
import { publicationDate } from '../src/publication-date.ts';
import { renderSitemap, selectUrls } from '../src/sitemap.ts';
import type { CaseRecord } from '../src/upstream.ts';

const params = (query = '') => parseParameters(new URLSearchParams(query));
const now = Date.parse('2026-09-09T12:00:00Z');
const record = (number: string, date: string | null, address = 'road-3'): CaseRecord => ({
  caseNumber: number, statusChangeDate: date,
  urlPath: `/alle-boliger/villa/4684-holmegaard/${address}/${number}/`,
});

test('Copenhagen publication dates respect seasons, DST gaps/overlaps, and explicit offsets', () => {
  for (const [source, expected] of [
    ['2026-09-09T14:00:00', '2026-09-09T12:00:00Z'],
    ['2026-01-09T14:00:00.123', '2026-01-09T13:00:00.123Z'],
    ['2026-10-25T02:30:00', '2026-10-25T00:30:00Z'],
    ['2026-09-09T14:00:00+03:00', '2026-09-09T11:00:00Z'],
    ['2026-09-09T14:00:00Z', '2026-09-09T14:00:00Z'],
  ]) assert.equal(publicationDate(source!), Date.parse(expected!));
  for (const invalid of ['2026-03-29T02:30:00', '2026-02-30T12:00:00Z',
    '2026-09-09T24:00:00', '2026-09-09T12:00:00+25:00', 'yesterday', null]) {
    assert.equal(publicationDate(invalid), null);
  }
});

test('BBR transforms matching case suffixes, deduplicates newest-first, then limits', () => {
  const items = [
    record('100', '2026-09-07T12:00:00Z'),
    record('200', '2026-09-08T12:00:00Z'),
    record('300', '2026-09-06T12:00:00Z', 'other-4'),
    { ...record('400', '2026-09-09T12:00:00Z'), urlPath: '/projekt/villa/400/' },
    { ...record('500', '2026-09-09T12:00:00Z'), urlPath: '/alle-boliger/villa/zip/road/999/' },
  ];
  assert.deepEqual(selectUrls(items, params('caseType=bbr&pageSize=2'), now), [
    'https://www.edc.dk/alle-boliger/villa/4684-holmegaard/road-3/',
    'https://www.edc.dk/alle-boliger/villa/4684-holmegaard/other-4/',
  ]);
  assert.equal(selectUrls(items, params('pageSize=1'), now)[0], 'https://www.edc.dk/projekt/villa/400/');
});

test('age window overrides the limit, includes the exact cutoff and excludes invalid/future dates', () => {
  const fresh = Array.from({ length: 250 }, (_, i) => record(String(i), '2026-09-08T12:00:00Z'));
  assert.equal(selectUrls(fresh, params('maxDaysAge=7&pageSize=100'), now).length, 250);
  const edges = [record('1', '2026-09-02T12:00:00Z'), record('2', '2026-09-02T11:59:59.999Z'),
    record('3', '2026-09-09T12:00:00.001Z'), record('4', null)];
  assert.deepEqual(selectUrls(edges, params('maxDaysAge=7'), now), [
    'https://www.edc.dk/alle-boliger/villa/4684-holmegaard/road-3/1/',
  ]);
  assert.equal(selectUrls(edges, params('maxDaysAge=7'), now + 1).length, 1);
  assert.equal(selectUrls(edges, params(), now).at(-1)?.endsWith('/4/'), true);
});

test('URL validation excludes foreign hosts, traversal and unsafe paths; XML is escaped', () => {
  const paths = ['//evil.example/case/', '/\\evil.example/', '/alle-boliger/../elsewhere/',
    '/alle-boliger/%2e%2e/elsewhere/', '/alle-boliger/%2felsewhere/', '/bad%00path/',
    '/bad%escape/', '/case/?redirect=elsewhere', '/case/#fragment'];
  assert.deepEqual(selectUrls(paths.map(urlPath => ({ ...record('1', null), urlPath })), params(), now), []);
  const xml = renderSitemap(['https://www.edc.dk/a&b/']);
  assert.match(xml, /<loc>https:\/\/www.edc.dk\/a&amp;b\/<\/loc>/);
  assert.doesNotMatch(xml, /lastmod/);
  assert.match(renderSitemap([]), /<urlset[^>]+>\n<\/urlset>/);
});

test('request contract supports the original alias and rejects malformed/ambiguous input', () => {
  assert.deepEqual(params(), { inputPageSize: 100, inputPageNumber: 1, pageSize: 100,
    caseType: 'case', maxDaysAge: null, download: false });
  assert.equal(params('PageSize=25&dl=1').pageSize, 25);
  assert.equal(params('PageSize=25&dl=1').download, true);
  for (const query of ['pageSize=0', 'pageSize=2.5', 'inputPageSize=1001', 'dl=yes',
    'caseType=BBR', 'maxDaysAge=-7', 'maxDaysAge=100000001', 'other=1',
    'pageSize=2&pageSize=3', 'pageSize=2&PageSize=2', 'maxDaysAge=7&pageSize=no']) {
    assert.throws(() => params(query), RequestError);
  }
});
