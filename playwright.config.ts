import { defineConfig } from '@playwright/test';

// Headless Chromium with WebGPU, using Playwright's own temporary profile. Two dev servers
// (`pnpm dev`), each with an empty in-memory database: 5174 with sign-ups open, and 5175 as
// deployed by default (sign-ups closed).
const devServer = (port: number, serverPort: number, signups: boolean) => ({
  command: 'node scripts/dev.ts',
  // Ready once Vite passes requests on to a server that answers.
  url: `http://localhost:${port}/healthz`,
  env: { CLIENT_PORT: String(port), SERVER_PORT: String(serverPort), DATA_DIR: ':memory:', ALLOW_SIGNUPS: String(signups) },
  reuseExistingServer: true,
  timeout: 60_000,
});

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.PW_BASE_URL ?? 'http://localhost:5174',
    channel: 'chrome',
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
    },
  },
  webServer: process.env.PW_BASE_URL ? undefined : [devServer(5174, 8774, true), devServer(5175, 8775, false)],
});
