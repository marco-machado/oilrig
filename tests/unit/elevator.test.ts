import { describe, expect, it } from 'vitest';
import {
  DIMS,
  ElevatorController,
  type ServerMessage,
  elevatorPanels,
  elevatorPose,
  findPlace,
  gateOpen,
  inCar,
  travelMs,
} from '@oilrig/shared';
import { DT, idle, makeWorld, motor, walk, world as staticWorld, who } from './helpers.ts';

// The elevator is a state plus a pure timeline. These tests ride it the way a person would:
// the car never jumps or overspeeds, its doors never close on anyone, the shaft is closed
// wherever the car is not, and someone standing in the car arrives at the other stop.

const E = DIMS.ELEVATOR;
const [LOW, HIGH] = E.stops;
const doorX = (E.door.x0 + E.door.x1) / 2;
const carZ = (E.z0 + E.z1) / 2;

describe('elevator timeline', () => {
  it('closes, travels smoothly at no more than its speed, arrives exactly and opens', () => {
    const t0 = 1_000_000;
    const s = { from: 1, to: 0, t0 };
    const total = 2 * E.doorMs + travelMs(1, 0);
    expect(travelMs(1, 0) / 1000).toBeGreaterThan(8);
    expect(travelMs(1, 0) / 1000).toBeLessThan(14);
    let prev = elevatorPose(s, t0).y;
    let fastest = 0;
    const phases: string[] = [];
    for (let t = t0; t <= t0 + total + 500; t += 20) {
      const p = elevatorPose(s, t);
      fastest = Math.max(fastest, Math.abs(p.y - prev) / 0.02);
      prev = p.y;
      if (phases.at(-1) !== p.phase) phases.push(p.phase);
      if (p.phase === 'travel') expect(p.doors).toBe(0);
    }
    expect(phases).toEqual(['closing', 'travel', 'opening', 'open']);
    expect(fastest).toBeLessThanOrEqual(E.speed + 0.01);
    const end = elevatorPose(s, t0 + total + 500);
    expect(end.y).toBe(LOW);
    expect(end.stop).toBe(0);
    expect(end.doors).toBe(1);
  });

  it('answers a call, queues the next one, and keeps its doors open for anyone in the doorway', () => {
    let blocked = false;
    const t0 = 2_000_000;
    const c = new ElevatorController(t0, { doorwayOccupied: () => blocked });
    expect(c.pose(t0).stop).toBe(1); // starts at the deck, doors open
    c.call(0, t0); // called from the landing
    c.update(t0 + E.dwellMs);
    expect(c.state).toMatchObject({ from: 1, to: 0 });
    // Someone steps into the doorway while the doors close: they open again.
    blocked = true;
    c.update(t0 + E.dwellMs + 500);
    expect(c.pose(t0 + E.dwellMs + 600).phase).toBe('opening');
    expect(c.state.from).toBe(c.state.to);
    // It waits while they stand there, then goes once they have stepped in.
    let t = t0 + E.dwellMs + 600;
    for (; t < t0 + 30_000; t += 100) c.update(t);
    expect(c.pose(t).stop).toBe(1);
    blocked = false;
    for (; t < t0 + 60_000; t += 100) c.update(t);
    expect(c.pose(t).stop).toBe(0);
    expect(c.pose(t).phase).toBe('open');
  });
});

describe('riding the elevator', () => {
  it('from the main deck down to the boat landing and out onto the landing', async () => {
    const sw = await staticWorld({});
    const c = new ElevatorController(0);
    const sync = (now: number) => {
      const p = c.pose(now);
      sw.setElevator(p.y, E.stops.map((_, i) => gateOpen(p, i)));
      return p;
    };
    sync(0);
    const m = motor(sw, findPlace('elevator-deck').position);
    // Walk in through the open doors.
    const into = walk(m, [[doorX, E.z0 - 0.3], [doorX, carZ]]);
    expect(into.reached).toBe(true);
    expect(inCar(HIGH, m.state.position)).toBe(true);
    // Press the button inside, and ride.
    c.call(0, 0);
    let now = 0;
    let carY = c.pose(0).y;
    let minAboveFloor = Infinity;
    for (let i = 0; i < 25 / DT; i++) {
      now += DT * 1000;
      c.update(now);
      const p = sync(now);
      if (inCar(carY, m.state.position)) m.ride(p.y - carY);
      carY = p.y;
      m.step(idle(Math.PI), DT);
      minAboveFloor = Math.min(minAboveFloor, m.state.position[1] - carY);
    }
    expect(c.pose(now).stop).toBe(0);
    expect(minAboveFloor).toBeGreaterThan(-0.05); // never sinks through the floor
    expect(m.state.position[1]).toBeCloseTo(LOW, 1);
    // Out through the doors onto the landing.
    const out = walk(m, [[doorX, E.z0 - 0.6], ...[findPlace('elevator-landing').position].map((p) => [p[0], p[2]] as [number, number])]);
    expect(out.reached).toBe(true);
    expect(out.final[1]).toBeCloseTo(LOW, 1);
  });

  it('the shaft is closed where the car is not: nobody walks into an empty shaft', async () => {
    const sw = await staticWorld({});
    const c = new ElevatorController(0, {}, 0); // car down at the landing
    const p = c.pose(0);
    sw.setElevator(p.y, E.stops.map((_, i) => gateOpen(p, i)));
    const m = motor(sw, findPlace('elevator-deck').position);
    const r = walk(m, [[doorX, carZ]]);
    expect(r.reached).toBe(false);
    expect(r.final[2]).toBeLessThan(E.z0);
    expect(r.minY).toBeGreaterThan(HIGH - 0.1);
  });
});

describe('the elevator in the shared world', () => {
  it('a person at the landing calls it down; everyone hears about it; someone far away cannot', async () => {
    const world = await makeWorld();
    const got: ServerMessage[] = [];
    const conn = { send: (m: ServerMessage) => got.push(m), sendRaw: (j: string) => got.push(JSON.parse(j)), close: () => undefined };
    const p = world.join(conn, who('Caller'));
    world.handle(conn, p, { type: 'elevator', stop: 0 }); // from the terrace: too far
    expect(got.at(-1)).toMatchObject({ type: 'error', code: 'too-far' });
    const panel = elevatorPanels().find((q) => q.stop === 0)!;
    p.pose = { ...p.pose, p: [panel.position[0] - 0.3, LOW, panel.position[2] - 0.8], t: Date.now() };
    world.handle(conn, p, { type: 'elevator', stop: 0 });
    world.elevator.update(Date.now() + E.dwellMs + 50);
    expect(got.some((m) => m.type === 'elevator' && m.state.to === 0)).toBe(true);
    world.stop();
  });
});
