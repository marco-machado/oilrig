import { resolve } from 'node:path';
import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';
import { workerWasm } from '../server/vite-wasm.ts';

// `vite dev` runs the Worker and its Durable Objects in workerd next to the client.
// In dev only, the Worker's vars (ALLOW_SIGNUPS, DRONE_STAY_MINUTES, …) can be overridden
// from the environment, and CLIENT_PORT / CF_STATE / CF_INSPECTOR_PORT let a second copy run
// beside the default one (CF_STATE: a directory for its data, or "off" to keep nothing;
// CF_INSPECTOR_PORT: a port, or "off").

export default defineConfig(({ command }) => ({
  plugins: [
    cloudflare({
      configPath: '../server/wrangler.jsonc',
      persistState: process.env.CF_STATE === 'off' ? false : process.env.CF_STATE ? { path: process.env.CF_STATE } : true,
      inspectorPort: process.env.CF_INSPECTOR_PORT === 'off' ? false : process.env.CF_INSPECTOR_PORT ? Number(process.env.CF_INSPECTOR_PORT) : undefined,
      config:
        command === 'serve'
          ? (c) => ({ vars: { ...c.vars, ...Object.fromEntries(Object.keys(c.vars ?? {}).flatMap((k) => (process.env[k] === undefined ? [] : [[k, process.env[k]!]]))) } })
          : undefined,
    }),
    workerWasm(),
  ],
  server: {
    port: Number(process.env.CLIENT_PORT ?? 5173),
  },
  environments: {
    client: {
      build: {
        target: 'es2024',
        chunkSizeWarningLimit: 6000,
        // The game, the standalone object viewer (/viewer.html) and the sign-up page.
        rolldownOptions: {
          input: {
            main: resolve(import.meta.dirname, 'index.html'),
            viewer: resolve(import.meta.dirname, 'viewer.html'),
            signup: resolve(import.meta.dirname, 'signup.html'),
          },
          // Rapier inlines its WASM as ~4 MB of base64: a chunk of its own keeps that cached
          // across deploys instead of riding along with every change to the game's code.
          output: {
            codeSplitting: {
              groups: [{ name: 'rapier', test: /[\\/]@dimforge[\\/]rapier3d-compat[\\/]/ }],
            },
          },
        },
      },
    },
  },
}));
