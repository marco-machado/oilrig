import { defineConfig } from '@playwright/test';

// Headless Chromium with WebGPU, using Playwright's own temporary profile.
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
  webServer: process.env.PW_BASE_URL
    ? undefined
    : {
        command: 'pnpm --filter @ocean-home/client exec vite --port 5174 --strictPort',
        url: 'http://localhost:5174',
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
