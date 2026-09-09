export class RequestError extends Error {}

export interface InputPage {
  inputPageSize: number;
  inputPageNumber: number;
}

export interface Parameters extends InputPage {
  pageSize: number;
  caseType: 'case' | 'bbr';
  maxDaysAge: number | null;
  download: boolean;
}

const allowed = new Set([
  'inputPageSize', 'inputPageNumber', 'pageSize', 'PageSize',
  'caseType', 'maxDaysAge', 'dl',
]);

function integer(value: string, name: string, maximum: number): number {
  const number = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(number) || number > maximum) {
    throw new RequestError(`${name} must be an integer from 1 to ${maximum}.`);
  }
  return number;
}

export function parseParameters(query: URLSearchParams): Parameters {
  for (const key of query.keys()) {
    if (!allowed.has(key)) throw new RequestError(`Unknown parameter: ${key}.`);
    if (query.getAll(key).length !== 1) {
      throw new RequestError(`Parameter ${key} must occur only once.`);
    }
  }
  if (query.has('pageSize') && query.has('PageSize')) {
    throw new RequestError('Supply pageSize or PageSize, not both.');
  }
  const caseType = query.get('caseType') ?? 'case';
  if (caseType !== 'case' && caseType !== 'bbr') {
    throw new RequestError('caseType must be case or bbr.');
  }
  const dl = query.get('dl') ?? '0';
  if (dl !== '0' && dl !== '1') throw new RequestError('dl must be 0 or 1.');
  return {
    inputPageSize: integer(query.get('inputPageSize') ?? '100', 'inputPageSize', 1000),
    inputPageNumber: integer(
      query.get('inputPageNumber') ?? '1', 'inputPageNumber', Number.MAX_SAFE_INTEGER,
    ),
    pageSize: integer(query.get('pageSize') ?? query.get('PageSize') ?? '100', 'pageSize', 50000),
    caseType,
    maxDaysAge: query.has('maxDaysAge')
      ? integer(query.get('maxDaysAge')!, 'maxDaysAge', 100_000_000) : null,
    download: dl === '1',
  };
}
