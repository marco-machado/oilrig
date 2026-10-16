import { expect, test } from '@playwright/test';

// Loads the world offline from a fixed camera at each quality preset and checks that it
// actually renders: WebGPU initialises, frames advance, nothing errors, and frame time
// stays within a (deliberately generous, headless) budget.

const PRESETS = ['low', 'medium', 'high', 'ultra'] as const;

for (const q of PRESETS) {
  test(`renders cleanly at ${q} quality`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`/?offline&cam=aerial&hour=11&weather=fair&q=${q}`);
    await page.waitForFunction(() => (window as any).__oceanHome?.stats.frames > 20, undefined, { timeout: 60_000 });
    expect(await page.locator('.fatal').count()).toBe(0);
    const f0 = await page.evaluate(() => (window as any).__oceanHome.stats.frames);
    const t0 = Date.now();
    await page.waitForTimeout(4000);
    const f1 = await page.evaluate(() => (window as any).__oceanHome.stats.frames);
    const msPerFrame = (Date.now() - t0) / Math.max(1, f1 - f0);
    console.log(`${q}: ${(f1 - f0)} frames in 4 s → ${msPerFrame.toFixed(1)} ms/frame`);
    expect(f1 - f0).toBeGreaterThan(8);
    expect(msPerFrame).toBeLessThan(250);
    expect(errors).toEqual([]);
  });
}

test('the tender rides the wave heights read back from the GPU', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/?offline&cam=tender&hour=11&weather=rain&q=medium');
  await page.waitForFunction(() => (window as any).__oceanHome?.tender.state.readbacks > 30, undefined, { timeout: 60_000 });
  const samples: Array<{ heave: number; heights: number[]; readbacks: number }> = [];
  for (let i = 0; i < 24; i++) {
    samples.push(await page.evaluate(() => (window as any).__oceanHome.tender.state));
    await page.waitForTimeout(250);
  }
  // Fresh heights keep arriving.
  expect(samples.at(-1)!.readbacks - samples[0].readbacks).toBeGreaterThan(10);
  // The water under the hull moves, and the boat moves with it (heave follows the mean height).
  const heaves = samples.map((s) => s.heave);
  const means = samples.map((s) => s.heights.reduce((a, b) => a + b, 0) / s.heights.length);
  expect(Math.max(...means) - Math.min(...means)).toBeGreaterThan(0.05);
  expect(Math.max(...heaves) - Math.min(...heaves)).toBeGreaterThan(0.05);
  // Tracking error is judged against how much the water moved, not in fixed metres: the
  // hull has inertia, so in a big sea it trails by more in absolute terms.
  const swing = Math.max(...means) - Math.min(...means);
  const lag = heaves.map((h, i) => Math.abs(h - means[i]));
  expect(lag.reduce((a, b) => a + b, 0) / lag.length).toBeLessThan(0.2 * swing);
  // Heights stay physical for the sea state.
  for (const s of samples) for (const h of s.heights) expect(Math.abs(h)).toBeLessThan(6);
  expect(errors).toEqual([]);
});

test('a landing helicopter spins its rotor and kicks up spray and sea wash', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/?offline&cam=pad&hour=16&weather=fair&q=medium&heli=descend&heliT=18');
  await page.waitForFunction(() => (window as any).__oceanHome?.stats.frames > 20, undefined, { timeout: 60_000 });
  const s = await page.evaluate(() => {
    const o = (window as any).__oceanHome;
    return { visible: o.heli.group.visible, rotor: o.heli.pose.rotor, spray: o.heli.spray.strength.value, wash: o.U.washSea.value, alt: o.heli.pose.altitude };
  });
  expect(s.visible).toBe(true);
  expect(s.rotor).toBeGreaterThan(0.9);
  expect(s.alt).toBeLessThan(10);
  expect(s.spray).toBeGreaterThan(0.2);
  expect(s.wash).toBeGreaterThan(0.2);
  expect(errors).toEqual([]);
});
