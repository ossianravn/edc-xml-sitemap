import type { InputPage } from './parameters.ts';

export interface CaseRecord {
  urlPath: string | null;
  caseNumber: string | null;
  statusChangeDate: string | null;
}

export class UpstreamError extends Error {}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function decodeItems(value: unknown): CaseRecord[] {
  if (!Array.isArray(value) || value.length > 1000) {
    throw new UpstreamError('EDC returned an invalid items array.');
  }
  return value.map((item: unknown) => {
    if (!isObject(item)) throw new UpstreamError('EDC returned an invalid case record.');
    const field = (name: string): string | null => {
      const content = item[name];
      if (content === undefined || content === null) return null;
      if (typeof content !== 'string') {
        throw new UpstreamError(`EDC returned an invalid ${name} field.`);
      }
      return content;
    };
    return { urlPath: field('urlPath'), caseNumber: field('caseNumber'),
      statusChangeDate: field('statusChangeDate') };
  });
}

export function createEdcLoader(timeoutMs: number, fetcher: typeof fetch = fetch) {
  return async (input: InputPage): Promise<CaseRecord[]> => {
    const url = new URL('https://www.edc.dk/api/v1/cases/quick-search');
    url.search = new URLSearchParams({ 'c-gruppe': 'Private',
      pageNr: String(input.inputPageNumber), pageSize: String(input.inputPageSize) }).toString();
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error', headers: { Accept: 'application/json' } });
      if (!response.ok) {
        await response.body?.cancel();
        throw new UpstreamError(`EDC returned HTTP ${response.status}.`);
      }
      if (!response.body) throw new UpstreamError('EDC returned no response body.');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 32 * 1024 * 1024) {
          await reader.cancel();
          throw new UpstreamError('EDC response exceeded the size limit.');
        }
        chunks.push(value);
      }
      const payload: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!isObject(payload) || payload.currentPage !== input.inputPageNumber ||
          payload.itemsPerPage !== input.inputPageSize) {
        throw new UpstreamError('EDC returned unexpected pagination metadata.');
      }
      const items = decodeItems(payload.items);
      if (items.length > input.inputPageSize) {
        throw new UpstreamError('EDC returned more items than the requested page size.');
      }
      return items;
    } catch (error) {
      if (error instanceof UpstreamError) throw error;
      throw new UpstreamError('EDC request failed, timed out, or returned invalid JSON.');
    }
  };
}
