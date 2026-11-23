// `pnpm dev`: the Node server (restarted when its source changes) and Vite, together.
//
//   pnpm dev
//   ALLOW_SIGNUPS=true pnpm dev                                   any of the server's variables
//   CLIENT_PORT=5180 SERVER_PORT=8790 DATA_DIR=apps/server/data-alt pnpm dev    a second copy
//
// CLIENT_PORT is the address to open (5173). SERVER_PORT is where the server listens behind
// Vite's proxy (8787). DATA_DIR holds the database (apps/server/data, or `:memory:`).

import { type ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const clientPort = process.env.CLIENT_PORT ?? '5173';
const serverPort = process.env.SERVER_PORT ?? '8787';
const env = { ...process.env, CLIENT_PORT: clientPort, SERVER_PORT: serverPort };

const children: ChildProcess[] = [
  spawn(process.execPath, ['--watch-path=apps/server/src', '--watch-path=packages/shared/src', '--watch-preserve-output', 'apps/server/src/main.ts'], {
    cwd: root,
    env: { ...env, PORT: serverPort },
    stdio: 'inherit',
  }),
  spawn('pnpm', ['--filter', '@oilrig/client', 'exec', 'vite', '--port', clientPort, '--strictPort'], { cwd: root, env, stdio: 'inherit' }),
];

let stopping = false;
function stop(code: number) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
  // Whatever has not stopped by then is not going to.
  setTimeout(() => process.exit(code), 5000).unref();
  void Promise.all(children.map((c) => (c.exitCode !== null ? null : new Promise((r) => c.once('exit', r))))).then(() => process.exit(code));
}

for (const c of children) c.once('exit', (code) => stop(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => stop(0));
