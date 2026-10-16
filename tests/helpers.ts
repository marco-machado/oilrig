import RAPIER from '@dimforge/rapier3d-compat';
import { CharacterMotor, type MoveInput, type StaticWorld, type Vec3, buildStaticWorld, getLayout } from '@ocean-home/shared';

export const DT = 1 / 60;

export async function world(openDoors: Record<string, boolean> = {}): Promise<StaticWorld> {
  await RAPIER.init();
  return buildStaticWorld(RAPIER, getLayout(), openDoors);
}

export function allDoorsOpen() {
  return Object.fromEntries(getLayout().doors.map((d) => [d.id, true]));
}

export function motor(sw: StaticWorld, start: Vec3) {
  const m = new CharacterMotor(sw, start, getLayout().zones);
  for (let i = 0; i < 30; i++) m.step(idle(0), DT); // settle onto the floor
  return m;
}

export function idle(yaw: number): MoveInput {
  return { forward: 0, right: 0, run: false, jump: false, yaw };
}

export interface WalkResult {
  reached: boolean;
  /** Lowest feet height seen while walking. */
  minY: number;
  final: Vec3;
  stuckAt?: [number, number];
}

/** Steers the real character controller through XZ waypoints, like a player holding W. */
export function walk(m: CharacterMotor, waypoints: Array<[number, number]>, opts: { run?: boolean } = {}): WalkResult {
  let minY = Infinity;
  for (const [tx, tz] of waypoints) {
    const start = m.state.position;
    const dist0 = Math.hypot(tx - start[0], tz - start[2]);
    const maxSteps = Math.ceil(((dist0 / 2.5 + 6) * 1) / DT);
    let ok = false;
    for (let i = 0; i < maxSteps; i++) {
      const [x, y, z] = m.state.position;
      minY = Math.min(minY, y);
      const dx = tx - x;
      const dz = tz - z;
      if (Math.hypot(dx, dz) < 0.25) {
        ok = true;
        break;
      }
      const yaw = Math.atan2(-dx, -dz);
      m.step({ forward: 1, right: 0, run: !!opts.run, jump: false, yaw }, DT);
    }
    if (!ok) return { reached: false, minY, final: m.state.position, stuckAt: [tx, tz] };
  }
  // Let the controller come to rest, as a player releasing W would.
  for (let i = 0; i < 60; i++) m.step(idle(0), DT);
  return { reached: true, minY: Math.min(minY, m.state.position[1]), final: m.state.position };
}

export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A real World (in-memory store) for tests that need agents, doors or the helicopter. */
export async function makeWorld(opts: { weatherSeed?: number } = {}) {
  const [{ World }, { Store }, { makeClock }] = await Promise.all([
    import('../apps/server/src/world/world.ts'),
    import('../apps/server/src/db.ts'),
    import('@ocean-home/shared'),
  ]);
  return World.create({
    clock: makeClock({ realTime: false, dayLengthMinutes: 120 }),
    weatherSeed: opts.weatherSeed ?? 3,
    joinPassword: null,
    store: new Store(':memory:'),
  });
}

export const TEST_SERVER_CONFIG = {
  port: 0,
  host: '127.0.0.1',
  joinPassword: null,
  dayLengthMinutes: 120,
  realTime: false,
  timeOffsetHours: 0,
  weatherSeed: 5,
  dbPath: ':memory:',
  staticDir: null,
};
