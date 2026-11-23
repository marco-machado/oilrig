import { serverConfig } from './config.ts';
import { startServer } from './server.ts';

const cfg = serverConfig();
const server = await startServer(cfg);
console.log(`[oilrig] listening on ${cfg.host}:${server.port}${cfg.signupsOpen ? ' (sign-ups open)' : ''}`);

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(1);
    stopping = true;
    server.close().then(
      () => process.exit(0),
      (err) => {
        console.error('[oilrig] shutdown failed', err);
        process.exit(1);
      },
    );
  });
}
