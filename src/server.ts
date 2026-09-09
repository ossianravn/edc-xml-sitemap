import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { parseParameters, RequestError } from './parameters.ts';
import { renderSitemap, selectUrls } from './sitemap.ts';
import { UnavailableError } from './cache.ts';
import type { PageCache } from './cache.ts';
import type { Log } from './cache-store.ts';

function json(response: ServerResponse, status: number, body: object): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}

export function createSitemapServer(cache: PageCache, log: Log, clock = Date.now) {
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.setHeader('Allow', 'GET, HEAD');
        json(response, 405, { error: 'Use GET or HEAD.' });
        return;
      }
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname === '/healthz') {
        json(response, 200, { status: 'ok' });
        return;
      }
      if (url.pathname !== '/sitemap.xml') {
        json(response, 404, { error: 'Use /sitemap.xml.' });
        return;
      }
      const params = parseParameters(url.searchParams);
      const result = await cache.get(params);
      const now = clock();
      const urls = selectUrls(result.items, params, now);
      const xml = renderSitemap(urls);
      response.writeHead(200, {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(xml),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Cache-Status': result.status,
        'X-Data-Age-Seconds': Math.floor(Math.max(0, now - result.fetchedAt) / 1000),
        'X-Data-Fetched-At': new Date(result.fetchedAt).toISOString(),
        'X-Sitemap-Url-Count': urls.length,
        ...(params.download ? { 'Content-Disposition':
          `attachment; filename="edc-${params.caseType}-sitemap.xml"` } : {}),
      });
      response.end(request.method === 'HEAD' ? undefined : xml);
    } catch (error) {
      if (error instanceof RequestError) json(response, 400, { error: error.message });
      else if (error instanceof UnavailableError) {
        response.setHeader('Retry-After', '60');
        json(response, 503, { error: error.message });
      } else {
        log('request_failed', { reason: 'Unexpected internal error.' });
        json(response, 500, { error: 'Unable to generate the sitemap.' });
      }
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return server;
}
