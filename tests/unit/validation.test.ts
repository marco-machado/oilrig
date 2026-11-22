import { beforeAll, describe, expect, it } from 'vitest';
import { DIMS, ElevatorController, type MoveInput, PLAYER, type StaticWorld, type Vec3, findPlace, gateOpen, inCar } from '@oilrig/shared';
import { MovementValidator, type Verdict } from '../../apps/server/src/world/validation.ts';
import { DT, allDoorsOpen, idle, makeWorld, motor, walk, who, world } from './helpers.ts';

let sw: StaticWorld;
let v: MovementValidator;

beforeAll(async () => {
  sw = await world({});
  v = new MovementValidator(sw);
});

const TERRACE: Vec3 = findPlace('terrace').position;
/** Open deck east of the firepit lounge, clear of furniture for 20 m. */
const OPEN: Vec3 = [-6, 20.05, 7];

type Step = { yaw: number; seconds: number; run?: boolean; jump?: boolean; forward?: number };

/** Records the real controller's trajectory as 20 Hz pose packets. */
function trajectory(start: Vec3, steps: Step[], world = sw) {
  const m = motor(world, start);
  const out: Vec3[] = [m.state.position];
  let acc = 0;
  for (const s of steps) {
    const n = Math.round(s.seconds / DT);
    for (let i = 0; i < n; i++) {
      const input: MoveInput = { forward: s.forward ?? 1, right: 0, run: !!s.run, jump: !!s.jump && i === 0, yaw: s.yaw };
      m.step(input, DT);
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

/** Feeds poses to the validator the way the world does: `at(i)` is when pose i arrives (ms).
 * Returns the verdicts and where the server ends up believing the person is. */
function replay(points: Vec3[], at: (i: number) => number = (i) => i * 50, val = v) {
  let track = val.start(points[0], at(0));
  const verdicts: Verdict[] = [];
  let peak = points[0][1];
  for (let i = 1; i < points.length; i++) {
    const r = val.check(track, points[i], at(i));
    verdicts.push(r);
    if (!r.ok && r.reason === 'unsupported') track = val.start(r.to, at(i));
    peak = Math.max(peak, track.p[1]);
  }
  return { verdicts, rejected: verdicts.filter((r) => !r.ok), end: track.p, peak };
}

/** A cheat's path: `n` steps of `step` from `start`, each from wherever the last one aimed. */
function line(start: Vec3, step: Vec3, n: number): Vec3[] {
  return Array.from({ length: n + 1 }, (_, i) => [start[0] + step[0] * i, start[1] + step[1] * i, start[2] + step[2] * i] as Vec3);
}

/** Poses that pile up behind a stalled connection and arrive together, `every` at a time. */
const bursts = (every: number) => (i: number) => Math.ceil(i / every) * every * 50;

describe('movement validation: honest movement', () => {
  it('accepts a run across the terrace', () => {
    expect(replay(trajectory(TERRACE, [{ yaw: Math.PI / 2, seconds: 3, run: true }])).rejected).toEqual([]);
  });

  it('accepts climbing the north stair at a run', () => {
    const pts = trajectory([-4.5, 16, -18.3], [{ yaw: -Math.PI / 2, seconds: 3, run: true }]);
    expect(pts[pts.length - 1][1]).toBeGreaterThan(19.9); // the climb really happened
    expect(replay(pts).rejected).toEqual([]);
  });

  it('accepts a running jump, and jumps one after another', () => {
    const pts = trajectory(TERRACE, [{ yaw: 0.3, seconds: 0.4, run: true }, { yaw: 0.3, seconds: 1.2, run: true, jump: true }]);
    expect(Math.max(...pts.map((p) => p[1]))).toBeGreaterThan(20.5); // airborne
    expect(replay(pts).rejected).toEqual([]);
    const hops = trajectory(OPEN, Array.from({ length: 6 }, () => ({ yaw: -Math.PI / 2, seconds: 0.75, run: true, jump: true })));
    expect(replay(hops).rejected).toEqual([]);
  });

  it('accepts the same run, stair and jump when poses arrive in bursts after a stall', () => {
    const run = trajectory(OPEN, [{ yaw: -Math.PI / 2, seconds: 3, run: true }]);
    const stair = trajectory([-4.5, 16, -18.3], [{ yaw: -Math.PI / 2, seconds: 3, run: true }]);
    const jump = trajectory(OPEN, [{ yaw: -Math.PI / 2, seconds: 0.4, run: true }, { yaw: -Math.PI / 2, seconds: 1.2, run: true, jump: true }]);
    for (const every of [4, 8]) {
      expect(replay(run, bursts(every)).rejected).toEqual([]);
      expect(replay(stair, bursts(every)).rejected).toEqual([]);
      expect(replay(jump, bursts(every)).rejected).toEqual([]);
    }
  });

  it('accepts the long routes at a run: stairs, the pool steps, the bridge, the tower down to the sea', async () => {
    const open = await world(allDoorsOpen());
    const val = new MovementValidator(open);
    const place = (id: string) => findPlace(id).position;
    const tower: Array<[number, number]> = [[-19.4, 16.5], [-19.4, 18.7]];
    for (let i = 0; i < 5; i++) {
      if (i % 2 === 0) tower.push([-14.7, 18.7], [-14.7, 20.0]);
      else tower.push([-19.4, 20.0], [-19.4, 18.7]);
    }
    tower.pop();
    const routes: Array<[Vec3, Array<[number, number]>]> = [
      [place('terrace'), [[-6.8, 4], [-6.8, 0], [-6, -5], [-15, -9]]],
      [place('kitchen'), [[6.5, -4.8], [10, -4.8], [15, -3], [20.8, -4.5], [20.8, -8], [19.6, -8], [14, -8], [19.6, -8], [20.8, -8], [20.8, -4.5]]],
      [place('terrace'), [[24, 4.5], [28.5, 0], [31, 0], [42, 0]]],
      [place('terrace'), [[-25.3, 7], [-25.3, -15.5], [3.7, -15.5], [3.7, -18.3], [2.5, -18.3], [-4.5, -18.3], [-6, -16.3]]],
      [place('walkway-north'), [[-24.5, -16.3], [-24.5, 0], [-24.5, 16.5], [0, 16.5], [24.5, 16.5], [24.5, 0], [24.5, -16.3], [-6, -16.3]]],
      [place('walkway-south'), [[-19.4, 16.5], ...tower, [-12.5, 19.3], [-16, 21.8], [-14, 19.4], [-10.5, 19.6], [-10.5, 21], [-7, 21], [-5, 21]]],
    ];
    for (const [start, waypoints] of routes) {
      for (const run of [true, false]) {
        const m = motor(open, start);
        const pts: Vec3[] = [m.state.position];
        let n = 0;
        for (const [tx, tz] of waypoints) {
          for (let i = 0; i < 40 / DT; i++) {
            const [x, , z] = m.state.position;
            if (Math.hypot(tx - x, tz - z) < 0.25) break;
            m.step({ forward: 1, right: 0, run, jump: false, yaw: Math.atan2(-(tx - x), -(tz - z)) }, DT);
            if (++n % 3 === 0) pts.push(m.state.position);
          }
        }
        const last = waypoints.at(-1)!;
        expect(Math.hypot(m.state.position[0] - last[0], m.state.position[2] - last[1]), `route to ${last}`).toBeLessThan(0.3);
        m.dispose();
        expect(replay(pts, undefined, val).rejected, `route to ${last}`).toEqual([]);
        expect(replay(pts, bursts(6), val).rejected, `route to ${last}, in bursts`).toEqual([]);
      }
    }
  });

  it('accepts a long fall, running forward all the way down', () => {
    // Dropped from 8 m above the deck (the rails keep anyone from walking off an edge).
    const pts = trajectory([OPEN[0], OPEN[1] + 8, OPEN[2]], [{ yaw: -Math.PI / 2, seconds: 2.5, run: true }]);
    expect(pts[0][1]).toBeGreaterThan(OPEN[1] + 5);
    expect(pts.at(-1)![1]).toBeCloseTo(OPEN[1], 1); // landed
    expect(replay(pts).rejected).toEqual([]);
    expect(replay(pts, bursts(4)).rejected).toEqual([]);
  });

  it('accepts a jump onto a hammock net and standing on it', () => {
    const m = motor(sw, findPlace('hammocks').position);
    const out: Vec3[] = [m.state.position];
    // Face the net (north) and jump on, as the walkability test does.
    for (let i = 0; i < 160; i++) {
      m.step({ forward: i < 40 ? 1 : i < 100 ? 0.4 : 0, right: 0, run: false, jump: i === 5, yaw: 0 }, DT);
      if (i % 3 === 2) out.push(m.state.position);
    }
    m.dispose();
    expect(out.at(-1)![1]).toBeGreaterThan(16.3); // up on the net
    expect(replay(out).rejected).toEqual([]);
  });

  it('accepts a ride in the elevator, down and back up, seen 150 ms late', async () => {
    const E = DIMS.ELEVATOR;
    const lift = await world({});
    const riderView = await world({});
    const c = new ElevatorController(0);
    const sync = (w: StaticWorld, now: number) => {
      const p = c.pose(now);
      w.setElevator(p.y, E.stops.map((_, i) => gateOpen(p, i)));
      return p;
    };
    sync(lift, 0);
    sync(riderView, 0);
    const doorX = (E.door.x0 + E.door.x1) / 2;
    const m = motor(riderView, findPlace('elevator-deck').position);
    expect(walk(m, [[doorX, E.z0 - 0.3], [doorX, (E.z0 + E.z1) / 2]]).reached).toBe(true);
    // The rider's browser moves with the car; the server's car is `late` ms further on.
    const val = new MovementValidator(lift);
    const late = 150;
    let track = val.start(m.state.position, late);
    const rejected: Verdict[] = [];
    let now = 0;
    let carY = c.pose(0).y;
    for (const stop of [0, 1]) {
      c.call(stop, now);
      for (let i = 0; i < 25 / DT; i++) {
        now += DT * 1000;
        c.update(now);
        const p = sync(riderView, now);
        if (inCar(carY, m.state.position)) m.ride(p.y - carY);
        carY = p.y;
        m.step(idle(Math.PI), DT);
        if (i % 3 !== 2) continue;
        sync(lift, now + late);
        const r = val.check(track, m.state.position, now + late);
        if (!r.ok) rejected.push(r);
        if (!r.ok && r.reason === 'unsupported') track = val.start(r.to, now + late);
      }
      expect(m.state.position[1]).toBeCloseTo(E.stops[stop], 1);
    }
    expect(rejected).toEqual([]);
    m.dispose();
  });
});

describe('movement validation: cheats', () => {
  it('rejects a teleport', () => {
    expect(v.check(v.start(OPEN, 0), [OPEN[0], OPEN[1], OPEN[2] - 6], 50)).toEqual({ ok: false, reason: 'too-fast' });
  });

  it('holds a speed hack on open deck to a run, however fast the poses are sent', () => {
    // 12 m/s at the normal 20 poses a second, then 38 m/s at 40 a second.
    for (const [step, ms] of [[0.6, 50], [0.95, 25]] as const) {
      const seconds = 3;
      const n = (seconds * 1000) / ms;
      let track = v.start(OPEN, 0);
      let aim: Vec3 = OPEN;
      let refused = 0;
      for (let i = 1; i <= n; i++) {
        // The cheat keeps pushing east from wherever the server last left it.
        aim = [track.p[0] + step, OPEN[1], OPEN[2]];
        if (!v.check(track, aim, i * ms).ok) refused++;
      }
      const speed = (track.p[0] - OPEN[0]) / seconds;
      expect(refused).toBeGreaterThan(n / 4);
      expect(speed).toBeLessThan(PLAYER.runSpeed * 1.2 + 4.5 / seconds + 0.01);
    }
  });

  it('rejects flying straight up, in one go or a metre at a time', () => {
    expect(v.check(v.start(OPEN, 0), [OPEN[0], 23, OPEN[2]], 100)).toEqual({ ok: false, reason: 'too-high' });
    for (const [step, ms] of [[0.9, 50], [1, 25]] as const) {
      const r = replay(line(OPEN, [0, step, 0], 80), (i) => i * ms);
      // The server never believes more than a jump above the deck.
      expect(r.peak).toBeLessThan(OPEN[1] + 1.3);
      expect(r.rejected.length).toBeGreaterThan(70);
    }
  });

  it('rejects hovering: someone held in mid-air is put back on the ground', () => {
    // Up to the top of a jump honestly, then staying there.
    const up = trajectory(OPEN, [{ yaw: 0, seconds: 0.3, jump: true, forward: 0 }]);
    const top = up.at(-1)!;
    expect(top[1]).toBeGreaterThan(OPEN[1] + 0.6);
    const r = replay([...up, ...Array.from({ length: 60 }, () => top)]);
    const first = r.verdicts.findIndex((x) => !x.ok);
    expect(first).toBeGreaterThan(up.length - 2); // the jump itself was fine
    expect(first * 50).toBeLessThan(1500); // and the hover lasted about a second at most
    // Each time, it is put back down on the deck itself.
    const downs = r.rejected.filter((x) => !x.ok && x.reason === 'unsupported');
    expect(downs.length).toBeGreaterThan(1);
    for (const d of downs) expect(d).toMatchObject({ to: [expect.closeTo(OPEN[0], 2), expect.closeTo(OPEN[1], 2), expect.closeTo(OPEN[2], 2)] });
  });

  it('rejects walking on air out over the sea', () => {
    // South from just beyond the swim platform's rail, over open water, level, at a walk.
    const start: Vec3 = [-5, DIMS.SWIM.top, DIMS.SWIM.z1 + 1];
    expect(v.groundUnder(start)).toBeNull();
    const r = replay(line(start, [0, 0, 0.15], 200));
    expect(r.rejected.some((x) => !x.ok && x.reason === 'unsupported')).toBe(true);
    // The furthest the server ever believed: a jump's length past the edge, not 30 m.
    expect(r.end[2]).toBeLessThan(DIMS.SWIM.z1 + 7);
  });

  it('does not take a wall for ground: no climbing up the pavilion glass', () => {
    // Pressed against the outside of the south glass, rising 0.2 m per pose.
    const foot: Vec3 = [-3, 20.05, 2.72];
    expect(v.blocked(foot)).toBe(false);
    const r = replay(line(foot, [0, 0.2, 0], 60));
    expect(r.peak).toBeLessThan(foot[1] + 1.3);
  });

  it('rejects walking through a closed sliding door, and allows it once open', async () => {
    const from: Vec3 = [-6.8, 20.06, 2.7];
    const to: Vec3 = [-6.8, 20.12, 1.4];
    expect(v.check(v.start(from, 0), to, 300)).toEqual({ ok: false, reason: 'through-wall' });
    const open = new MovementValidator(await world({ 'door-south-1': true }));
    expect(open.check(open.start(from, 0), to, 300)).toEqual({ ok: true });
  });

  it('rejects stepping through the deck rail, and standing inside a wall', () => {
    expect(v.check(v.start([0, 20, 19.4], 0), [0, 20, 20.6], 300).ok).toBe(false);
    expect(v.check(v.start([-6.8, 20.05, 4], 0), [-6.8, 20.1, 2.07], 1000)).toEqual({ ok: false, reason: 'inside-geometry' });
  });
});

describe('movement validation in the world', () => {
  it('a hovering player is corrected to the ground, and walks on from there', async () => {
    const w = await makeWorld();
    const got: Array<{ type: string; p?: Vec3; reason?: string }> = [];
    const conn = { send: (m: never) => got.push(m), sendRaw: () => undefined, close: () => undefined };
    const p = w.join(conn as never, who('Hover'));
    const t0 = Date.now();
    const at = p.pose.p;
    const pose = (pos: Vec3, seq: number) => ({ type: 'pose' as const, seq, p: pos, v: [0, 0, 0] as Vec3, yaw: 0, pitch: 0, grounded: false });
    const real = Date.now;
    try {
      let seq = 0;
      const up: Vec3 = [at[0], at[1] + 0.7, at[2]];
      for (let i = 1; i <= 60; i++) {
        Date.now = () => t0 + i * 50;
        w.handle(conn as never, p, pose(up, seq++));
      }
      const down = got.findLast((m) => m.type === 'correct' && m.reason === 'unsupported');
      expect(down?.p?.[1]).toBeCloseTo(at[1], 1);
      // Stop cheating: the next pose is on the deck.
      Date.now = () => t0 + 3000;
      w.handle(conn as never, p, pose([at[0], at[1], at[2]], seq++));
      expect(p.pose.p[1]).toBeCloseTo(at[1], 1);
      // Honest steps from where the server put them are accepted again.
      const before = got.length;
      const ground = p.pose.p;
      for (let i = 1; i <= 10; i++) {
        Date.now = () => t0 + 3000 + i * 50;
        w.handle(conn as never, p, pose([ground[0] + i * 0.15, ground[1], ground[2]], seq++));
      }
      expect(got.length).toBe(before);
      expect(p.pose.p[0]).toBeCloseTo(ground[0] + 1.5, 5);
    } finally {
      Date.now = real;
      w.stop();
    }
  });
});
