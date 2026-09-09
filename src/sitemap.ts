import type { Parameters } from './parameters.ts';
import type { CaseRecord } from './upstream.ts';
import { publicationDate } from './publication-date.ts';

const origin = 'https://www.edc.dk';

function caseUrl(record: CaseRecord, type: Parameters['caseType']): string | null {
  const path = record.urlPath;
  if (!path || !path.startsWith('/') || path.startsWith('//') ||
      /[\s\\\u0000-\u001f\u007f]/u.test(path)) return null;
  let url: URL;
  try { url = new URL(path, origin); } catch { return null; }
  if (url.origin !== origin || url.search || url.hash) return null;
  // Refuse normalized traversal and encoded path separators before BBR conversion.
  let decoded: string;
  try { decoded = decodeURIComponent(path); } catch { return null; }
  if (/[\\\u0000-\u001f\u007f]/u.test(decoded) || /%2f|%5c/i.test(path) ||
      decoded.split('/').some(segment => segment === '.' || segment === '..')) return null;
  if (type === 'bbr') {
    if (!url.pathname.startsWith('/alle-boliger/') || !record.caseNumber) return null;
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length < 5 || segments.at(-1) !== record.caseNumber) return null;
    segments.pop();
    url.pathname = `/${segments.join('/')}/`;
  }
  return url.href;
}

export function selectUrls(items: CaseRecord[], params: Parameters, now: number): string[] {
  const cutoff = params.maxDaysAge === null ? null : now - params.maxDaysAge * 86_400_000;
  const candidates: { url: string; date: number | null }[] = [];
  for (const item of items) {
    const url = caseUrl(item, params.caseType);
    if (!url) continue;
    const date = publicationDate(item.statusChangeDate);
    if (cutoff !== null && (date === null || date < cutoff || date > now)) continue;
    candidates.push({ url, date });
  }
  candidates.sort((a, b) => {
    if (a.date === b.date) return 0;
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return b.date - a.date;
  });
  const urls = [...new Set(candidates.map(item => item.url))];
  return params.maxDaysAge === null ? urls.slice(0, params.pageSize) : urls;
}

export function renderSitemap(urls: string[]): string {
  if (urls.length > 50000) throw new Error('Sitemap exceeds the 50,000 URL limit.');
  const escape = (text: string) => text.replace(/[&<>"']/g, character => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&apos;';
    }
  });
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(url => `  <url><loc>${escape(url)}</loc></url>\n`).join('') + '</urlset>\n';
  if (Buffer.byteLength(xml) > 50 * 1024 * 1024) {
    throw new Error('Sitemap exceeds the 50 MB limit.');
  }
  return xml;
}
