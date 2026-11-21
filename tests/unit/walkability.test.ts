import { beforeAll, describe, expect, it } from 'vitest';
import type { StaticWorld, Vec3 } from '@ocean-home/shared';
import { findPlace } from '@ocean-home/shared';
import { allDoorsOpen, motor, walk, world } from './helpers.ts';

// Every route is walked by the real character controller against the real colliders,
// so a missing floor, a too-tall step, a blocked doorway or a misplaced wall fails here.

let sw: StaticWorld;
beforeAll(async () => {
  sw = await world(allDoorsOpen());
});

const place = (id: string) => findPlace(id).position;

function expectArrive(start: Vec3, waypoints: Array<[number, number]>, endPlace: string, opts: { minY?: number } = {}) {
  const m = motor(sw, start);
  const r = walk(m, waypoints);
  expect(r.reached, `stuck heading to ${r.stuckAt} from ${r.final.map((v) => v.toFixed(2))}`).toBe(true);
  const target = place(endPlace);
  expect(Math.hypot(r.final[0] - target[0], r.final[2] - target[2])).toBeLessThan(0.6);
  expect(Math.abs(r.final[1] - target[1])).toBeLessThan(0.3);
  if (opts.minY !== undefined) expect(r.minY).toBeGreaterThan(opts.minY);
  return r;
}

describe('walkability', () => {
  it('terrace → living room through the south sliding door', () => {
    expectArrive(place('terrace'), [[-6.8, 4], [-6.8, 0], [-6, -5]], 'living-room', { minY: 19.9 });
  });

  it('living room → straight across the open floor to the bedroom end', () => {
    expectArrive(place('living-room'), [[-15, -9]], 'bedroom', { minY: 19.9 });
  });

  it('every side of the pavilion has a door: in through each one and out through the one opposite', () => {
    const inside: [number, number] = [-6, -5];
    const doors: Array<{ outside: [number, number]; sill: [number, number] }> = [
      { outside: [-6.8, 4], sill: [-6.8, 2] }, // south (living room)
      { outside: [3.2, 4], sill: [3.2, 2] }, // south (kitchen)
      { outside: [-6, -13.5], sill: [-6, -12] }, // north
      { outside: [10, -4.8], sill: [8, -4.8] }, // east (pool)
      { outside: [-25.6, -4], sill: [-24, -4] }, // west
    ];
    for (const d of doors) {
      const m = motor(sw, [d.outside[0], 20.05, d.outside[1]]);
      const r = walk(m, [d.sill, inside]);
      expect(r.reached, `in through the door at ${d.sill}`).toBe(true);
      expect(r.minY).toBeGreaterThan(19.9);
    }
    // Straight through the house: north door to the south door, west door to the east door.
    expect(walk(motor(sw, [-6, 20.05, -13.5]), [[-6, -12], [-6.8, 0], [-6.8, 2], [-6.8, 4]]).reached).toBe(true);
    expect(walk(motor(sw, [-25.6, 20.05, -4]), [[-24, -4], [-6, -4], [8, -4.8], [10, -4.8]]).reached).toBe(true);
  });

  it('terrace → kitchen → pool deck through the east door', () => {
    expectArrive(place('terrace'), [[3.2, 4], [3.2, 0], [3, -6]], 'kitchen', { minY: 19.9 });
    expectArrive(place('kitchen'), [[6.5, -4.8], [10, -4.8], [15, -3]], 'pool-deck', { minY: 19.9 });
  });

  it('pool deck → down the pool steps → pool floor → back out', () => {
    // The steps are at the east end; the pool sides are too tall to climb.
    const r = expectArrive(place('pool-deck'), [[20.8, -4.5], [20.8, -8], [19.6, -8], [14, -8]], 'pool');
    expect(r.minY).toBeGreaterThan(18.4);
    const m = motor(sw, place('pool'));
    const back = walk(m, [[19.6, -8], [20.8, -8], [20.8, -4.5], [15, -3]]);
    expect(back.reached, `stuck heading to ${back.stuckAt} from ${back.final.map((v) => v.toFixed(2))}`).toBe(true);
    expect(back.final[1]).toBeGreaterThan(20);
  });

  it('terrace → bridge → helipad', () => {
    expectArrive(place('terrace'), [[24, 4.5], [28.5, 0], [31, 0], [42, 0]], 'helipad', { minY: 19.7 });
  });

  it('terrace → north stair → lower walkway', () => {
    expectArrive(place('terrace'), [[-25.3, 7], [-25.3, -15.5], [3.7, -15.5], [3.7, -18.3]], 'north-stair-top', { minY: 19.8 });
    expectArrive(place('north-stair-top'), [[2.5, -18.3], [-4.5, -18.3], [-6, -16.3]], 'walkway-north', { minY: 15.8 });
  });

  it('a full lap of the lower walkway', () => {
    expectArrive(
      place('walkway-north'),
      [[-24.5, -16.3], [-24.5, 0], [-24.5, 16.5], [0, 16.5], [24.5, 16.5], [24.5, 0], [24.5, -16.3], [-6, -16.3]],
      'walkway-north',
      { minY: 15.8 },
    );
  });

  it('lower walkway → down the stair tower → boat landing → swim platform', () => {
    const tower: Array<[number, number]> = [
      [-19.4, 16.5],
      [-19.4, 18.7],
    ];
    // Five flights alternating lanes A (z 18.7) and B (z 20.0).
    for (let i = 0; i < 5; i++) {
      if (i % 2 === 0) tower.push([-14.7, 18.7], [-14.7, 20.0]);
      else tower.push([-19.4, 20.0], [-19.4, 18.7]);
    }
    tower.pop(); // the last flight ends on the landing deck, no lane change
    expectArrive(place('walkway-south'), [[-19.4, 16.5], ...tower, [-12.5, 19.3], [-16, 21.8]], 'boat-landing', { minY: 2.8 });
    // Around the north side of the elevator shaft to the swim stair.
    expectArrive(place('boat-landing'), [[-14, 19.4], [-10.5, 19.6], [-10.5, 21], [-7, 21], [-5, 21]], 'swim-platform', { minY: 1.1 });
  });

  it('furniture is solid: walking straight at a lounge sofa stops at its edge', () => {
    // From the terrace, heading west across the east lounge sofa (its back is at x ≈ -5.8).
    const m = motor(sw, [-3.5, 20.05, 11.6]);
    const r = walk(m, [[-9, 11.6]]);
    expect(r.reached).toBe(false);
    expect(r.final[0]).toBeGreaterThan(-6.3);
    expect(r.final[0]).toBeLessThan(-5.4);
  });

  it('terrace → the elevator door at the deck edge', () => {
    expectArrive(place('terrace'), [[-12.3, 15.5], [-12.3, 19.1]], 'elevator-deck', { minY: 19.9 });
  });

  it('terrace → between the outdoor sofas → firepit lounge', () => {
    expectArrive(place('terrace'), [[-7.5, 8.8], [-9, 9.4]], 'firepit', { minY: 19.9 });
  });

  it('lower walkway → hammock nets, and up onto one with a jump', () => {
    expectArrive(place('walkway-west'), [[-24.5, -16.3], [-16.5, -16.3]], 'hammocks', { minY: 15.8 });
    const m = motor(sw, place('hammocks'));
    // Face the net (north) and jump on.
    for (let i = 0; i < 40; i++) m.step({ forward: 1, right: 0, run: false, jump: i === 5, yaw: 0 }, 1 / 60);
    for (let i = 0; i < 60; i++) m.step({ forward: 0.4, right: 0, run: false, jump: false, yaw: 0 }, 1 / 60);
    expect(m.state.position[1]).toBeGreaterThan(16.3);
    expect(m.state.position[2]).toBeLessThan(-17.3);
  });

  it('jumps just as high at the browser’s 120 Hz physics step as at 60 Hz', () => {
    for (const dt of [1 / 60, 1 / 120]) {
      const m = motor(sw, place('terrace'));
      const y0 = m.state.position[1];
      let peak = y0;
      for (let t = 0; t < 1.5; t += dt) {
        m.step({ forward: 0, right: 0, run: false, jump: t === 0, yaw: 0 }, dt);
        peak = Math.max(peak, m.state.position[1]);
      }
      // v²/2g with the motor's jump speed and gravity: ~0.76 m.
      expect(peak - y0, `dt ${dt}`).toBeGreaterThan(0.65);
      expect(m.state.grounded).toBe(true);
      expect(Math.abs(m.state.position[1] - y0)).toBeLessThan(0.02);
    }
  });

  it('closed doors block the way', async () => {
    const closed = await world({});
    const m = motor(closed, place('terrace'));
    const r = walk(m, [[-6.8, 4], [-6.8, 0]]);
    expect(r.reached).toBe(false);
    expect(r.final[2]).toBeGreaterThan(2);
  });
});
