import type * as RAPIER from '@dimforge/rapier3d-compat';
import { DRONE } from '../layout/dims.ts';
import type { Vec3 } from '../layout/types.ts';
import type { StaticWorld } from '../physics/colliders.ts';
import { mulberry32 } from './weather.ts';

// The platform's passenger drone. When nobody flies it, the server runs its schedule
// (DroneScheduler) and broadcasts the state only when the phase changes; everyone evaluates
// the same pose function from that state and the shared clock, so a scheduled flight never
// needs streaming. When someone flies it, their browser runs the flight model (DroneFlight)
// against the same colliders and streams the pose through the server.

export type DronePhase = 'away' | 'approach' | 'hold' | 'descend' | 'landed' | 'depart' | 'return' | 'piloted';

export interface DroneState {
  phase: DronePhase;
  /** Server time (ms) when this phase began. */
  t0: number;
  /** Server time (ms) when the phase is planned to end (landed: lift-off; away: next arrival). */
  until: number;
  /** Bearing of the inbound or outbound leg as seen from the pad, degrees clockwise from north. */
  bearing: number;
  /** Where this phase starts (skid level); where it stands while landed or piloted. */
  from: Vec3;
  fromYaw: number;
  /** Heading on the pad (landed: heading where it stands). */
  padYaw: number;
  /** Waypoints of a routed flight (depart, return), starting at `from`. */
  route?: Vec3[];
}

export interface DronePose {
  visible: boolean;
  /** Skid-level reference point. */
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  roll: number;
  /** Rotor speed as a fraction of hover rpm, 0..1. */
  rotor: number;
  /** Height of the skids above the pad when over it, else above the sea. */
  altitude: number;
}

export const DRONE_TIMING = {
  approachMs: 100_000,
  descendMs: 22_000,
  holdMaxMs: 150_000,
  holdSettleMs: 6_000,
  spinDownMs: 5_000,
  spinUpMs: 6_000,
} as const;

const PAD: Vec3 = [DRONE.pad[0], DRONE.pad[1], DRONE.pad[2]];
const FAR = 1600;
const CRUISE_ALT = 150;
const HOVER_OUT = 45;
const HOVER_ALT = 18;
/** Clear of every structure on the platform (roof 23.7 m, windsock 24.6 m, elevator head 23.1 m). */
export const DRONE_SAFE_Y = 34;
const CLIMB_SPEED = 4;
const CLIMB_ACCEL = 1.5;
const CRUISE_SPEED = 32;
const CRUISE_ACCEL = 3;
const MOVE_SPEED = 8;
/** The platform and its waterline decks, with room for the drone's span. */
const FOOTPRINT = { x0: -36, x1: 58, z0: -27, z1: 30 };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number) => {
  const u = clamp01(v);
  return u * u * (3 - 2 * u);
};
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function lerpAngle(a: number, b: number, t: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Unit vector on the water plane for a compass bearing. */
export function bearingVector(deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  return [Math.sin(r), -Math.cos(r)];
}

/** Yaw (layout convention: 0 faces north, counter-clockwise positive) facing along (dx, dz). */
export function yawFacing(dx: number, dz: number) {
  return Math.atan2(-dx, -dz);
}

export function droneFarPoint(bearing: number): Vec3 {
  const [dx, dz] = bearingVector(bearing);
  return [PAD[0] + dx * FAR, PAD[1] + CRUISE_ALT, PAD[2] + dz * FAR];
}

export function droneHoverPoint(bearing: number): Vec3 {
  const [dx, dz] = bearingVector(bearing);
  return [PAD[0] + dx * HOVER_OUT, PAD[1] + HOVER_ALT, PAD[2] + dz * HOVER_OUT];
}

/** Distance covered after t seconds on a leg of length d, starting and ending at rest. */
function trapezoid(d: number, vmax: number, a: number, t: number) {
  if (d <= 0 || t <= 0) return 0;
  const da = (vmax * vmax) / a;
  if (d >= da) {
    const ta = vmax / a;
    const total = d / vmax + ta;
    if (t < ta) return 0.5 * a * t * t;
    if (t < total - ta) return 0.5 * a * ta * ta + vmax * (t - ta);
    if (t < total) {
      const r = total - t;
      return d - 0.5 * a * r * r;
    }
    return d;
  }
  const half = Math.sqrt(d / a);
  if (t < half) return 0.5 * a * t * t;
  if (t < 2 * half) {
    const r = 2 * half - t;
    return d - 0.5 * a * r * r;
  }
  return d;
}

function legProfile(a: Vec3, b: Vec3) {
  const h = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const v = Math.abs(b[1] - a[1]);
  const d = Math.hypot(h, v);
  // Mostly vertical legs climb slowly; long legs cruise; short hops move at a walking-boat pace.
  const [vmax, acc] = v > h ? [CLIMB_SPEED, CLIMB_ACCEL] : d > 200 ? [CRUISE_SPEED, CRUISE_ACCEL] : [MOVE_SPEED, CLIMB_ACCEL];
  const da = (vmax * vmax) / acc;
  const s = d >= da ? d / vmax + vmax / acc : 2 * Math.sqrt(d / acc);
  return { d, vmax, acc, ms: s * 1000 + 600 }; // a short pause at each waypoint
}

/** Duration of a routed flight in ms. */
export function routeMs(route: Vec3[]) {
  let ms = 0;
  for (let i = 1; i < route.length; i++) ms += legProfile(route[i - 1], route[i]).ms;
  return ms;
}

function routeAt(route: Vec3[], e: number, startYaw: number): { p: Vec3; yaw: number } {
  let t = e;
  let yaw = startYaw;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const leg = legProfile(a, b);
    const dh = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const legYaw = dh > 1 ? yawFacing(b[0] - a[0], b[2] - a[2]) : yaw;
    if (t < leg.ms || i === route.length - 1) {
      const x = trapezoid(leg.d, leg.vmax, leg.acc, t / 1000);
      // Turn to face the leg during its first few seconds.
      return { p: lerp3(a, b, leg.d > 0 ? Math.min(1, x / leg.d) : 1), yaw: lerpAngle(yaw, legYaw, smooth(t / 3000)) };
    }
    t -= leg.ms;
    yaw = legYaw;
  }
  return { p: route[route.length - 1], yaw };
}

/** Skid position and heading at a given time within the phase described by `s`. */
function placeAt(s: DroneState, now: number): { p: Vec3; yaw: number } {
  const e = now - s.t0;
  switch (s.phase) {
    case 'away':
      return { p: droneFarPoint(s.bearing), yaw: s.fromYaw };
    case 'approach': {
      // Quadratic ease-out: cruise speed at the start, zero at the hover point.
      const u = clamp01(e / DRONE_TIMING.approachMs);
      return { p: lerp3(s.from, droneHoverPoint(s.bearing), 1 - (1 - u) * (1 - u)), yaw: s.fromYaw };
    }
    case 'hold': {
      const p = lerp3(s.from, droneHoverPoint(s.bearing), smooth(e / DRONE_TIMING.holdSettleMs));
      const bob = Math.sin((e / 6000) * Math.PI * 2) * 0.3;
      return { p: [p[0], p[1] + bob, p[2]], yaw: s.fromYaw };
    }
    case 'descend': {
      const u = clamp01(e / DRONE_TIMING.descendMs);
      const h = smooth(u / 0.8);
      const v = smooth(u);
      const h0 = s.from[1] - PAD[1];
      return {
        p: [s.from[0] + (PAD[0] - s.from[0]) * h, PAD[1] + h0 * (1 - v), s.from[2] + (PAD[2] - s.from[2]) * h],
        yaw: lerpAngle(s.fromYaw, s.padYaw, smooth(e / DRONE_TIMING.descendMs / 0.7)),
      };
    }
    case 'landed':
    case 'piloted':
      return { p: s.from, yaw: s.padYaw };
    case 'depart':
    case 'return':
      return routeAt(s.route ?? [s.from], e, s.fromYaw);
  }
}

function rotorAt(s: DroneState, now: number): number {
  const e = now - s.t0;
  if (s.phase === 'away') return 0;
  if (s.phase === 'piloted') return 0.4;
  if (s.phase !== 'landed') return 1;
  const down = 1 - smooth(e / DRONE_TIMING.spinDownMs);
  const up = smooth(1 - (s.until - now) / DRONE_TIMING.spinUpMs);
  return Math.max(down, up);
}

/** Evaluates the drone at `now` (server ms). Pure: same state + time, same pose. */
export function dronePose(s: DroneState, now: number): DronePose {
  const { p, yaw } = placeAt(s, now);
  const h = 250;
  const a = placeAt(s, now - h).p;
  const b = placeAt(s, now + h).p;
  const dt = (2 * h) / 1000;
  const vel: Vec3 = [(b[0] - a[0]) / dt, (b[1] - a[1]) / dt, (b[2] - a[2]) / dt];
  const k = (h / 1000) ** 2;
  const acc: Vec3 = [(b[0] - 2 * p[0] + a[0]) / k, (b[1] - 2 * p[1] + a[1]) / k, (b[2] - 2 * p[2] + a[2]) / k];
  const still = s.phase === 'landed' || s.phase === 'piloted';
  const { pitch, roll } = tiltFrom(acc, vel, yaw);
  return {
    visible: s.phase !== 'away',
    position: p,
    velocity: still ? [0, 0, 0] : vel,
    yaw,
    pitch: still ? 0 : pitch,
    roll: still ? 0 : roll,
    rotor: rotorAt(s, now),
    altitude: altitudeOf(p),
  };
}

/** Body tilt of a multicopter accelerating: it leans into the acceleration. */
export function tiltFrom(acc: Vec3, vel: Vec3, yaw: number) {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const af = acc[0] * fx + acc[2] * fz;
  const ar = acc[0] * rx + acc[2] * rz;
  const vf = vel[0] * fx + vel[2] * fz;
  const cl = (v: number, m: number) => Math.max(-m, Math.min(m, v));
  return { pitch: cl(-af * 0.045 - vf * 0.004, 0.35), roll: cl(-ar * 0.05, 0.35) };
}

export function altitudeOf(p: Vec3) {
  const overPad = Math.hypot(p[0] - PAD[0], p[2] - PAD[2]) < 12;
  return overPad ? p[1] - PAD[1] : p[1];
}

/** Box colliders of the drone standing at `position` with heading `yaw`: [centre, half extents, yaw]. */
export function droneBodyBoxes(position: Vec3, yaw: number): Array<{ center: Vec3; half: Vec3; yaw: number }> {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Body frame (x right, z back) to world, rotating counter-clockwise by yaw.
  const at = (x: number, y: number, z: number): Vec3 => [position[0] + x * c + z * s, position[1] + y, position[2] - x * s + z * c];
  const boxes = [{ center: at(0, 1.25, 0.05), half: [1.0, 0.95, 1.95] as Vec3, yaw }];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) boxes.push({ center: at(sx * DRONE.armX, DRONE.ductY, sz * DRONE.armZ), half: [DRONE.ductRadius + 0.08, 0.18, DRONE.ductRadius + 0.08], yaw });
  }
  return boxes;
}

/** World position of a seat's cushion and the eye above it. */
export function seatPosition(pose: { position: Vec3; yaw: number }, seat: number, eye = false): Vec3 {
  const [x, y, z] = DRONE.seats[seat];
  const c = Math.cos(pose.yaw);
  const s = Math.sin(pose.yaw);
  return [pose.position[0] + x * c + z * s, pose.position[1] + y + (eye ? DRONE.seatedEye : 0), pose.position[2] - x * s + z * c];
}

export function padOccupied(positions: Iterable<Vec3>): boolean {
  for (const p of positions) {
    if (Math.hypot(p[0] - PAD[0], p[2] - PAD[2]) < DRONE.clearRadius && p[1] > PAD[1] - 0.6 && p[1] < PAD[1] + 4) return true;
  }
  return false;
}

/** Who sits where: seat 0 is the pilot's. */
export class DroneCrew {
  readonly seats: Array<string | null> = DRONE.seats.map(() => null);

  seatOf(id: string) {
    const i = this.seats.indexOf(id);
    return i < 0 ? null : i;
  }

  get pilot() {
    return this.seats[0];
  }

  get count() {
    return this.seats.filter(Boolean).length;
  }

  /** Takes the pilot's seat if it is free, else the first free passenger seat. */
  board(id: string): number | null {
    const have = this.seatOf(id);
    if (have !== null) return have;
    const i = this.seats.indexOf(null);
    if (i < 0) return null;
    this.seats[i] = id;
    return i;
  }

  leave(id: string): number | null {
    const i = this.seatOf(id);
    if (i !== null) this.seats[i] = null;
    return i;
  }
}

export interface DroneScheduleOptions {
  /** Time away between visits. */
  intervalMs: number;
  /** How long it stays after landing before it leaves on its own. */
  stayMs: number;
  /** Delay before the first arrival (when it starts away). */
  firstArrivalMs: number;
  seed: number;
  /** Start parked on the pad (true) or away. */
  startLanded?: boolean;
}

export interface DroneHooks {
  /** Whether anyone is standing in the landing area. */
  padOccupied?: () => boolean;
  /** Direction the wind blows toward (degrees); the drone lands into the wind. */
  windDirection?: () => number;
  /** Whether anyone is aboard (it never leaves with people in it). */
  aboard?: () => boolean;
  /** Whether a straight flight from a to b would hit nothing (the drone's own size included). */
  clearPath?: (a: Vec3, b: Vec3) => boolean;
  onChange?: (next: DroneState, prev: DroneState) => void;
}

/** Waypoints from `from` up to a safe height, moving out from under the platform first if needed. */
export function climbOutRoute(from: Vec3, clear: (a: Vec3, b: Vec3) => boolean): Vec3[] {
  const up = (p: Vec3): Vec3 => [p[0], Math.max(p[1], DRONE_SAFE_Y), p[2]];
  if (from[1] >= DRONE_SAFE_Y - 0.5 || clear(from, up(from))) return from[1] >= DRONE_SAFE_Y - 0.5 ? [from] : [from, up(from)];
  const F = FOOTPRINT;
  const exits: Vec3[] = [
    [F.x0, from[1], from[2]],
    [F.x1, from[1], from[2]],
    [from[0], from[1], F.z0],
    [from[0], from[1], F.z1],
  ];
  exits.sort((a, b) => Math.hypot(a[0] - from[0], a[2] - from[2]) - Math.hypot(b[0] - from[0], b[2] - from[2]));
  for (const e of exits) if (clear(from, e) && clear(e, up(e))) return [from, e, up(e)];
  return [from, up(from)];
}

/** Arrival/departure state machine. Holds off while the pad is occupied; hands over to a pilot while landed. */
export class DroneScheduler {
  state: DroneState;
  private readonly opts: DroneScheduleOptions;
  private readonly hooks: DroneHooks;
  private readonly rand: () => number;

  constructor(opts: DroneScheduleOptions, now: number, hooks: DroneHooks = {}) {
    this.opts = opts;
    this.hooks = hooks;
    this.rand = mulberry32(opts.seed);
    const bearing = 90;
    const yaw = yawFacing(-1, 0);
    this.state = opts.startLanded
      ? { phase: 'landed', t0: now - DRONE_TIMING.spinDownMs, until: now + opts.stayMs, bearing, from: PAD, fromYaw: yaw, padYaw: yaw }
      : { phase: 'away', t0: now, until: now + opts.firstArrivalMs, bearing, from: droneFarPoint(bearing), fromYaw: yaw, padYaw: yaw };
  }

  pose(now: number) {
    return dronePose(this.state, now);
  }

  /** Inbound bearing: from downwind, kept to the open-sea (east) side of the pad. */
  private inboundBearing() {
    const wind = this.hooks.windDirection?.();
    const b = wind === undefined ? 60 + this.rand() * 60 : ((wind % 360) + 360) % 360;
    return Math.max(40, Math.min(140, b > 270 ? 40 : b));
  }

  private set(next: Omit<DroneState, 'bearing' | 'padYaw'> & Partial<Pick<DroneState, 'bearing' | 'padYaw'>>) {
    const prev = this.state;
    this.state = { bearing: prev.bearing, padYaw: prev.padYaw, ...next };
    this.hooks.onChange?.(this.state, prev);
  }

  /** Starts an approach now, wherever the schedule is (debug and tests). */
  summon(now: number) {
    if (this.state.phase === 'away') this.startApproach(now);
  }

  private startApproach(now: number) {
    const bearing = this.inboundBearing();
    const from = droneFarPoint(bearing);
    const [dx, dz] = bearingVector(bearing);
    const yaw = yawFacing(-dx, -dz);
    this.set({ phase: 'approach', t0: now, until: now + DRONE_TIMING.approachMs, bearing, from, fromYaw: yaw, padYaw: yaw });
  }

  private climbOut(from: Vec3): Vec3[] {
    return climbOutRoute(from, this.hooks.clearPath ?? (() => true));
  }

  private startDepart(now: number) {
    const p = this.pose(now);
    const bearing = 50 + this.rand() * 80;
    const route = [...this.climbOut(p.position), droneFarPoint(bearing)];
    this.set({ phase: 'depart', t0: now, until: now + routeMs(route), bearing, from: p.position, fromYaw: p.yaw, route });
  }

  /** A pilot takes the controls. Only while it stands still somewhere. */
  takeControl(now: number): boolean {
    if (this.state.phase !== 'landed') return false;
    this.set({ phase: 'piloted', t0: now, until: Infinity, from: this.state.from, fromYaw: this.state.padYaw, padYaw: this.state.padYaw });
    return true;
  }

  /** The pilot's latest pose, kept in the state so the schedule resumes from there. */
  track(position: Vec3, yaw: number) {
    if (this.state.phase !== 'piloted') return;
    this.state = { ...this.state, from: position, padYaw: yaw };
  }

  /** The pilot let go: parked where it stands, or flying itself back to the pad. */
  release(now: number, position: Vec3, yaw: number, grounded: boolean) {
    if (this.state.phase !== 'piloted') return;
    if (grounded) {
      this.set({ phase: 'landed', t0: now - DRONE_TIMING.spinDownMs * 0.6, until: now + this.opts.stayMs, from: position, fromYaw: yaw, padYaw: yaw });
      return;
    }
    const bearing = this.inboundBearing();
    const route = [...this.climbOut(position), droneHoverPoint(bearing)];
    const [dx, dz] = bearingVector(bearing);
    this.set({ phase: 'return', t0: now, until: now + routeMs(route), bearing, from: position, fromYaw: yaw, padYaw: yawFacing(-dx, -dz), route });
  }

  update(now: number) {
    const s = this.state;
    const occupied = () => this.hooks.padOccupied?.() ?? false;
    switch (s.phase) {
      case 'away':
        if (now >= s.until) this.startApproach(now);
        break;
      case 'approach':
      case 'return':
        if (now >= s.until) {
          const from = droneHoverPoint(s.bearing);
          const yaw = this.pose(now).yaw;
          const phase = occupied() ? 'hold' : 'descend';
          this.set({ phase, t0: now, until: now + (phase === 'hold' ? DRONE_TIMING.holdMaxMs : DRONE_TIMING.descendMs), from, fromYaw: yaw });
        }
        break;
      case 'hold':
        if (now - s.t0 > DRONE_TIMING.holdSettleMs && !occupied()) {
          const p = this.pose(now);
          this.set({ phase: 'descend', t0: now, until: now + DRONE_TIMING.descendMs, from: p.position, fromYaw: p.yaw });
        } else if (now >= s.until) {
          this.startDepart(now); // gave up waiting: go around and leave
        }
        break;
      case 'descend': {
        const p = this.pose(now);
        if (p.altitude > 2.5 && occupied()) {
          // Wave-off: climb back to the hover point and wait.
          this.set({ phase: 'hold', t0: now, until: now + DRONE_TIMING.holdMaxMs, from: p.position, fromYaw: p.yaw });
        } else if (now >= s.until) {
          this.set({ phase: 'landed', t0: now, until: now + this.opts.stayMs, from: PAD, fromYaw: s.padYaw });
        }
        break;
      }
      case 'landed':
        if (now >= s.until) {
          // Never leaves with someone aboard: try again a little later.
          if (this.hooks.aboard?.()) this.set({ ...s, until: now + 30_000 });
          else this.startDepart(now);
        }
        break;
      case 'depart':
        if (now >= s.until) {
          this.set({ phase: 'away', t0: now, until: now + this.opts.intervalMs, from: droneFarPoint(s.bearing), fromYaw: this.pose(now).yaw });
        }
        break;
      case 'piloted':
        break;
    }
  }
}

/** Whether the drone could fly straight from a to b (skid points) without touching the platform. */
export function droneClearPath(sw: StaticWorld, a: Vec3, b: Vec3): boolean {
  const { R, world, info } = sw;
  const shape = new R.Cuboid(4.2, 1.2, 4.2);
  const d = { x: b[0] - a[0], y: b[1] - a[1], z: b[2] - a[2] };
  const hit = world.castShape({ x: a[0], y: a[1] + 1.3, z: a[2] }, { x: 0, y: 0, z: 0, w: 1 }, d, shape, 0, 1, true, undefined, undefined, undefined, undefined, (c) => {
    const i = info.get(c.handle);
    return !!i && i.kind !== 'drone';
  });
  return !hit;
}

// ---------- flight model ----------

export interface DroneInput {
  /** -1..1 along the view direction. */
  forward: number;
  /** -1..1 to the right of the view direction. */
  right: number;
  /** -1..1, climb or descend. */
  up: number;
  /** View yaw: the drone turns to face it and moves relative to it. */
  yaw: number;
}

/** Skids to duct tops, out to the nav lights. */
const BODY_HALF = { x: 4.1, y: (DRONE.ductY + 0.25) / 2, z: 3.95 };

/**
 * Arcade multicopter flown by its pilot's browser: velocity follows the stick with limited
 * acceleration, it holds position when the stick is released, turns towards where the pilot
 * looks, and collides with the platform through Rapier's character controller.
 */
export class DroneFlight {
  readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly sw: StaticWorld;
  readonly position = { x: 0, y: 0, z: 0 };
  readonly velocity = { x: 0, y: 0, z: 0 };
  yaw = 0;
  pitch = 0;
  roll = 0;
  rotor = 0.4;
  grounded = true;
  private ax = 0;
  private az = 0;

  constructor(sw: StaticWorld, start: Vec3, yaw: number) {
    this.sw = sw;
    const { R, world } = sw;
    this.collider = world.createCollider(R.ColliderDesc.cuboid(BODY_HALF.x, BODY_HALF.y, BODY_HALF.z));
    this.controller = world.createCharacterController(0.04);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setMaxSlopeClimbAngle(0.5);
    this.controller.setMinSlopeSlideAngle(0.6);
    this.controller.disableAutostep();
    this.controller.disableSnapToGround();
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.teleport(start, yaw);
  }

  teleport(p: Vec3, yaw: number) {
    this.position.x = p[0];
    this.position.y = p[1];
    this.position.z = p[2];
    this.velocity.x = this.velocity.y = this.velocity.z = 0;
    this.yaw = yaw;
    this.sync();
  }

  private sync() {
    this.collider.setTranslation({ x: this.position.x, y: this.position.y + BODY_HALF.y + 0.02, z: this.position.z });
    this.collider.setRotation({ x: 0, y: Math.sin(this.yaw / 2), z: 0, w: Math.cos(this.yaw / 2) });
  }

  step(input: DroneInput, dt: number) {
    const fx = -Math.sin(input.yaw);
    const fz = -Math.cos(input.yaw);
    const rx = -fz;
    const rz = fx;
    let ix = fx * input.forward + rx * input.right;
    let iz = fz * input.forward + rz * input.right;
    const il = Math.hypot(ix, iz);
    if (il > 1) {
      ix /= il;
      iz /= il;
    }
    const up = Math.max(-1, Math.min(1, input.up));
    // On the ground it only lifts off; sideways input waits until it is airborne.
    const lifting = up > 0.05;
    const flying = !this.grounded || lifting;
    const tx = flying ? ix * DRONE.maxSpeed : 0;
    const tz = flying ? iz * DRONE.maxSpeed : 0;
    let ty = up > 0 ? up * DRONE.maxClimb : up * DRONE.maxDescent;
    // Gentle on the last metres down, like a pilot easing it onto the deck.
    const below = this.groundBelow(8);
    if (ty < 0 && below !== null) ty = Math.max(ty, -Math.max(0.6, below * 0.9));
    // Accelerates briskly and brakes harder still, so it stops where the pilot lets go.
    const braking = Math.hypot(tx, tz) < Math.hypot(this.velocity.x, this.velocity.z) - 0.5;
    const ah = this.grounded ? 3 : braking ? 11 : 7;
    const dvx = tx - this.velocity.x;
    const dvz = tz - this.velocity.z;
    const dl = Math.hypot(dvx, dvz);
    const k = Math.min(1, (ah * dt) / Math.max(dl, 1e-6));
    const prevVx = this.velocity.x;
    const prevVz = this.velocity.z;
    this.velocity.x += dvx * k;
    this.velocity.z += dvz * k;
    const dvy = ty - this.velocity.y;
    this.velocity.y += Math.sign(dvy) * Math.min(Math.abs(dvy), 5 * dt);
    if (this.grounded && !lifting) this.velocity.y = Math.min(this.velocity.y, 0);
    // Sea and ceiling limits.
    if (this.position.y < DRONE.minSeaAltitude && this.velocity.y < 0 && below === null) this.velocity.y = 0;
    if (this.position.y > DRONE.maxAltitude && this.velocity.y > 0) this.velocity.y = 0;

    // Turn towards the view.
    let dyaw = (input.yaw - this.yaw) % (Math.PI * 2);
    if (dyaw > Math.PI) dyaw -= Math.PI * 2;
    if (dyaw < -Math.PI) dyaw += Math.PI * 2;
    if (flying) this.yaw += Math.max(-DRONE.maxYawRate * dt, Math.min(DRONE.maxYawRate * dt, dyaw * 2.5 * dt));

    const desired = { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt };
    this.sync();
    const { info } = this.sw;
    this.controller.computeColliderMovement(this.collider, desired, undefined, undefined, (c) => {
      const i = info.get(c.handle);
      return !!i && i.kind !== 'drone';
    });
    const moved = this.controller.computedMovement();
    this.position.x += moved.x;
    this.position.y += moved.y;
    this.position.z += moved.z;
    // Hitting something stops the motion into it.
    if (Math.abs(moved.x) < Math.abs(desired.x) * 0.5) this.velocity.x *= 0.3;
    if (Math.abs(moved.z) < Math.abs(desired.z) * 0.5) this.velocity.z *= 0.3;
    if (Math.abs(moved.y) < Math.abs(desired.y) * 0.5) this.velocity.y = 0;
    const touching = this.controller.computedGrounded();
    this.grounded = touching && !lifting && Math.hypot(this.velocity.x, this.velocity.z) < 2.5;
    if (this.grounded) {
      this.velocity.x *= Math.max(0, 1 - 6 * dt);
      this.velocity.z *= Math.max(0, 1 - 6 * dt);
    }
    this.sync();

    // Lean into the acceleration (smoothed), spin the rotors with the effort.
    const ax = (this.velocity.x - prevVx) / dt;
    const az = (this.velocity.z - prevVz) / dt;
    const s = Math.min(1, 6 * dt);
    this.ax += (ax - this.ax) * s;
    this.az += (az - this.az) * s;
    const tilt = tiltFrom([this.ax, 0, this.az], [this.velocity.x, 0, this.velocity.z], this.yaw);
    this.pitch += (tilt.pitch - this.pitch) * s;
    this.roll += (tilt.roll - this.roll) * s;
    if (this.grounded) {
      this.pitch *= 0.8;
      this.roll *= 0.8;
    }
    const effort = this.grounded ? 0.4 : 0.85 + 0.1 * Math.max(0, up) + 0.08 * Math.hypot(this.velocity.x, this.velocity.z) / DRONE.maxSpeed;
    this.rotor += (Math.min(1.1, effort) - this.rotor) * Math.min(1, 2.5 * dt);
  }

  /** Clearance under the skids, if anything solid is within `max` metres. */
  groundBelow(max: number): number | null {
    const { R, world, info } = this.sw;
    const ray = new R.Ray({ x: this.position.x, y: this.position.y + 0.3, z: this.position.z }, { x: 0, y: -1, z: 0 });
    const hit = world.castRay(ray, max + 0.3, true, undefined, undefined, this.collider, undefined, (c) => {
      const i = info.get(c.handle);
      return !!i && i.kind !== 'drone';
    });
    return hit ? Math.max(0, hit.timeOfImpact - 0.3) : null;
  }

  get pose(): DronePose {
    const p: Vec3 = [this.position.x, this.position.y, this.position.z];
    return {
      visible: true,
      position: p,
      velocity: [this.velocity.x, this.velocity.y, this.velocity.z],
      yaw: this.yaw,
      pitch: this.pitch,
      roll: this.roll,
      rotor: this.rotor,
      altitude: altitudeOf(p),
    };
  }

  dispose() {
    this.sw.world.removeCharacterController(this.controller);
    this.sw.world.removeCollider(this.collider, false);
  }
}

// ---------- autopilot ----------

export type AutopilotStage = 'climb' | 'cruise' | 'hold' | 'descend' | 'landed' | 'stuck';

/** Heading the drone parks with on the pad: nose towards the platform. */
export const PAD_YAW = yawFacing(-1, 0);
/** Comfortable accelerations the autopilot plans with, well inside the flight model's limits. */
const AP_ACCEL = 3.5;
const AP_VACCEL = 2.5;
/** Within this of an intermediate waypoint, it carries on to the next one without stopping. */
const AP_PASS = 3;
/** Over the pad: how close (m) and slow (m/s) before it starts down. */
const AP_OVER_PAD = 1.2;

/**
 * Flies the drone home and puts it down on the pad, by working the same stick a pilot uses
 * (so the flight model, its limits and the platform's colliders all still apply): out from
 * under the deck if it is there, up to a safe height, across to above the pad, then straight
 * down, turning to the parking heading on the way. It holds above the pad while anyone stands
 * on the landing circle, and gives up if something stops it making progress.
 */
export class DroneAutopilot {
  stage: AutopilotStage = 'climb';
  private readonly route: Vec3[];
  private leg = 1;
  private best = Infinity;
  private sinceProgress = 0;

  /** `clear`: whether a straight flight from a to b would hit nothing (droneClearPath). */
  constructor(from: Vec3, clear: (a: Vec3, b: Vec3) => boolean) {
    const above: Vec3 = [PAD[0], DRONE_SAFE_Y, PAD[2]];
    const overPad = Math.hypot(from[0] - PAD[0], from[2] - PAD[2]) < AP_OVER_PAD * 2 && from[1] >= PAD[1] - 0.5;
    if (overPad) {
      // Already over the pad: straight down.
      this.route = [from, [PAD[0], from[1], PAD[2]]];
      this.stage = 'descend';
    } else {
      const out = climbOutRoute(from, clear);
      this.route = [...out, above];
      this.stage = out.length > 1 ? 'climb' : 'cruise';
    }
  }

  /** Straight-line distance left to the pad (m), for the instruments. */
  distanceHome(p: Vec3) {
    return Math.hypot(p[0] - PAD[0], p[1] - PAD[1], p[2] - PAD[2]);
  }

  /** The stick for this step. `padOccupied`: someone stands on the landing circle. */
  step(flight: DroneFlight, dt: number, padOccupied = false): DroneInput {
    const p: Vec3 = [flight.position.x, flight.position.y, flight.position.z];
    const hold: DroneInput = { forward: 0, right: 0, up: 0, yaw: flight.yaw };
    if (this.stage === 'landed' || this.stage === 'stuck') return hold;
    let want: Vec3 = [0, 0, 0];
    let yaw = flight.yaw;
    if (this.stage === 'descend' || this.stage === 'hold') {
      // Over the pad: hold position over its centre, turn to the parking heading, and go down
      // once it is lined up and nobody is on the circle.
      const dx = PAD[0] - p[0];
      const dz = PAD[2] - p[2];
      const k = Math.min(1, 2.5 / Math.max(1e-6, Math.hypot(dx, dz)));
      yaw = PAD_YAW;
      const lined = Math.abs(angleDiff(flight.yaw, PAD_YAW)) < 0.25 && Math.hypot(dx, dz) < AP_OVER_PAD;
      this.stage = padOccupied && p[1] - PAD[1] > 2.5 ? 'hold' : 'descend';
      want = [dx * 1.2 * k, this.stage === 'descend' && lined ? -DRONE.maxDescent : 0, dz * 1.2 * k];
      if (flight.grounded) {
        this.stage = 'landed';
        return hold;
      }
      this.watchProgress(p[1] - PAD[1] + Math.hypot(dx, dz), dt);
    } else {
      const target = this.route[this.leg];
      const last = this.leg === this.route.length - 1;
      const d: Vec3 = [target[0] - p[0], target[1] - p[1], target[2] - p[2]];
      const dist = Math.hypot(d[0], d[1], d[2]);
      if ((!last && dist < AP_PASS) || (last && Math.hypot(d[0], d[2]) < AP_OVER_PAD && Math.abs(d[1]) < 1.5 && Math.hypot(flight.velocity.x, flight.velocity.z) < 1)) {
        this.leg++;
        this.best = Infinity;
        if (this.leg >= this.route.length) this.stage = 'descend';
        else this.stage = this.leg === this.route.length - 1 ? 'cruise' : 'climb';
        return this.step(flight, dt, padOccupied);
      }
      // Speed along the leg: as fast as the envelope allows, braking in time to stop at the
      // end of the last leg (intermediate waypoints are flown through).
      const dh = Math.hypot(d[0], d[2]);
      const brakeH = last ? Math.sqrt(2 * AP_ACCEL * dh) : DRONE.maxSpeed;
      const brakeV = Math.sqrt(2 * AP_VACCEL * Math.abs(d[1]));
      let vh = Math.min(DRONE.maxSpeed, brakeH);
      let vy = Math.sign(d[1]) * Math.min(d[1] > 0 ? DRONE.maxClimb : DRONE.maxDescent, brakeV);
      // Keep to the straight line between waypoints: scale both so neither runs ahead.
      if (dh > 1e-3 && Math.abs(d[1]) > 1e-3) {
        const s = Math.min(vh / dh, Math.abs(vy / d[1]));
        vh = dh * s;
        vy = d[1] * s;
      }
      want = dh > 1e-3 ? [(d[0] / dh) * vh, vy, (d[2] / dh) * vh] : [0, vy, 0];
      // Face where it is going once it moves along; otherwise keep the heading.
      if (dh > 8) yaw = yawFacing(d[0], d[2]);
      this.watchProgress(dist, dt);
    }
    return toStick(want, yaw);
  }

  /** Gives up when the distance to go has not shrunk by half a metre in 8 seconds. */
  private watchProgress(dist: number, dt: number) {
    if (this.stage === 'hold' || dist < this.best - 0.5) {
      this.best = this.stage === 'hold' ? Infinity : dist;
      this.sinceProgress = 0;
    } else if ((this.sinceProgress += dt) > 8) {
      this.stage = 'stuck';
    }
  }
}

function angleDiff(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** The stick deflections that ask the flight model for world velocity `v` while facing `yaw`. */
function toStick(v: Vec3, yaw: number): DroneInput {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = -fz;
  const rz = fx;
  return {
    forward: (v[0] * fx + v[2] * fz) / DRONE.maxSpeed,
    right: (v[0] * rx + v[2] * rz) / DRONE.maxSpeed,
    up: v[1] > 0 ? v[1] / DRONE.maxClimb : v[1] / DRONE.maxDescent,
    yaw,
  };
}
