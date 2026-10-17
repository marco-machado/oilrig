import { describe, expect, it } from 'vitest';
import {
  DIMS,
  DRONE_SAFE_Y,
  DRONE_TIMING,
  type DronePhase,
  DroneAutopilot,
  DroneFlight,
  DroneScheduler,
  type ServerMessage,
  PAD_YAW,
  type StaticWorld,
  type Vec3,
  droneClearPath,
  dronePose,
} from '@ocean-home/shared';
import { DT, idle, makeWorld, motor, walk, world as staticWorld } from './helpers.ts';

// The drone is a schedule plus a pure pose function when nobody flies it, and a flight model
// run by the pilot's browser when someone does. These tests fly it in simulated time and check
// what an observer would notice: where it lands, that it never jumps, dips into the deck or
// skims the sea, that it waits for a clear pad, that it is solid while parked, and that people
// can board it, fly it, land it somewhere else and climb out.

const PAD = DIMS.DRONE.pad;
const STEP = 100;

function fly(sched: DroneScheduler, from: number, ms: number, each?: (now: number) => void) {
  const phases: DronePhase[] = [sched.state.phase];
  for (let now = from; now <= from + ms; now += STEP) {
    sched.update(now);
    if (phases[phases.length - 1] !== sched.state.phase) phases.push(sched.state.phase);
    each?.(now);
  }
  return phases;
}

const opts = { intervalMs: 10 * 60_000, stayMs: 2 * 60_000, firstArrivalMs: 1000, seed: 1 };

/** A fake browser connection that records what the server sends. */
function connection() {
  const got: ServerMessage[] = [];
  return {
    got,
    conn: { send: (m: ServerMessage) => got.push(m), sendRaw: (j: string) => got.push(JSON.parse(j)), close: () => undefined },
    last<T extends ServerMessage['type']>(type: T) {
      return [...got].reverse().find((m) => m.type === type) as Extract<ServerMessage, { type: T }> | undefined;
    },
  };
}

describe('drone schedule', () => {
  it('arrives, lands on the pad, spins down, spins up and leaves, moving smoothly throughout', () => {
    const t0 = 1_000_000;
    const s = new DroneScheduler(opts, t0);
    let prev: Vec3 | null = null;
    let maxJump = 0;
    let lowestOverPad = Infinity;
    let lowestElsewhere = Infinity;
    let landedAt: Vec3 | null = null;
    let minRotorLanded = 1;
    let rotorAtLiftoff = 0;
    let climbedBeforeLeaving = true;
    const phases = fly(s, t0, 6 * 60_000, (now) => {
      const p = dronePose(s.state, now);
      if (!p.visible) {
        prev = null;
        return;
      }
      if (prev) maxJump = Math.max(maxJump, Math.hypot(p.position[0] - prev[0], p.position[1] - prev[1], p.position[2] - prev[2]));
      prev = p.position;
      const overPad = Math.abs(p.position[0] - PAD[0]) < 10 && Math.abs(p.position[2] - PAD[2]) < 10;
      if (overPad) lowestOverPad = Math.min(lowestOverPad, p.position[1]);
      else lowestElsewhere = Math.min(lowestElsewhere, p.position[1]);
      if (s.state.phase === 'depart' && Math.hypot(p.position[0] - PAD[0], p.position[2] - PAD[2]) > 1 && p.position[1] < DRONE_SAFE_Y - 0.1) climbedBeforeLeaving = false;
      if (s.state.phase === 'landed') {
        landedAt = p.position;
        minRotorLanded = Math.min(minRotorLanded, p.rotor);
        if (s.state.until - now <= STEP) rotorAtLiftoff = p.rotor;
      }
    });
    expect(phases).toEqual(['away', 'approach', 'descend', 'landed', 'depart', 'away']);
    expect(landedAt![0]).toBeCloseTo(PAD[0], 2);
    expect(landedAt![1]).toBeCloseTo(PAD[1], 2);
    expect(landedAt![2]).toBeCloseTo(PAD[2], 2);
    expect(lowestOverPad).toBeGreaterThanOrEqual(PAD[1] - 1e-6); // never sinks into the deck
    expect(lowestElsewhere).toBeGreaterThan(20); // never skims the sea
    expect(maxJump).toBeLessThan(40 * (STEP / 1000) + 0.5); // no faster than it can fly
    expect(minRotorLanded).toBeLessThan(0.01); // motors off while parked
    expect(rotorAtLiftoff).toBeGreaterThan(0.95); // back at full rpm before lifting
    expect(climbedBeforeLeaving).toBe(true); // straight up clear of the platform first
  });

  it('starts parked on the pad when asked to, ready to fly', () => {
    const s = new DroneScheduler({ ...opts, startLanded: true }, 5_000_000);
    expect(s.state.phase).toBe('landed');
    expect(s.pose(5_000_000).position).toEqual([...PAD]);
    expect(s.pose(5_000_000).rotor).toBeLessThan(0.01);
  });

  it('holds off while someone stands on the landing circle, then lands once they leave', () => {
    const t0 = 2_000_000;
    let occupied = true;
    const s = new DroneScheduler(opts, t0, { padOccupied: () => occupied });
    const phases = fly(s, t0, DRONE_TIMING.approachMs + 30_000);
    expect(phases).toEqual(['away', 'approach', 'hold']);
    const holdPose = s.pose(t0 + DRONE_TIMING.approachMs + 30_000);
    expect(holdPose.position[1] - PAD[1]).toBeGreaterThan(12); // waiting well above the deck
    occupied = false;
    const after = fly(s, t0 + DRONE_TIMING.approachMs + 30_000, DRONE_TIMING.descendMs + 5000);
    expect(after).toEqual(['hold', 'descend', 'landed']);
  });

  it('waves off if someone walks onto the pad during the descent', () => {
    const t0 = 3_000_000;
    let occupied = false;
    const s = new DroneScheduler(opts, t0, { padOccupied: () => occupied });
    fly(s, t0, DRONE_TIMING.approachMs + 5000);
    expect(s.state.phase).toBe('descend');
    occupied = true;
    const now = t0 + DRONE_TIMING.approachMs + 5100;
    s.update(now);
    expect(s.state.phase).toBe('hold');
    const later = s.pose(now + DRONE_TIMING.holdSettleMs + 1000);
    expect(later.position[1] - PAD[1]).toBeGreaterThan(12); // climbed back to the hover point
  });

  it('comes in from downwind on the open-sea side', () => {
    const t0 = 4_000_000;
    const a = new DroneScheduler(opts, t0, { windDirection: () => 100 });
    fly(a, t0, 2000);
    expect(a.state.bearing).toBe(100);
    expect(dronePose(a.state, a.state.t0 + 1000).position[0]).toBeGreaterThan(PAD[0] + 1000); // far out to the east
    const b = new DroneScheduler(opts, t0, { windDirection: () => 290 });
    fly(b, t0, 2000);
    expect(b.state.bearing).toBeGreaterThanOrEqual(40);
    expect(b.state.bearing).toBeLessThanOrEqual(140);
  });

  it('never leaves on its own with someone aboard', () => {
    const t0 = 6_000_000;
    let aboard = true;
    const s = new DroneScheduler({ ...opts, startLanded: true }, t0, { aboard: () => aboard });
    fly(s, t0, opts.stayMs + 60_000);
    expect(s.state.phase).toBe('landed');
    aboard = false;
    fly(s, t0 + opts.stayMs + 60_000, 40_000);
    expect(s.state.phase).toBe('depart');
  });
});

describe('drone colliders', () => {
  it('once parked it is solid: walking across the pad stops at the cabin; after it leaves the way is clear', async () => {
    const sw = await staticWorld({});
    sw.setDrone({ position: [...PAD], yaw: Math.PI / 2 }); // nose west, cabin across the walking line
    const m = motor(sw, [31, 20, 0]);
    const blocked = walk(m, [[52, 0]]);
    expect(blocked.reached).toBe(false);
    expect(blocked.final[0]).toBeLessThan(42);
    sw.setDrone(null);
    expect(walk(m, [[46, 0]]).reached).toBe(true);
  });

  it('people can walk under the rotor ducts but not through the cabin', async () => {
    const sw = await staticWorld({});
    sw.setDrone({ position: [...PAD], yaw: 0 });
    // Along x at z = armZ: under the front and back ducts, clear of the cabin.
    const m = motor(sw, [PAD[0] - 7, 20, PAD[2] + DIMS.DRONE.armZ]);
    expect(walk(m, [[PAD[0] + 7, PAD[2] + DIMS.DRONE.armZ]]).reached).toBe(true);
    sw.setDrone(null);
  });

  it('a jump under a rotor duct goes as high as one in the open', async () => {
    const sw = await staticWorld({});
    const under: Vec3 = [PAD[0] + DIMS.DRONE.armX, 20, PAD[2] + DIMS.DRONE.armZ];
    const peak = () => {
      const m = motor(sw, under);
      const y0 = m.state.position[1];
      let top = y0;
      m.step({ ...idle(0), jump: true }, DT);
      for (let i = 0; i < 90; i++) {
        m.step(idle(0), DT);
        top = Math.max(top, m.state.position[1]);
      }
      return top - y0;
    };
    const open = peak();
    sw.setDrone({ position: [...PAD], yaw: 0 });
    const ducted = peak();
    sw.setDrone(null);
    expect(open).toBeGreaterThan(0.7);
    expect(ducted).toBeCloseTo(open, 2);
  });
});

describe('flying the drone', () => {
  it('lifts off the pad, flies out over the sea, climbs, and comes back down onto the pad', async () => {
    const sw = await staticWorld({});
    const d = new DroneFlight(sw, [...PAD], Math.PI / 2);
    const dt = 1 / 60;
    const run = (seconds: number, input: { forward?: number; right?: number; up?: number; yaw?: number }) => {
      for (let t = 0; t < seconds; t += dt) d.step({ forward: input.forward ?? 0, right: input.right ?? 0, up: input.up ?? 0, yaw: input.yaw ?? d.yaw }, dt);
    };
    expect(d.grounded).toBe(true);
    run(1, { forward: 1 }); // stick forward on the ground: nothing happens until it lifts
    expect(Math.hypot(d.position.x - PAD[0], d.position.z - PAD[2])).toBeLessThan(0.05);
    run(3, { up: 1 });
    expect(d.grounded).toBe(false);
    expect(d.position.y).toBeGreaterThan(PAD[1] + 8);
    run(6, { forward: 1, yaw: -Math.PI / 2 }); // turn east and fly out to sea
    expect(d.position.x).toBeGreaterThan(PAD[0] + 50);
    expect(Math.hypot(d.velocity.x, d.velocity.z)).toBeLessThanOrEqual(DIMS.DRONE.maxSpeed + 1e-6);
    expect(Math.abs(d.yaw + Math.PI / 2)).toBeLessThan(0.1); // faces where the pilot looks
    run(8, {}); // stick released: it stops and hovers
    const hover = { ...d.position };
    run(2, {});
    expect(Math.hypot(d.position.x - hover.x, d.position.y - hover.y, d.position.z - hover.z)).toBeLessThan(0.05);
    // Back over the pad, settle, and down.
    for (let i = 0; i < 60 * 60; i++) {
      const dx = PAD[0] - d.position.x;
      const dz = PAD[2] - d.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.3 && Math.hypot(d.velocity.x, d.velocity.z) < 0.3) break;
      d.step({ forward: Math.min(1, dist / 40), right: 0, up: 0, yaw: Math.atan2(-dx, -dz) }, dt);
    }
    expect(Math.hypot(d.position.x - PAD[0], d.position.z - PAD[2])).toBeLessThan(0.5);
    run(12, { up: -1 });
    expect(d.grounded).toBe(true);
    expect(d.position.y).toBeGreaterThan(PAD[1] - 0.05);
    expect(d.position.y).toBeLessThan(PAD[1] + 0.2);
    d.dispose();
  });

  it('cannot fly through the pavilion, and stays above the sea', async () => {
    const sw = await staticWorld({});
    const d = new DroneFlight(sw, [-8, 21.2, 12], 0); // hovering over the terrace, facing the pavilion (north)
    const dt = 1 / 60;
    for (let t = 0; t < 6; t += dt) d.step({ forward: 1, right: 0, up: 0, yaw: 0 }, dt);
    // The roof overhang reaches z = 4 and the glass z = 2: the body (half depth ~4 m) stops short of them.
    expect(d.position.z).toBeGreaterThan(4 + 3.5);
    const sea = new DroneFlight(sw, [-80, 10, 0], 0);
    for (let t = 0; t < 8; t += dt) sea.step({ forward: 0, right: 0, up: -1, yaw: 0 }, dt);
    expect(sea.position.y).toBeGreaterThanOrEqual(DIMS.DRONE.minSeaAltitude - 0.1);
    d.dispose();
    sea.dispose();
  });
});

describe('flying home on autopilot', () => {
  /** Flies on autopilot from `start` until it lands (or gives up), recording what a passenger would notice. */
  function flyHome(sw: StaticWorld, start: Vec3, yaw: number, opts: { occupiedFor?: number; maxSeconds?: number; landFirst?: boolean } = {}) {
    const d = new DroneFlight(sw, start, yaw);
    // Put it down where it is first (the pilot landed there), with the same flight model.
    if (opts.landFirst) for (let t = 0; t < 15; t += 1 / 120) d.step({ forward: 0, right: 0, up: -1, yaw }, 1 / 120);
    const from: Vec3 = [d.position.x, d.position.y, d.position.z];
    const startedGrounded = d.grounded;
    const ap = new DroneAutopilot(from, (a, b) => droneClearPath(sw, a, b));
    const dt = 1 / 120;
    let t = 0;
    let lowest = Infinity;
    let fastest = 0;
    let maxJump = 0;
    let prev = { ...d.position };
    const stages: string[] = [ap.stage];
    while (t < (opts.maxSeconds ?? 240) && ap.stage !== 'landed' && ap.stage !== 'stuck') {
      d.step(ap.step(d, dt, t < (opts.occupiedFor ?? 0)), dt);
      t += dt;
      if (stages.at(-1) !== ap.stage) stages.push(ap.stage);
      const overPlatform = d.groundBelow(40) !== null;
      if (!overPlatform) lowest = Math.min(lowest, d.position.y);
      fastest = Math.max(fastest, Math.hypot(d.velocity.x, d.velocity.z));
      maxJump = Math.max(maxJump, Math.hypot(d.position.x - prev.x, d.position.y - prev.y, d.position.z - prev.z));
      prev = { ...d.position };
    }
    const result = { from, startedGrounded, stages, seconds: t, lowest, fastest, maxJump, position: { ...d.position }, yaw: d.yaw, grounded: d.grounded };
    d.dispose();
    return result;
  }

  const onPad = (r: { position: { x: number; y: number; z: number }; grounded: boolean; yaw: number }) => {
    expect(r.grounded).toBe(true);
    expect(Math.hypot(r.position.x - PAD[0], r.position.z - PAD[2])).toBeLessThan(0.8);
    expect(r.position.y).toBeGreaterThan(PAD[1] - 0.05);
    expect(r.position.y).toBeLessThan(PAD[1] + 0.2);
    let dy = (r.yaw - PAD_YAW) % (Math.PI * 2);
    if (dy > Math.PI) dy -= Math.PI * 2;
    if (dy < -Math.PI) dy += Math.PI * 2;
    expect(Math.abs(dy)).toBeLessThan(0.3); // parked nose to the platform
  };

  it('from out over the sea, it flies back, lines up over the pad and lands', async () => {
    const sw = await staticWorld({});
    const r = flyHome(sw, [PAD[0] + 260, 12, 140], 1.2);
    expect(r.stages).toEqual(['climb', 'cruise', 'descend', 'landed']);
    onPad(r);
    expect(r.lowest).toBeGreaterThanOrEqual(DIMS.DRONE.minSeaAltitude);
    expect(r.fastest).toBeLessThanOrEqual(DIMS.DRONE.maxSpeed + 1e-6);
    expect(r.maxJump).toBeLessThan(0.5);
    expect(r.seconds).toBeLessThan(90);
  });

  it('from under the main deck, it flies out from under the platform before climbing, then lands', async () => {
    const sw = await staticWorld({});
    const r = flyHome(sw, [0, 9, 0], 0);
    expect(r.stages[0]).toBe('climb');
    expect(r.stages.at(-1)).toBe('landed');
    onPad(r);
  });

  it('from the ground on the terrace, it lifts off and lands on the pad', async () => {
    const sw = await staticWorld({});
    const r = flyHome(sw, [16, 26, 11], 1, { landFirst: true });
    // It was standing on the terrace, well away from the pad.
    expect(r.startedGrounded).toBe(true);
    expect(r.from[1]).toBeLessThan(21);
    expect(Math.hypot(r.from[0] - PAD[0], r.from[2] - PAD[2])).toBeGreaterThan(20);
    expect(r.stages.at(-1)).toBe('landed');
    onPad(r);
  });

  it('already on the pad, there is nothing to do', async () => {
    const sw = await staticWorld({});
    const r = flyHome(sw, [...PAD], PAD_YAW);
    expect(r.stages).toEqual(['descend', 'landed']);
    expect(r.seconds).toBeLessThan(0.1);
  });

  it('holds over the pad while someone stands on the landing circle, then lands once they leave', async () => {
    const sw = await staticWorld({});
    const r = flyHome(sw, [PAD[0] + 60, 40, 0], 0, { occupiedFor: 45 });
    expect(r.stages).toContain('hold');
    expect(r.stages.at(-1)).toBe('landed');
    expect(r.seconds).toBeGreaterThan(45);
    onPad(r);
  });
});

describe('the drone in the shared world', () => {
  it('a person boards it as pilot, flies it to the terrace, lands, climbs out; a passenger rides along', async () => {
    const world = await makeWorld({ drone: { startLanded: true } });
    expect(world.drone.state.phase).toBe('landed');
    const a = connection();
    const b = connection();
    const pa = world.handle(a.conn, null, { type: 'hello', version: 2, name: 'Pilot' })!;
    const pb = world.handle(b.conn, null, { type: 'hello', version: 2, name: 'Rider' })!;
    // Too far away to board from the terrace.
    world.handle(a.conn, pa, { type: 'board' });
    expect(world.crew.pilot).toBeNull();
    expect(a.last('error')?.code).toBe('cannot-board');
    // Walk up to it (poses are validated, so step there).
    for (const [p, c] of [[pa, a], [pb, b]] as const) {
      p.pose = { ...p.pose, p: [PAD[0] - 5, PAD[1], PAD[2] + 2], t: Date.now() };
      world.handle(c.conn, p, { type: 'board' });
    }
    expect(world.crew.seats).toEqual([pa.info.id, pb.info.id, null, null]);
    expect(world.drone.state.phase).toBe('piloted');
    expect(world.sw.droneParked).toBe(false);
    expect(b.last('drone')?.crew[0]).toBe(pa.info.id);
    // The pilot streams a flight to the terrace, landing by the firepit lounge.
    const target: Vec3 = [-14, 20.05, 6];
    const steps = 80;
    for (let i = 1; i <= steps; i++) {
      const u = i / steps;
      const p: Vec3 = [PAD[0] + (target[0] - PAD[0]) * u, PAD[1] + Math.sin(u * Math.PI) * 20, PAD[2] + (target[2] - PAD[2]) * u];
      world.handle(a.conn, pa, { type: 'drone', p, v: [0, 0, 0], yaw: 1, pitch: 0, roll: 0, rotor: 1, grounded: false });
    }
    // A jump no drone could make is ignored.
    world.handle(a.conn, pa, { type: 'drone', p: [500, 60, 500], v: [0, 0, 0], yaw: 1, pitch: 0, roll: 0, rotor: 1, grounded: false });
    expect(world.dronePose().position[0]).toBeLessThan(0);
    world.handle(a.conn, pa, { type: 'drone', p: target, v: [0, 0, 0], yaw: 1, pitch: 0, roll: 0, rotor: 0.4, grounded: true });
    expect(world.dronePose().position).toEqual(target);
    // Snapshots carry the live pose to everyone; the passenger's body is in its seat.
    (world as unknown as { broadcastSnapshot(): void }).broadcastSnapshot();
    expect(b.last('snapshot')?.drone?.p).toEqual(target);
    world.handle(b.conn, pb, { type: 'pose', seq: 1, p: [0, 0, 0], v: [0, 0, 0], yaw: 0, pitch: 0, grounded: true });
    expect(Math.hypot(pb.pose.p[0] - target[0], pb.pose.p[2] - target[2])).toBeLessThan(1.5);
    // The pilot climbs out beside it: it is parked there, solid, and the schedule resumes from there.
    world.handle(a.conn, pa, { type: 'unboard', p: [target[0], 20.05, target[2] + 5] });
    expect(world.crew.pilot).toBeNull();
    expect(world.drone.state.phase).toBe('landed');
    expect(world.drone.state.from).toEqual(target);
    expect(world.sw.droneParked).toBe(true);
    expect(pa.pose.p).toEqual([target[0], 20.05, target[2] + 5]);
    // With the passenger still aboard it does not leave, even after its stay.
    world.drone.update(Date.now() + 13 * 60_000);
    expect(world.drone.state.phase).toBe('landed');
    world.handle(b.conn, pb, { type: 'unboard', p: [target[0] + 5, 20.05, target[2] + 2] });
    expect(world.crew.count).toBe(0);
    // Now it leaves: straight up clear of the platform, then out to sea.
    const now = world.drone.state.until + 100;
    world.drone.update(now);
    expect(world.drone.state.phase).toBe('depart');
    const route = world.drone.state.route!;
    expect(route[1][0]).toBeCloseTo(target[0]);
    expect(route[1][1]).toBeGreaterThanOrEqual(DRONE_SAFE_Y);
    world.stop();
  });

  it('if the pilot drops out under the deck, it flies out from under the platform, climbs and lands on the pad', async () => {
    const world = await makeWorld({ drone: { startLanded: true } });
    const a = connection();
    const pa = world.handle(a.conn, null, { type: 'hello', version: 2, name: 'Daredevil' })!;
    pa.pose = { ...pa.pose, p: [PAD[0] - 6, PAD[1], PAD[2]], t: Date.now() };
    world.handle(a.conn, pa, { type: 'board' });
    // Hovering under the main deck, between the legs.
    const under: Vec3 = [0, 9, 0];
    (world as unknown as { droneLive: object }).droneLive = { p: under, v: [0, 0, 0], yaw: 0, pitch: 0, roll: 0, rotor: 1, grounded: false, t: Date.now() };
    world.drone.track(under, 0);
    world.disconnect(pa);
    expect(world.drone.state.phase).toBe('return');
    const route = world.drone.state.route!;
    expect(route[0]).toEqual(under);
    // First leg stays at its height and leaves the platform's footprint; then it climbs.
    expect(route[1][1]).toBeCloseTo(under[1]);
    expect(Math.abs(route[1][0]) > 30 || Math.abs(route[1][2]) > 20).toBe(true);
    expect(route[2][1]).toBeGreaterThanOrEqual(DRONE_SAFE_Y);
    // Fly it home.
    let t = world.drone.state.t0;
    const phases: string[] = [];
    for (; t < world.drone.state.t0 + 10 * 60_000 && world.drone.state.phase !== 'landed'; t += 200) {
      world.drone.update(t);
      if (phases.at(-1) !== world.drone.state.phase) phases.push(world.drone.state.phase);
    }
    expect(phases).toEqual(['return', 'descend', 'landed']);
    expect(world.drone.state.from).toEqual([...PAD]);
    world.stop();
  });

  it('at touchdown, the world moves anyone standing underneath clear of the drone', async () => {
    const world = await makeWorld();
    const p = world.addAgent('Late', [PAD[0] + 1, PAD[1], PAD[2] + 1], 0);
    const t0 = Date.now();
    world.drone.state = {
      phase: 'descend',
      t0: t0 - DRONE_TIMING.descendMs + 50,
      until: t0 + 50,
      bearing: 90,
      from: [PAD[0] + 45, PAD[1] + 18, PAD[2]],
      fromYaw: Math.PI / 2,
      padYaw: Math.PI / 2,
    };
    const seen: string[] = [];
    world.on('drone', (st) => seen.push(st.phase));
    world.drone.update(t0 + 100);
    expect(seen).toEqual(['landed']);
    expect(world.sw.droneParked).toBe(true);
    const [x, , z] = p.pose.p;
    expect(Math.hypot(x - PAD[0], z - PAD[2])).toBeGreaterThanOrEqual(DIMS.DRONE.clearRadius);
    world.stop();
  });
});
