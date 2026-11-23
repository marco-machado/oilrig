import { defineConfig } from 'vitest/config';

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
        // The real server, started by each test file on a free port (tests/server/helpers.ts).
        test: {
          name: 'server',
          include: ['tests/server/**/*.test.ts'],
          testTimeout: 60_000,
          pool: 'forks',
        },
      },
    ],
  },
});
