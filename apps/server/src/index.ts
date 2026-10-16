import { configFromEnv } from './config.ts';
import { startServer } from './server.ts';

const cfg = configFromEnv();
const server = await startServer(cfg);
console.log(`[ocean-home] listening on ${cfg.host}:${server.port}${cfg.joinPassword ? ' (password required)' : ''}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void server.close().then(() => process.exit(0));
  });
}
