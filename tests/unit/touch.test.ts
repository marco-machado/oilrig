import { describe, expect, it } from 'vitest';
import { STICK_DEAD_ZONE, STICK_RADIUS, STICK_RUN_AT, stickVector } from '../../apps/client/src/player/stick.ts';

describe('on-screen stick', () => {
  it('stands still while the thumb rests inside the dead zone', () => {
    const s = stickVector(STICK_RADIUS * STICK_DEAD_ZONE * 0.7, -STICK_RADIUS * STICK_DEAD_ZONE * 0.7);
    expect(s.forward).toBe(0);
    expect(s.right).toBe(0);
    expect(s.run).toBe(false);
  });

  it('walks forward when dragged up the screen and right when dragged right', () => {
    const up = stickVector(0, -STICK_RADIUS);
    expect(up.forward).toBeCloseTo(1);
    expect(up.right).toBeCloseTo(0);
    const right = stickVector(STICK_RADIUS, 0);
    expect(right.right).toBeCloseTo(1);
    expect(right.forward).toBeCloseTo(0);
    const back = stickVector(0, STICK_RADIUS);
    expect(back.forward).toBeCloseTo(-1);
  });

  it('grows evenly from nothing at the dead zone to full at the ring', () => {
    let last = 0;
    for (let d = STICK_RADIUS * STICK_DEAD_ZONE; d <= STICK_RADIUS; d += 2) {
      const f = stickVector(0, -d).forward;
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
    }
    expect(stickVector(0, -STICK_RADIUS * (STICK_DEAD_ZONE + 0.001)).forward).toBeLessThan(0.01);
    expect(last).toBeGreaterThan(0.95);
  });

  it('never asks for more than full speed, in any direction and at any distance', () => {
    for (let a = 0; a < Math.PI * 2; a += 0.2) {
      for (const d of [10, 40, 56, 90, 400]) {
        const s = stickVector(Math.cos(a) * d, Math.sin(a) * d);
        expect(Math.hypot(s.forward, s.right)).toBeLessThanOrEqual(1 + 1e-9);
        expect(Math.hypot(s.knobX, s.knobY)).toBeLessThanOrEqual(STICK_RADIUS + 1e-9);
      }
    }
  });

  it('runs only when dragged well past the ring', () => {
    expect(stickVector(0, -STICK_RADIUS * 1.1).run).toBe(false);
    expect(stickVector(0, -STICK_RADIUS * (STICK_RUN_AT + 0.05)).run).toBe(true);
    expect(stickVector(STICK_RADIUS * 2, STICK_RADIUS * 2).run).toBe(true);
  });
});
