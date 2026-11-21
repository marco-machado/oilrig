import { defineConfig } from '@playwright/test';

// Headless Chromium with WebGPU, using Playwright's own temporary profile. Two dev servers,
// each with its own Worker and empty Durable Object state: 5174 with sign-ups open, and
// 5175 as deployed by default (ALLOW_SIGNUPS unset).
const devServer = (port: number, env: Record<string, string>) => ({
  command: `pnpm --filter @ocean-home/client exec vite --port ${port} --strictPort`,
  url: `http://localhost:${port}`,
  env: { CF_STATE: 'off', CF_INSPECTOR_PORT: 'off', ...env },
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
  webServer: process.env.PW_BASE_URL ? undefined : [devServer(5174, { ALLOW_SIGNUPS: 'true' }), devServer(5175, {})],
});
