import { beforeAll, describe, expect, it } from 'vitest';
import { type StaticWorld, type Vec3, findPlace } from '@oilrig/shared';
import { MovementValidator } from '../../apps/server/src/world/validation.ts';
import { DT, motor, world } from './helpers.ts';

let sw: StaticWorld;
let v: MovementValidator;

beforeAll(async () => {
  sw = await world({});
  v = new MovementValidator(sw);
});

/** Records the real controller's trajectory as 20 Hz pose packets. */
function trajectory(start: Vec3, steps: Array<{ yaw: number; seconds: number; run?: boolean; jump?: boolean }>) {
  const m = motor(sw, start);
  const out: Vec3[] = [m.state.position];
  let acc = 0;
  for (const s of steps) {
    const n = Math.round(s.seconds / DT);
    for (let i = 0; i < n; i++) {
      m.step({ forward: 1, right: 0, run: !!s.run, jump: !!s.jump && i === 0, yaw: s.yaw }, DT);
      acc += DT;
      if (acc >= 0.05 - 1e-9) {
        acc = 0;
        out.push(m.state.position);
      }
    }
  }
  m.dispose();
  return out;
}

function replay(points: Vec3[], intervalMs = 50) {
  let prev = { p: points[0], t: 0 };
  const verdicts = [];
  for (let i = 1; i < points.length; i++) {
    const now = i * intervalMs;
    const r = v.check(prev, points[i], now);
    verdicts.push(r);
    if (r.ok) prev = { p: points[i], t: now };
  }
  return verdicts;
}

describe('movement validation', () => {
  it('accepts an honest run across the terrace', () => {
    const rejected = replay(trajectory(findPlace('terrace').position, [{ yaw: Math.PI / 2, seconds: 3, run: true }])).filter((r) => !r.ok);
    expect(rejected).toEqual([]);
  });

  it('accepts climbing the north stair at a run', () => {
    const pts = trajectory([-4.5, 16, -18.3], [{ yaw: -Math.PI / 2, seconds: 3, run: true }]);
    expect(pts[pts.length - 1][1]).toBeGreaterThan(19.9); // the climb really happened
    expect(replay(pts).filter((r) => !r.ok)).toEqual([]);
  });

  it('accepts a running jump', () => {
    const pts = trajectory(findPlace('terrace').position, [{ yaw: 0.3, seconds: 0.4, run: true }, { yaw: 0.3, seconds: 1.2, run: true, jump: true }]);
    expect(Math.max(...pts.map((p) => p[1]))).toBeGreaterThan(20.5); // airborne
    expect(replay(pts).filter((r) => !r.ok)).toEqual([]);
  });

  it('rejects a teleport', () => {
    const r = v.check({ p: [-6, 20.05, 7], t: 0 }, [-6, 20.05, 1], 50);
    expect(r).toEqual({ ok: false, reason: 'too-fast' });
  });

  it('rejects sustained speed hacking', () => {
    const pts: Vec3[] = [];
    for (let i = 0; i < 40; i++) pts.push([-20 + i * 0.6, 20.06, 10]); // 12 m/s
    const verdicts = replay(pts);
    expect(verdicts.filter((r) => !r.ok).length).toBeGreaterThan(30);
  });

  it('rejects flying straight up', () => {
    const r = v.check({ p: [-6, 20.05, 7], t: 0 }, [-6, 23, 7], 100);
    expect(r).toEqual({ ok: false, reason: 'too-high' });
  });

  it('rejects walking through a closed sliding door, and allows it once open', async () => {
    const from: Vec3 = [-6.8, 20.06, 2.7];
    const to: Vec3 = [-6.8, 20.12, 1.4];
    expect(v.check({ p: from, t: 0 }, to, 300)).toEqual({ ok: false, reason: 'through-wall' });
    const open = await world({ 'door-south-1': true });
    expect(new MovementValidator(open).check({ p: from, t: 0 }, to, 300)).toEqual({ ok: true });
  });

  it('rejects stepping through the deck rail, and standing inside a wall', () => {
    expect(v.check({ p: [0, 20, 19.4], t: 0 }, [0, 20, 20.6], 300).ok).toBe(false);
    expect(v.check({ p: [-6, 20.05, 7], t: 0 }, [-6.8, 20.1, 2.07], 1000)).toEqual({ ok: false, reason: 'inside-geometry' });
  });
});
