import { readConfig } from './config.ts';
import { CacheStore } from './cache-store.ts';
import { PageCache } from './cache.ts';
import { createEdcLoader } from './upstream.ts';
import { createSitemapServer } from './server.ts';
import type { Log } from './cache-store.ts';

const log: Log = (event, details) => {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...details }));
};

try {
  const config = readConfig();
  const store = new CacheStore(config.cacheDirectory, log);
  await store.initialize();
  const cache = new PageCache(store, config.cachePolicy, createEdcLoader(config.timeoutMs), log);
  const server = createSitemapServer(cache, log);
  server.on('error', () => {
    log('server_failed', { reason: 'Unable to listen on the configured port.' });
    process.exitCode = 1;
  });
  server.listen(config.port, '0.0.0.0', () => log('listening', { port: config.port }));
  const stop = () => {
    server.close(() => process.exit());
    setTimeout(() => process.exit(1), 20_000).unref();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
} catch (error) {
  log('startup_failed', { reason: error instanceof Error && !('code' in error)
    ? error.message : 'Unable to initialize the cache directory.' });
  process.exitCode = 1;
}
