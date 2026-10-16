import { expect, test } from '@playwright/test';

// Opt-in (PERF=1): frame time at 2560x1440 on the High preset from several viewpoints, with
// the in-game profiler's breakdown: GPU time per frame (WebGPU timestamp queries, on with
// ?perf), CPU time per system of the main loop, draw calls and triangles.
test.skip(!process.env.PERF, 'set PERF=1 to run');
test.use({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });

const QUALITY = process.env.PERF_QUALITY ?? 'high';

for (const cam of ['refn', 'deck', 'interior', 'aerial', 'swim', 'pad']) {
  test(`${QUALITY} @1440p from ${cam}`, async ({ page }) => {
    await page.goto(`/?offline&perf&cam=${cam}&hour=11&weather=fair&q=${QUALITY}`);
    await page.waitForFunction(() => (window as any).__oceanHome?.stats.frames > 30, undefined, { timeout: 60_000 });
    // Let shader compilation and the light probes settle, then measure a fresh window.
    await page.waitForTimeout(6000);
    const r = await page.evaluate(() => (window as any).__oceanHome.perf.report());
    const sections = r.sections.slice(0, 6).map((s: { name: string; ms: number }) => `${s.name} ${s.ms.toFixed(2)}`).join(', ');
    console.log(
      `PERF ${cam}: ${r.fps.toFixed(1)} fps · frame ${r.frameMs.avg} ms (p95 ${r.frameMs.p95}) · GPU ${r.gpu.renderMs ?? '?'} ms render + ${r.gpu.computeMs ?? '?'} ms compute · CPU ${r.cpuMs} ms [${sections}] · ${r.renderer.drawCalls} draws, ${(r.renderer.triangles / 1e6).toFixed(2)} M tris`,
    );
    expect(r.fps).toBeGreaterThan(1);
  });
}
