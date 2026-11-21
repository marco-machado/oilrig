import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { workerWasm } from './apps/server/vite-wasm.ts';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          testTimeout: 120_000,
          pool: 'forks',
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './apps/server/wrangler.jsonc' },
            miniflare: {
              // Sign-ups open; the drone stays away (off the pad) for the whole run.
              bindings: { ALLOW_SIGNUPS: 'true', WEATHER_SEED: '5', DRONE_START_AWAY: 'true', DRONE_FIRST_ARRIVAL_MINUTES: '1440' },
            },
          }),
          workerWasm(),
        ],
        test: {
          name: 'workers',
          include: ['tests/workers/**/*.test.ts'],
          testTimeout: 60_000,
        },
      },
    ],
  },
});
