# Implementation validation

Validated locally on 2026-09-09. No production deployment or Google submission was performed.

## Automated checks

- `npm run check`: passed strict TypeScript checking, all 10 tests and the production build on the local Node.js 24 runtime.
- `docker compose config --quiet`: passed.
- `docker build -t edc-xml-sitemap:local .`: passed. The build also ran TypeScript checking, all 10 tests and the production build inside Linux.
- All hand-maintained code files are within the 300-physical-line limit.
- Independent read-only review of dates, URL selection, cache persistence/failure/concurrency and HTTP/upstream behavior returned no actionable findings.

Tests use real temporary filesystem directories and a real local HTTP server. Upstream payloads and outages in automated tests are controlled fixtures, and cache time is injected; these are not live EDC outage tests.

## Live Docker smoke check

The built image ran as the non-root `node` user, with a named volume mounted at `/app/data`. Docker reported it healthy.

One live EDC input-page fetch populated the cache with 100 ordinary records:

| Request | Result |
| --- | --- |
| `/healthz` | HTTP 200, `status=ok`. |
| `/sitemap.xml?inputPageSize=100&pageSize=5` | HTTP 200, five case URLs, cache `REFRESH`. |
| `/sitemap.xml?inputPageSize=100&pageSize=5&caseType=bbr&dl=1` | HTTP 200, five BBR URLs, attachment filename, cache `HIT`. |
| `/sitemap.xml?inputPageSize=100&pageSize=1&maxDaysAge=7` | HTTP 200, 43 URLs, cache `HIT`; age-window precedence observed live. |

The returned XML was successfully parsed using the platform XML parser. BBR output removed the case-number suffix from the corresponding case URL. The example counts describe this snapshot and will change with EDC data and request time.

The container was stopped and removed, then recreated using the same named volume. A request returned five URLs with cache `HIT` and the original fetch timestamp; the new container logs contained no refresh. This verified volume ownership and persistence across container replacement, beyond the automated restart case.

The temporary container and test volume were removed after verification. The locally built `edc-xml-sitemap:local` image remains available.

## Remaining operational boundary

Dokploy packaging and instructions are supplied, but the service has not been deployed to the Ubuntu server. DNS, HTTPS routing and access to EDC from that server have not been tested. The supplied endpoint exposes a limited result subset; the service intentionally processes only one selected input page.
