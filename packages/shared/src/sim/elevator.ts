import { ELEVATOR } from '../layout/dims.ts';
import type { Vec3 } from '../layout/types.ts';

// The elevator is a state plus a pure timeline, like the drone schedule: the server owns the
// state and broadcasts it only when it changes, and everyone evaluates the car height and the
// doors from it and the shared clock.

export interface ElevatorState {
  /** Stop index the trip starts from. */
  from: number;
  /** Stop index the trip goes to. Equal to `from`: standing at that stop. */
  to: number;
  /** Server ms when the trip began (doors start closing) or, standing, when the doors began opening. */
  t0: number;
}

export type ElevatorPhase = 'closing' | 'travel' | 'opening' | 'open';

export interface ElevatorPose {
  /** Car floor height. */
  y: number;
  /** Vertical speed, m/s. */
  vy: number;
  /** 0 closed .. 1 open. */
  doors: number;
  phase: ElevatorPhase;
  /** Stop the car stands at, or null while travelling. */
  stop: number | null;
  /** Server ms since which the doors have been fully open (open phase only). */
  openSince: number;
}

const { stops, speed, accel, doorMs } = ELEVATOR;

/** Travel time between two stops with a trapezoidal speed profile. */
export function travelMs(from: number, to: number) {
  const d = Math.abs(stops[to] - stops[from]);
  const da = (speed * speed) / accel; // distance to reach full speed and stop again
  const s = d >= da ? d / speed + speed / accel : 2 * Math.sqrt(d / accel);
  return s * 1000;
}

/** Distance covered after t seconds of a trip of length d. */
function travelled(d: number, t: number): { x: number; v: number } {
  const da = (speed * speed) / accel;
  if (d >= da) {
    const ta = speed / accel;
    const total = d / speed + ta;
    if (t <= 0) return { x: 0, v: 0 };
    if (t < ta) return { x: 0.5 * accel * t * t, v: accel * t };
    if (t < total - ta) return { x: 0.5 * accel * ta * ta + speed * (t - ta), v: speed };
    if (t < total) {
      const r = total - t;
      return { x: d - 0.5 * accel * r * r, v: accel * r };
    }
    return { x: d, v: 0 };
  }
  const half = Math.sqrt(d / accel);
  if (t <= 0) return { x: 0, v: 0 };
  if (t < half) return { x: 0.5 * accel * t * t, v: accel * t };
  if (t < 2 * half) {
    const r = 2 * half - t;
    return { x: d - 0.5 * accel * r * r, v: accel * r };
  }
  return { x: d, v: 0 };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (v: number) => {
  const u = clamp01(v);
  return u * u * (3 - 2 * u);
};

export function elevatorPose(s: ElevatorState, now: number): ElevatorPose {
  const e = now - s.t0;
  if (s.from === s.to) {
    const doors = ease(e / doorMs);
    return { y: stops[s.to], vy: 0, doors, phase: e < doorMs ? 'opening' : 'open', stop: s.to, openSince: s.t0 + doorMs };
  }
  if (e < doorMs) return { y: stops[s.from], vy: 0, doors: 1 - ease(e / doorMs), phase: 'closing', stop: s.from, openSince: 0 };
  const tt = travelMs(s.from, s.to);
  const dir = Math.sign(stops[s.to] - stops[s.from]);
  if (e < doorMs + tt) {
    const r = travelled(Math.abs(stops[s.to] - stops[s.from]), (e - doorMs) / 1000);
    return { y: stops[s.from] + dir * r.x, vy: dir * r.v, doors: 0, phase: 'travel', stop: null, openSince: 0 };
  }
  const o = e - doorMs - tt;
  return { y: stops[s.to], vy: 0, doors: ease(o / doorMs), phase: o < doorMs ? 'opening' : 'open', stop: s.to, openSince: s.t0 + 2 * doorMs + tt };
}

/** Whether the landing gate at `stop` lets people through: the car is there with its doors mostly open. */
export function gateOpen(p: ElevatorPose, stop: number) {
  return p.stop === stop && p.doors > 0.6;
}

/** The doorway volume in front of a stop's gate, for the door sensor. */
export function inDoorway(stop: number, p: readonly [number, number, number]) {
  const { door, z0 } = ELEVATOR;
  const y = stops[stop];
  return p[0] > door.x0 - 0.3 && p[0] < door.x1 + 0.3 && p[2] > z0 - 0.45 && p[2] < z0 + 0.45 && p[1] > y - 0.5 && p[1] < y + 1.5;
}

/** Whether a position (feet) is inside the car at height `carY`. */
export function inCar(carY: number, p: readonly [number, number, number]) {
  const { x0, x1, z0, z1 } = ELEVATOR;
  return p[0] > x0 && p[0] < x1 && p[2] > z0 + 0.02 && p[2] < z1 && p[1] > carY - 0.6 && p[1] < carY + 2.3;
}

export interface ElevatorPanel {
  /** The stop this landing panel calls the car to. */
  stop: number;
  /** Button centre. */
  position: Vec3;
}

/** Call buttons on the post beside each landing door. */
export function elevatorPanels(): ElevatorPanel[] {
  const { door, z0 } = ELEVATOR;
  return stops.map((y, stop) => ({ stop, position: [door.x1 + 0.24, y + 1.15, z0 - 0.1] as Vec3 }));
}

/** The panel inside the car, on its east wall by the door. */
export function carPanel(carY: number): Vec3 {
  return [ELEVATOR.x1 - 0.08, carY + 1.15, ELEVATOR.z0 + 0.42];
}

export interface ElevatorHooks {
  /** Whether anyone stands in the doorway of a stop (the door sensor). */
  doorwayOccupied?: (stop: number) => boolean;
  onChange?: (next: ElevatorState) => void;
}

/** The car's controller: answers calls one at a time and never closes the doors on anyone. */
export class ElevatorController {
  state: ElevatorState;
  /** Requested stop not yet served. */
  pending: number | null = null;
  private readonly hooks: ElevatorHooks;

  constructor(now: number, hooks: ElevatorHooks = {}, startStop = 1) {
    this.hooks = hooks;
    this.state = { from: startStop, to: startStop, t0: now - 2 * doorMs };
  }

  pose(now: number) {
    return elevatorPose(this.state, now);
  }

  private set(s: ElevatorState) {
    this.state = s;
    this.hooks.onChange?.(s);
  }

  /** A call from a landing button, or the button inside the car. */
  call(stop: number, now: number) {
    if (stop < 0 || stop >= stops.length) return;
    const p = this.pose(now);
    if (p.stop === stop && p.phase !== 'closing') {
      this.pending = null;
      return; // already here with the doors open or opening
    }
    if (p.phase === 'closing' && p.stop === stop) {
      this.reopen(now, p.doors);
      return;
    }
    this.pending = stop;
    this.update(now);
  }

  private reopen(now: number, doors: number) {
    // Continue from where the doors are: opening runs doors 0→1 over doorMs.
    this.set({ from: this.state.from, to: this.state.from, t0: now - doors * doorMs });
  }

  update(now: number) {
    const p = this.pose(now);
    if (p.phase === 'closing' && this.hooks.doorwayOccupied?.(this.state.from)) {
      this.pending = this.state.to;
      this.reopen(now, p.doors);
      return;
    }
    if (p.phase !== 'open' || this.pending === null) return;
    if (this.pending === p.stop) {
      this.pending = null;
      return;
    }
    if (now - p.openSince < ELEVATOR.dwellMs) return;
    if (this.hooks.doorwayOccupied?.(p.stop!)) return;
    const to = this.pending;
    this.pending = null;
    this.set({ from: p.stop!, to, t0: now });
  }
}
