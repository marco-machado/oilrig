import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

// Opt-in (TRACE=1): records a Chromium performance trace while touring several viewpoints, then
// lists every long main-thread task and what it spent its time on (scripts/trace-report.ts).
// The trace opens in the DevTools Performance panel (Load profile).
// TRACE_CAMS=refn,deck  TRACE_SECONDS=10  TRACE_QUALITY=high  TRACE_SIZE=1800x925@2
test.skip(!process.env.TRACE, 'set TRACE=1 to run');

const [size, dpr] = (process.env.TRACE_SIZE ?? '1800x925@2').split('@');
const [width, height] = size.split('x').map(Number);
test.use({ viewport: { width, height }, deviceScaleFactor: Number(dpr ?? 1) });

const CAMS = (process.env.TRACE_CAMS ?? 'refn,deck,interior,aerial,swim,pad').split(',');
const SECONDS = Number(process.env.TRACE_SECONDS ?? 10);
const QUALITY = process.env.TRACE_QUALITY ?? 'high';

test('performance trace', async ({ browser, page }) => {
  test.setTimeout(60_000 + CAMS.length * (SECONDS + 60) * 1000);
  const dir = 'test-results/trace';
  mkdirSync(dir, { recursive: true });
  const path = `${dir}/trace-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const mark = (name: string) => page.evaluate((n) => performance.mark(`trace:${n}`), name);

  await browser.startTracing(page, {
    path,
    screenshots: true,
    categories: [
      '-*', 'devtools.timeline', 'v8.execute', 'disabled-by-default-devtools.timeline',
      'disabled-by-default-devtools.timeline.frame', 'toplevel', 'blink.console', 'blink.user_timing',
      'latencyInfo', 'disabled-by-default-devtools.timeline.stack', 'disabled-by-default-v8.cpu_profiler',
      'disabled-by-default-v8.gc', 'gpu', 'gpu.dawn',
    ],
  });
  const reports: Record<string, unknown> = {};
  for (const cam of CAMS) {
    await page.goto(`/?offline&perf&cam=${cam}&hour=11&weather=fair&q=${QUALITY}`);
    await mark(`load:${cam}`);
    await page.waitForFunction(() => (window as any).__oceanHome?.stats.frames > 30, undefined, { timeout: 60_000 });
    await mark(`run:${cam}`);
    await page.waitForTimeout(SECONDS * 1000);
    reports[cam] = await page.evaluate(() => (window as any).__oceanHome.perf.report());
    await mark(`leave:${cam}`);
  }
  await browser.stopTracing();

  for (const [cam, r] of Object.entries(reports) as [string, any][])
    console.log(`PERF ${cam}: ${r.fps.toFixed(1)} fps · p50 ${r.frameMs.p50} p95 ${r.frameMs.p95} max ${r.frameMs.max} ms · ${r.longFrames} long frames`);
  console.log(execFileSync('node', ['scripts/trace-report.ts', path], { encoding: 'utf8' }));
  console.log(`Trace: ${path}`);
  expect(Object.keys(reports)).toHaveLength(CAMS.length);
});
