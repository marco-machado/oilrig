import { HELI } from '../layout/dims.ts';
import type { Vec3 } from '../layout/types.ts';
import { mulberry32 } from './weather.ts';

// The visiting helicopter. The server runs the schedule (HeliScheduler) and broadcasts the
// state only when the phase changes; everyone evaluates the same pose function from that
// state and the shared clock, so the flight path never needs streaming.

export type HeliPhase = 'away' | 'approach' | 'hold' | 'descend' | 'landed' | 'depart';

export interface HeliState {
  phase: HeliPhase;
  /** Server time (ms) when this phase began. */
  t0: number;
  /** Server time (ms) when the phase is planned to end (landed: lift-off; away: next arrival). */
  until: number;
  /** Bearing of the inbound or outbound leg as seen from the pad, degrees clockwise from north. */
  bearing: number;
  /** Where this phase starts (skid level). */
  from: Vec3;
  fromYaw: number;
  /** Heading on the pad. */
  padYaw: number;
}

export interface HeliPose {
  visible: boolean;
  /** Skid-level reference point. */
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  roll: number;
  /** Main rotor speed as a fraction of flight rpm, 0..1. */
  rotor: number;
  /** Height of the skids above whatever is below (deck or sea). */
  altitude: number;
}

export const HELI_TIMING = {
  approachMs: 75_000,
  descendMs: 26_000,
  departMs: 75_000,
  holdMaxMs: 150_000,
  holdSettleMs: 8_000,
  spinDownMs: 20_000,
  spinUpMs: 30_000,
} as const;

const PAD: Vec3 = [HELI.pad[0], HELI.pad[1], HELI.pad[2]];
const FAR = 2400;
const CRUISE_ALT = 320;
const HOVER_OUT = 55;
const HOVER_ALT = 22;
const LIFT = 6;
const CRUISE_SPEED = 55; // m/s, about 107 kt
const ACCEL_S = 20;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number) => {
  const u = clamp01(v);
  return u * u * (3 - 2 * u);
};
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function lerpAngle(a: number, b: number, t: number) {
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

export function heliFarPoint(bearing: number): Vec3 {
  const [dx, dz] = bearingVector(bearing);
  return [PAD[0] + dx * FAR, PAD[1] + CRUISE_ALT, PAD[2] + dz * FAR];
}

export function heliHoverPoint(bearing: number): Vec3 {
  const [dx, dz] = bearingVector(bearing);
  return [PAD[0] + dx * HOVER_OUT, PAD[1] + HOVER_ALT, PAD[2] + dz * HOVER_OUT];
}

/** Skid position at a given time within the phase described by `s`. */
function positionAt(s: HeliState, now: number): Vec3 {
  const e = now - s.t0;
  switch (s.phase) {
    case 'away':
      return heliFarPoint(s.bearing);
    case 'approach': {
      // Quadratic ease-out: ~120 kt at the start, zero at the hover point.
      const u = clamp01(e / HELI_TIMING.approachMs);
      return lerp3(s.from, heliHoverPoint(s.bearing), 1 - (1 - u) * (1 - u));
    }
    case 'hold': {
      const p = lerp3(s.from, heliHoverPoint(s.bearing), smooth(e / HELI_TIMING.holdSettleMs));
      const bob = Math.sin((e / 7000) * Math.PI * 2) * 0.4;
      return [p[0], p[1] + bob, p[2]];
    }
    case 'descend': {
      const u = clamp01(e / HELI_TIMING.descendMs);
      const h = smooth(u / 0.8);
      const v = smooth(u);
      const h0 = s.from[1] - PAD[1];
      return [s.from[0] + (PAD[0] - s.from[0]) * h, PAD[1] + h0 * (1 - v), s.from[2] + (PAD[2] - s.from[2]) * h];
    }
    case 'landed':
      return PAD;
    case 'depart': {
      const u = clamp01(e / HELI_TIMING.departMs);
      const lift = smooth(u / 0.15) * LIFT;
      // Accelerate to cruise over ACCEL_S seconds, then fly on, climbing with distance.
      const tt = clamp01((u - 0.2) / 0.8) * (HELI_TIMING.departMs / 1000) * 0.8;
      const a = CRUISE_SPEED / ACCEL_S;
      const d = tt < ACCEL_S ? 0.5 * a * tt * tt : 0.5 * a * ACCEL_S * ACCEL_S + CRUISE_SPEED * (tt - ACCEL_S);
      const [dx, dz] = bearingVector(s.bearing);
      const climb = Math.min(1, d / FAR) * (CRUISE_ALT - LIFT);
      return [s.from[0] + dx * d, s.from[1] + lift + climb, s.from[2] + dz * d];
    }
  }
}

function yawAt(s: HeliState, now: number): number {
  const e = now - s.t0;
  switch (s.phase) {
    case 'away':
    case 'approach':
      return s.fromYaw;
    case 'hold':
      return s.fromYaw;
    case 'descend':
      return lerpAngle(s.fromYaw, s.padYaw, smooth(e / HELI_TIMING.descendMs / 0.7));
    case 'landed':
      return s.padYaw;
    case 'depart': {
      const [dx, dz] = bearingVector(s.bearing);
      return lerpAngle(s.fromYaw, yawFacing(dx, dz), smooth((e / HELI_TIMING.departMs - 0.08) / 0.2));
    }
  }
}

function rotorAt(s: HeliState, now: number): number {
  const e = now - s.t0;
  if (s.phase === 'away') return 0;
  if (s.phase !== 'landed') return 1;
  const down = 1 - smooth(e / HELI_TIMING.spinDownMs);
  const up = smooth(1 - (s.until - now) / HELI_TIMING.spinUpMs);
  return Math.max(down, up);
}

/** Evaluates the helicopter at `now` (server ms). Pure: same state + time, same pose. */
export function heliPose(s: HeliState, now: number): HeliPose {
  const p = positionAt(s, now);
  const h = 250;
  const a = positionAt(s, now - h);
  const b = positionAt(s, now + h);
  const dt = (2 * h) / 1000;
  const vel: Vec3 = [(b[0] - a[0]) / dt, (b[1] - a[1]) / dt, (b[2] - a[2]) / dt];
  const k = (h / 1000) ** 2;
  const acc: Vec3 = [(b[0] - 2 * p[0] + a[0]) / k, (b[1] - 2 * p[1] + a[1]) / k, (b[2] - 2 * p[2] + a[2]) / k];
  const yaw = yawAt(s, now);
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const vf = vel[0] * fx + vel[2] * fz;
  const af = acc[0] * fx + acc[2] * fz;
  const ar = acc[0] * rx + acc[2] * rz;
  const cl = (v: number, m: number) => Math.max(-m, Math.min(m, v));
  const onPad = s.phase === 'landed';
  const overPad = Math.hypot(p[0] - PAD[0], p[2] - PAD[2]) < 12;
  return {
    visible: s.phase !== 'away',
    position: p,
    velocity: vel,
    yaw,
    pitch: onPad ? 0 : cl(-af * 0.05 - vf * 0.0022, 0.32),
    roll: onPad ? 0 : cl(-ar * 0.06, 0.35),
    rotor: rotorAt(s, now),
    altitude: overPad ? p[1] - PAD[1] : p[1],
  };
}

/** Box colliders of the helicopter parked on the pad: [centre, half extents, yaw]. */
export function heliBodyBoxes(padYaw: number): Array<{ center: Vec3; half: Vec3; yaw: number }> {
  const fx = -Math.sin(padYaw);
  const fz = -Math.cos(padYaw);
  const at = (fwd: number, up: number): Vec3 => [PAD[0] + fx * fwd, PAD[1] + up, PAD[2] + fz * fwd];
  return [
    // Cabin and engine deck (nose towards local -z).
    { center: at(0.6, 1.3), half: [1.0, 1.2, 2.4], yaw: padYaw },
    // Tail boom and fin.
    { center: at(-4.0, 1.5), half: [0.35, 0.6, 2.3], yaw: padYaw },
  ];
}

export function padOccupied(positions: Iterable<Vec3>): boolean {
  for (const p of positions) {
    if (Math.hypot(p[0] - PAD[0], p[2] - PAD[2]) < HELI.clearRadius && p[1] > PAD[1] - 0.6 && p[1] < PAD[1] + 4) return true;
  }
  return false;
}

export interface HeliScheduleOptions {
  /** Time between arrivals. */
  intervalMs: number;
  /** How long it stays on the pad. */
  stayMs: number;
  /** Delay before the first arrival. */
  firstArrivalMs: number;
  seed: number;
}

export interface HeliHooks {
  /** Whether anyone is standing in the landing area. */
  padOccupied?: () => boolean;
  /** Direction the wind blows toward (degrees); the helicopter lands into the wind. */
  windDirection?: () => number;
  onChange?: (next: HeliState, prev: HeliState) => void;
}

/** Arrival/departure state machine. Holds off while the pad is occupied. */
export class HeliScheduler {
  state: HeliState;
  private readonly opts: HeliScheduleOptions;
  private readonly hooks: HeliHooks;
  private readonly rand: () => number;

  constructor(opts: HeliScheduleOptions, now: number, hooks: HeliHooks = {}) {
    this.opts = opts;
    this.hooks = hooks;
    this.rand = mulberry32(opts.seed);
    const bearing = 90;
    this.state = {
      phase: 'away',
      t0: now,
      until: now + opts.firstArrivalMs,
      bearing,
      from: heliFarPoint(bearing),
      fromYaw: 0,
      padYaw: 0,
    };
  }

  pose(now: number) {
    return heliPose(this.state, now);
  }

  /** Inbound bearing: from downwind, kept to the open-sea (east) side of the pad. */
  private inboundBearing() {
    const wind = this.hooks.windDirection?.();
    const b = wind === undefined ? 60 + this.rand() * 60 : ((wind % 360) + 360) % 360;
    return Math.max(40, Math.min(140, b > 270 ? 40 : b));
  }

  private set(next: Omit<HeliState, 'bearing' | 'padYaw'> & Partial<Pick<HeliState, 'bearing' | 'padYaw'>>) {
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
    const from = heliFarPoint(bearing);
    const [dx, dz] = bearingVector(bearing);
    const yaw = yawFacing(-dx, -dz);
    this.set({ phase: 'approach', t0: now, until: now + HELI_TIMING.approachMs, bearing, from, fromYaw: yaw, padYaw: yaw });
  }

  private startDepart(now: number) {
    const p = this.pose(now);
    const bearing = 50 + this.rand() * 80;
    this.set({ phase: 'depart', t0: now, until: now + HELI_TIMING.departMs, bearing, from: p.position, fromYaw: p.yaw });
  }

  update(now: number) {
    const s = this.state;
    const occupied = () => this.hooks.padOccupied?.() ?? false;
    switch (s.phase) {
      case 'away':
        if (now >= s.until) this.startApproach(now);
        break;
      case 'approach':
        if (now >= s.until) {
          const from = heliHoverPoint(s.bearing);
          const phase = occupied() ? 'hold' : 'descend';
          this.set({ phase, t0: now, until: now + (phase === 'hold' ? HELI_TIMING.holdMaxMs : HELI_TIMING.descendMs), from, fromYaw: s.fromYaw });
        }
        break;
      case 'hold':
        if (now - s.t0 > HELI_TIMING.holdSettleMs && !occupied()) {
          const p = this.pose(now);
          this.set({ phase: 'descend', t0: now, until: now + HELI_TIMING.descendMs, from: p.position, fromYaw: p.yaw });
        } else if (now >= s.until) {
          this.startDepart(now); // gave up waiting: go around and leave
        }
        break;
      case 'descend': {
        const p = this.pose(now);
        if (p.altitude > 2.5 && occupied()) {
          // Wave-off: climb back to the hover point and wait.
          this.set({ phase: 'hold', t0: now, until: now + HELI_TIMING.holdMaxMs, from: p.position, fromYaw: p.yaw });
        } else if (now >= s.until) {
          this.set({ phase: 'landed', t0: now, until: now + this.opts.stayMs, from: PAD, fromYaw: s.padYaw });
        }
        break;
      }
      case 'landed':
        if (now >= s.until) this.startDepart(now);
        break;
      case 'depart':
        if (now >= s.until) {
          this.set({ phase: 'away', t0: now, until: now + this.opts.intervalMs, from: heliFarPoint(s.bearing), fromYaw: s.fromYaw });
        }
        break;
    }
  }
}
