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

  it('living room → bedroom (around the divider) → bath', () => {
    expectArrive(place('living-room'), [[-10, -3.5], [-15, -3.5], [-15, -9]], 'bedroom', { minY: 19.9 });
    expectArrive(place('bedroom'), [[-16.5, -7.8], [-20, -7.8], [-21, -9.5]], 'bath', { minY: 19.9 });
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
    expectArrive(place('walkway-south'), [[-19.4, 16.5], ...tower, [-12.5, 21.5], [-16, 21.8]], 'boat-landing', { minY: 2.8 });
    expectArrive(place('boat-landing'), [[-11, 21], [-7, 21], [-5, 21]], 'swim-platform', { minY: 1.1 });
  });

  it('furniture is solid: walking straight at the kitchen island stops at its edge', () => {
    // From the window side, heading south across the island towards the kitchen.
    const m = motor(sw, [3.5, 20.12, -11.3]);
    const r = walk(m, [[3.5, -6]]);
    expect(r.reached).toBe(false);
    // The island's north face is at z = -9.65; the body (radius 0.3) stops just short of it.
    expect(r.final[2]).toBeLessThan(-9.65 - 0.25);
    expect(r.final[2]).toBeGreaterThan(-10.1);
  });

  it('around the living-room sofa to the coffee table, and on to the dining table', () => {
    expectArrive(place('living-room'), [[-6.4, -7.9], [-6.6, -9.7], [-7.3, -10.6], [-6, -10.6], [-4, -7], [-1.6, -6.2]], 'dining', { minY: 19.9 });
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

  it('closed doors block the way', async () => {
    const closed = await world({});
    const m = motor(closed, place('terrace'));
    const r = walk(m, [[-6.8, 4], [-6.8, 0]]);
    expect(r.reached).toBe(false);
    expect(r.final[2]).toBeGreaterThan(2);
  });
});
