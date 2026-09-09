import { resolve } from 'node:path';
import type { CachePolicy } from './cache.ts';

export interface Config {
  port: number;
  cacheDirectory: string;
  cachePolicy: CachePolicy;
  timeoutMs: number;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const number = (key: string, fallback: number, max: number) => {
    const value = env[key] ?? String(fallback);
    const parsed = Number(value);
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(parsed) || parsed > max) {
      throw new Error(`${key} must be a positive integer no greater than ${max}.`);
    }
    return parsed;
  };
  const freshMs = number('CACHE_TTL_SECONDS', 3600, 31_536_000) * 1000;
  const maxAgeMs = number('CACHE_MAX_AGE_SECONDS', 86400, 31_536_000) * 1000;
  if (maxAgeMs < freshMs) throw new Error('CACHE_MAX_AGE_SECONDS must be at least CACHE_TTL_SECONDS.');
  if (env.CACHE_DIR === '') throw new Error('CACHE_DIR must not be empty.');
  return {
    port: number('PORT', 3000, 65535),
    cacheDirectory: resolve(env.CACHE_DIR ?? './data'),
    cachePolicy: { freshMs, maxAgeMs,
      retryMs: number('UPSTREAM_RETRY_SECONDS', 60, 3600) * 1000 },
    timeoutMs: number('UPSTREAM_TIMEOUT_SECONDS', 15, 120) * 1000,
  };
}
