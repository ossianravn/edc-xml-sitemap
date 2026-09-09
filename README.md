# EDC XML Sitemap

TypeScript/Node.js service that converts one EDC quick-search page into an XML sitemap. Ordinary cases are sorted by `statusChangeDate`, newest first. Google submission is handled separately by the operator.

## Run locally

Requires Node.js 24 and npm. The runtime has no third-party dependencies.

```sh
npm ci
npm run check
npm start
```

Open [the local sitemap](http://localhost:3000/sitemap.xml). For development, use `npm run dev`. The built service starts from `dist/main.js`.

Defaults work without an environment file. To customize them, copy `.env.example` to `.env`, edit it and start with `node --env-file=.env dist/main.js`. `npm start` does not load `.env` automatically.

## Requests

| Parameter | Default | Meaning |
| --- | --- | --- |
| `inputPageSize` | `100` | EDC page size, integer 1-1000. |
| `inputPageNumber` | `1` | EDC page number, positive safe integer. |
| `pageSize` | `100` | Maximum unique output URLs, integer 1-50000. `PageSize` is an alias. |
| `caseType` | `case` | `case` keeps the EDC listing path; `bbr` removes the matching final case number. |
| `maxDaysAge` | Absent | Positive integer days since publication. When present, replaces `pageSize`. |
| `dl` | `0` | `1` returns an XML file download. |

Use `GET` or `HEAD` on `/sitemap.xml`. Unknown, repeated, malformed or conflicting alias parameters return HTTP 400. Supplied `pageSize` still has to be valid when `maxDaysAge` is present. The implementation bounds age windows to 100,000,000 days for safe date arithmetic.

Examples for the intended production hostname (available after deployment):

- [Default case sitemap](https://sitemap.kpi.estate/sitemap.xml)
- [Up to 50 BBR URLs from 100 input cases](https://sitemap.kpi.estate/sitemap.xml?inputPageSize=100&pageSize=50&caseType=bbr)
- [Cases published within seven days from one 1,000-case input page](https://sitemap.kpi.estate/sitemap.xml?inputPageSize=1000&maxDaysAge=7)
- [Download BBR URLs from input page two](https://sitemap.kpi.estate/sitemap.xml?inputPageNumber=2&caseType=bbr&dl=1)

Each request reads exactly one input page. The service never fetches subsequent pages to fill an output limit. EDC's separate `advertisedItems` array is excluded. Observed upstream pagination covers a 1,000-result subset despite reporting a much larger total; this service cannot promise a complete EDC catalogue or all newly published cases across all pages.

BBR mode accepts only `/alle-boliger/` paths with a trailing segment matching the case number. For example, `/alle-boliger/villa/4684-holmegaard/brombaersvinget-3/47115608/` becomes `/alle-boliger/villa/4684-holmegaard/brombaersvinget-3/`. `/projekt/` paths remain eligible in case mode. No extra source or listing-status filters are applied.

## Dates and XML

`statusChangeDate` is the agreed publication date. Explicit timezone offsets are respected; offset-free values are interpreted in `Europe/Copenhagen`, independent of the server timezone. A seven-day window means the preceding 168 hours, includes the exact cutoff, and excludes future dates. The cutoff is recalculated on every request, including cached requests.

Impossible dates and nonexistent local times during the spring DST transition are invalid. The autumn repeated hour resolves to its earlier occurrence. Missing or invalid dates are excluded from age-window requests and sorted last otherwise. Equal dates retain upstream order.

Final URLs are deduplicated before the output limit is applied. XML contains escaped absolute `<loc>` URLs, without `<lastmod>`, `priority` or `changefreq`. A legitimate empty selection returns HTTP 200 with an empty `urlset`. Upstream failure is never reported as a successful empty sitemap.

## Cache settings

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listening port; Docker Compose fixes this to 3000. |
| `CACHE_DIR` | `./data` | Persistent directory; Docker uses `/app/data`. |
| `CACHE_TTL_SECONDS` | `3600` | Refresh on the first request at or after this data age. |
| `CACHE_MAX_AGE_SECONDS` | `86400` | Total age limit for serving old data during refresh failures. |
| `UPSTREAM_TIMEOUT_SECONDS` | `15` | Timeout covering an EDC request and its response body. |
| `UPSTREAM_RETRY_SECONDS` | `60` | Delay before retrying a failed refresh for the same page. |

Maximum age must be at least the refresh interval. Change environment settings and restart/redeploy to apply them. EDC access is on demand; no scheduled polling or public cache-bypass parameter is provided.

Cache identity is `(inputPageNumber, inputPageSize)`. Output options, including BBR mode, download mode and age filters, reuse the same cached input. Different input pages can each cause an EDC request in the same hour. Only the fields needed for URL selection are persisted, with the original successful fetch timestamp. Concurrent requests for one input share a refresh.

Persisted data survives restarts. A failed refresh does not change its age. Freshness and maximum age are measured from successful retrieval, not from the last request or failed refresh. At the maximum age, the service returns HTTP 503 unless refresh succeeds. Retry suppression is in memory and resets on restart.

The cache retains up to 256 page entries, evicting the oldest written entries. At most eight distinct page operations run concurrently; excess requests receive HTTP 503. Deploy one service replica per cache volume; cross-process refresh coordination is not provided.

Response headers show `X-Cache-Status` (`HIT`, `REFRESH`, `STALE`), `X-Data-Age-Seconds`, `X-Data-Fetched-At`, and `X-Sitemap-Url-Count`. Responses use `Cache-Control: no-store` so downstream caches do not freeze rolling windows. JSON logs report refreshes and failures without logging full upstream records.

`/healthz` is a local liveness check. It does not query EDC or promise that a particular input page is available. The cache directory is checked for writability at startup. HTTP 503 means no usable upstream/cache data or temporary capacity exhaustion; HTTP 500 indicates an unexpected internal error.

## Dokploy deployment

1. Connect the [ossianravn/edc-xml-sitemap repository](https://github.com/ossianravn/edc-xml-sitemap) to Dokploy and select the branch to deploy.
2. Create a **Docker Compose** service in Dokploy, connect the source and select `docker-compose.yml`. Use Compose mode, which supports the `build` directive. Set the project subdirectory as the build/source context if needed.
3. Enable **Isolated Deployments** for domain routing, and retain the `sitemap-cache` named volume mounted at `/app/data`. The image runs as the Node user (UID 1000); a manually supplied bind mount must be writable by that user.
4. Set the cache environment values in Dokploy if you want to change their defaults. The supplied Compose file forwards those values and fixes the internal port to 3000.
5. Add `sitemap.kpi.estate` in Dokploy's Domains settings, targeting service **sitemap**, container port **3000**, path `/`, with HTTPS enabled. The Compose file intentionally does not publish a host port.
6. Deploy. Check `/healthz`, then `/sitemap.xml`. The first sitemap request populates the cache. Check the response headers or service logs to confirm subsequent output variants use it.

Preserve the named volume across redeployments. Keep a single replica. This repository provides packaging and instructions; deployment and DNS changes have not been performed.

References: [Dokploy Compose configuration](https://docs.dokploy.com/docs/core/docker-compose), [Dokploy domain routing and isolated deployments](https://docs.dokploy.com/docs/core/docker-compose/domains).

## Validation

`npm run check` runs strict TypeScript checking, Node's test runner, and the production build. Tests cover date boundaries/DST, BBR conversion, ordering, deduplication, age-window precedence, parameter errors, persistent cache restarts/outages, and real local HTTP XML/download/error responses. The upstream adapter uses controlled responses in automated tests; those tests are not live EDC integration.

The Docker build runs the same checks before producing the runtime image. To validate packaging locally:

```sh
docker compose config --quiet
docker compose build
```

See [the agreed design](docs/design.md) and [domain terminology](CONTEXT.md).
