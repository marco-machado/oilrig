import { expect, test } from '@playwright/test';

// Opt-in (PERF=1): frame time at 2560x1440 on the High preset from several viewpoints.
test.skip(!process.env.PERF, 'set PERF=1 to run');
test.use({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });

for (const cam of ['refn', 'deck', 'interior', 'aerial', 'swim']) {
  test(`High @1440p from ${cam}`, async ({ page }) => {
    await page.goto(`/?offline&cam=${cam}&hour=11&weather=fair&q=high`);
    await page.waitForFunction(() => (window as any).__oceanHome?.stats.frames > 30, undefined, { timeout: 60_000 });
    await page.waitForTimeout(1500);
    const f0 = await page.evaluate(() => (window as any).__oceanHome.stats.frames);
    const t0 = Date.now();
    await page.waitForTimeout(5000);
    const f1 = await page.evaluate(() => (window as any).__oceanHome.stats.frames);
    const fps = ((f1 - f0) * 1000) / (Date.now() - t0);
    console.log(`PERF ${cam}: ${fps.toFixed(1)} fps`);
    expect(fps).toBeGreaterThan(1);
  });
}
