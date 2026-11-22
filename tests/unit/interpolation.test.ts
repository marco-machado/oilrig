import { describe, expect, it } from 'vitest';
import { InterpolationBuffer } from '@oilrig/shared';
import { mulberry } from './helpers.ts';

// A remote player walks east at 2 m/s; snapshots are stamped every 50 ms but arrive
// with jitter and out of order. Rendering trails real time by 110 ms at 60 fps.

const SPEED = 2;
const pose = (t: number) => ({ t, p: [(t / 1000) * SPEED, 0, 0] as const, yaw: 0, pitch: 0, speed: SPEED });

function run(jitterMs: number, seed: number) {
  const rand = mulberry(seed);
  const buf = new InterpolationBuffer();
  const arrivals = [];
  for (let t = 0; t <= 5000; t += 50) arrivals.push({ at: t + rand() * jitterMs, s: pose(t) });
  arrivals.sort((a, b) => a.at - b.at);
  const xs: number[] = [];
  let k = 0;
  for (let now = 0; now <= 5000; now += 1000 / 60) {
    while (k < arrivals.length && arrivals[k].at <= now) buf.push(arrivals[k++].s);
    const s = buf.sample(now - 110);
    if (s) xs.push(s.p[0]);
  }
  return xs;
}

describe('snapshot interpolation', () => {
  for (const jitter of [0, 40, 90]) {
    it(`never moves backwards and never jumps with ${jitter} ms of jitter`, () => {
      const xs = run(jitter, jitter + 1);
      expect(xs.length).toBeGreaterThan(250);
      const step = (SPEED * 1000) / 60 / 1000;
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1] - 1e-9);
        expect(xs[i] - xs[i - 1]).toBeLessThan(step * 4);
      }
    });
  }

  it('tracks the true position within one snapshot interval', () => {
    const buf = new InterpolationBuffer();
    for (let t = 0; t <= 1000; t += 50) buf.push(pose(t));
    for (let rt = 100; rt <= 950; rt += 7) {
      const s = buf.sample(rt)!;
      expect(Math.abs(s.p[0] - (rt / 1000) * SPEED)).toBeLessThan(1e-6);
    }
  });

  it('extrapolates briefly when data stops, then holds still', () => {
    const buf = new InterpolationBuffer();
    for (let t = 0; t <= 1000; t += 50) buf.push(pose(t));
    const a = buf.sample(1100)!.p[0];
    const b = buf.sample(3000)!.p[0];
    const c = buf.sample(6000)!.p[0];
    expect(a).toBeGreaterThan(2);
    expect(b).toBeLessThanOrEqual(2 + 0.15 * SPEED + 1e-9);
    expect(c).toBe(b);
  });

  it('drops samples older than what has already been shown', () => {
    const buf = new InterpolationBuffer();
    buf.push(pose(0));
    buf.push(pose(100));
    const shown = buf.sample(80)!.p[0];
    buf.push({ ...pose(50), p: [99, 0, 0] }); // stale and wildly wrong
    expect(buf.sample(90)!.p[0]).toBeGreaterThanOrEqual(shown);
    expect(buf.sample(90)!.p[0]).toBeLessThan(1);
  });
});
