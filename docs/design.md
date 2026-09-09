# Sitemap service design

Status: user confirmed the full request contract and defaults. Implementation and focused validation completed locally; deployment remains with the operator.

## Established requirements

- Source: `https://www.edc.dk/api/v1/cases/quick-search?c-gruppe=Private&pageNr=1&&pageSize=100`.
- Prefer TypeScript and Node.js.
- Request parameters `inputPageSize` and `inputPageNumber` control input pagination.
- Each request selects exactly one input page. Do not fetch subsequent pages to fill the output; filtering may yield fewer URLs than the requested output size.
- Use only the selected page's ordinary `items`; exclude the separate `advertisedItems` array.
- Sort eligible records within the selected input page by `statusChangeDate`, newest first, before applying the output URL limit.
- Intended consumers are both search engines and crawl/import tools. The user can verify both sites and will handle Google submission; submission work is outside this project scope.
- `pageSize` controls the output size, with `PageSize` accepted as an alias.
- `caseType=case` is the default and emits case URLs.
- `caseType=bbr` emits property URLs without the trailing case number and excludes source paths outside `/alle-boliger/`.
- Optional `maxDaysAge` selects a rolling age window using `statusChangeDate` as publication date, as explicitly chosen by the user.
- When `maxDaysAge` is supplied, it replaces the output URL limit. For example, 250 eligible URLs in the selected input page produce 250 output URLs even with `PageSize=100`.
- `dl=1` returns the XML as a file download.
- Persist successful upstream data across restarts and refresh on demand after one hour. During an upstream outage, allow cached data until it is 24 hours old, then return an error. Both freshness and maximum cache age are configurable. The user's "Yes" to Q5 is interpreted as acceptance of this recommended policy.
- Intended hosting: Ubuntu with Dokploy at `sitemap.kpi.estate`.

## Observed evidence

Inspected on 2026-09-09:

- The project directory is empty before these documents. Git resolves to the parent `C:/CodexApp`; unrelated parent changes are outside this project.
- The supplied endpoint responds to a direct HTTP request with pagination metadata and an `items` array.
- Sample records expose `urlPath`, `caseNumber`, `statusChangeDate`, listing status and source fields.
- Paths include `/alle-boliger/` and `/projekt/`.
- Sample dates are not monotonically newest-first. The user has selected `statusChangeDate` as the publication-date basis; its timezone remains unverified.
- The response reports roughly 43,000 total matches but `resultCount=1000` and `totalPages=10` for a page size of 100. Completeness cannot be inferred from total matches.
- A pagination probe at `pageNr=11&pageSize=100` returns zero ordinary `items` but still includes a separate populated `advertisedItems` array. Advertised records are excluded by the agreed input policy and do not indicate that ordinary pagination continues.
- A compact follow-up at `pageNr=1&pageSize=100` returned 100 ordinary items and four advertised items. Ordinary items were not sorted newest-first by `statusChangeDate`; 99 paths began `/alle-boliger/` and one began `/projekt/`. All 100 sampled ordinary records were EDC sale cases with `isSold=false`, `isRented=false`, and `isSilent=false`; this is not a guarantee about other pages.

## Agreed request contract

The user accepted the following defaults after the requirements interview.

### Endpoint and parameters

Serve `GET /sitemap.xml` as UTF-8 XML. No browser interface is required.

| Parameter | Default | Proposed validation and meaning |
| --- | --- | --- |
| `inputPageSize` | `100` | Integer 1-1000; forwarded as EDC `pageSize`. The upper bound is a service policy, not a verified EDC maximum. |
| `inputPageNumber` | `1` | Positive safe integer; forwarded as EDC `pageNr`. An empty upstream page remains empty. |
| `pageSize` | `100` | Integer 1-50000; caps unique output URLs only without `maxDaysAge`. Accept `PageSize` as an alias. |
| `caseType` | `case` | Exactly `case` or `bbr`. |
| `maxDaysAge` | Absent | Positive integer, measured as a rolling period of `d * 24` hours. Replaces the output cap. |
| `dl` | `0` | Exactly `0` or `1`; `1` attaches a sitemap XML filename for download. |

Reject unknown, repeated, conflicting-alias or malformed parameters with HTTP 400 and a concise error. Validate supplied parameters even if an age window makes the output cap inactive. Reject windows too large for supported date arithmetic.

### Selection and XML

1. Obtain the selected ordinary input page from its cache entry or EDC.
2. Validate URL paths, keeping only paths on `https://www.edc.dk`. Do not add source, sold, rented or silent-status filters.
3. In BBR mode, require the `/alle-boliger/` prefix and remove a trailing segment only when it matches that record's case number. Omit paths that cannot be safely converted.
4. Apply the age window when present, evaluating it at request time even when upstream data is cached.
5. Sort by publication date descending. Keep upstream order for equal dates; records with missing or invalid dates sort last without an age filter and are excluded with one. Exclude future dates from age-window results.
6. Deduplicate final URLs, retaining the newest qualifying record for each URL.
7. Apply the output cap only when no age window is supplied.
8. Emit XML-escaped absolute URLs in a standard sitemap `urlset`, with `loc` entries only. Do not treat the publication date as proof of last page modification. Legitimately empty selections return an empty XML urlset with HTTP 200; upstream failures do not become empty successful sitemaps. Enforce sitemap protocol count and byte limits.

Timestamp policy: respect explicit offsets; interpret values without an offset in `Europe/Copenhagen`, including daylight-saving transitions. This is an assumption explicitly accepted by the user, not a verified upstream guarantee. Include the exact age cutoff. Reject impossible dates; treat ambiguous repeated local times consistently as the earlier occurrence and nonexistent local times as invalid.

### Cache and operation

- Cache raw ordinary-page data by the input page number and size. Output parameters reuse that data. Distinct input pages may each require an upstream request within the same hour.
- Configure freshness and maximum data age using Dokploy environment variables, initially 3600 and 86400 seconds. Changing them requires restarting the service; there is no public cache-control URL parameter.
- Persist page data and original fetch timestamps in a mounted data directory, writing each successful replacement atomically. Never reset the age of data on a failed refresh.
- On-demand refresh means the first request after expiry refreshes that entry. Concurrent requests for the same entry share one upstream fetch.
- Bound upstream timeouts and retry frequency after failures. Serve permitted stale data when refresh fails; return HTTP 503 when no usable cache remains. Malformed upstream responses are failures, not empty pages.
- Implementation resource bounds: retain at most 256 cached page entries, evicting oldest-written entries; allow eight distinct page operations concurrently. These are per-process controls; run one replica per cache volume.
- Expose cache status and data age in response headers and concise server logs. A small health endpoint supports container health checks.
- Use TypeScript/Node.js and Node's built-in HTTP, fetch and filesystem capabilities. Development tooling may be added; no production dependency is proposed at this stage.
- Provide a Dockerfile, persistent-volume configuration, environment example, focused tests and Dokploy setup instructions. Actual server deployment, DNS changes and Google submission remain outside the local implementation.

### Focused validation plan

Exercise URL conversion and deduplication, newest-first selection, age-window precedence and cutoff behavior, parameter validation, XML escaping and download headers, and persistent cache reuse/expiry/outage handling. Use a controlled upstream fixture for failure cases; distinguish it from a small live EDC smoke check. Check changed code files against the 300-line limit.

## External references

- [Google sitemap creation and cross-site submission](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).
- [Sitemaps protocol](https://www.sitemaps.org/protocol.html).

## Interview workflow

The requirements interview and shared-understanding confirmation are complete. Record subsequent behavior changes here and terminology changes in `CONTEXT.md`. Record an ADR only when a consequential architectural trade-off warrants it.
