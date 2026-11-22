import { PLAYER, type StaticWorld, type Vec3 } from '@oilrig/shared';

export type Verdict =
  | { ok: true }
  | { ok: false; reason: 'too-fast' | 'too-high' | 'through-wall' | 'inside-geometry' }
  /** In the air for longer, or higher, than a jump allows: back to where the feet last had ground. */
  | { ok: false; reason: 'unsupported'; to: Vec3 };

/** What the server remembers about one person's movement between poses. The allowances
 * fill with time, not with messages, so sending more poses does not buy more distance. */
export interface Track {
  /** The last accepted position (feet). */
  p: Vec3;
  /** Server time of the last pose looked at, ms. */
  t: number;
  /** Horizontal metres that may still be covered. */
  reach: number;
  /** Metres that may still be climbed. */
  lift: number;
  /** Where the feet last had something under them, and when. */
  ground: Vec3;
  groundT: number;
}

// A slimmer capsule lifted above step height: floors, ramps and small steps never
// touch it, but walls, rails and glass do.
const PROBE_RADIUS = 0.2;
const PROBE_HALF = 0.42;
const PROBE_LIFT = PLAYER.maxStepHeight + 0.05;
const PROBE_CENTER = PROBE_LIFT + PROBE_RADIUS + PROBE_HALF;

/** Sustained horizontal speed: a run, plus a little for clocks that drift. */
const REACH_RATE = PLAYER.runSpeed * 1.2;
/** Saved-up distance, for poses that arrive in a burst after a stall of about half a second. */
const REACH_CAP = 4.5;
/** Sustained climb: faster than a jump takes off, the steepest stair at a run or the elevator. */
const LIFT_RATE = 5;
/** A whole jump (0.76 m at its top) arriving in one late pose. */
const LIFT_CAP = 1.2;

// Ground counts when it is within this far under the feet: the controller snaps down 0.35 m,
// and someone riding the elevator is a pose behind the car.
const SUPPORT_DROP = 0.5;
// A ball a little slimmer than the body, so a wall the body leans on is never "ground".
const SUPPORT_RADIUS = PLAYER.radius - 0.02;
const SUPPORT_START = PLAYER.maxStepHeight;
/** Slopes steeper than this (about 60°) hold nobody up. */
const SUPPORT_MIN_NORMAL_Y = 0.5;
/** Late poses: the fall may start this long after an honest jump would have peaked. */
const AIR_GRACE_S = 0.4;
/** Height above the highest honest jump that is still accepted. */
const AIR_SLACK = 0.5;

const JUMP_PEAK_S = PLAYER.jumpSpeed / PLAYER.gravity;
const JUMP_PEAK = (PLAYER.jumpSpeed * PLAYER.jumpSpeed) / (2 * PLAYER.gravity);

/** The highest anyone can honestly be above the ground they last stood on, `s` seconds after
 * leaving it: the top of a jump at first, then no higher than a fall from there. */
function airCeiling(s: number) {
  const fall = Math.max(0, s - JUMP_PEAK_S - AIR_GRACE_S);
  return JUMP_PEAK + AIR_SLACK - 0.5 * PLAYER.gravity * fall * fall;
}

const ROT = { x: 0, y: 0, z: 0, w: 1 };

/** Server-side sanity checks for client-predicted movement. */
export class MovementValidator {
  private readonly sw: StaticWorld;
  private readonly probe;
  private readonly foot;
  private readonly solid: (c: { handle: number }) => boolean;

  constructor(sw: StaticWorld) {
    this.sw = sw;
    this.probe = new sw.R.Capsule(PROBE_HALF, PROBE_RADIUS);
    this.foot = new sw.R.Ball(SUPPORT_RADIUS);
    this.solid = (c) => sw.info.has(c.handle);
  }

  /** Starts tracking someone from a position the server put them at, or already accepted. */
  start(p: Vec3, now: number): Track {
    return { p, t: now, reach: REACH_CAP, lift: LIFT_CAP, ground: p, groundT: now };
  }

  /** Whether a body at `p` (feet) overlaps a wall, a rail, glass or furniture. */
  blocked(p: Vec3) {
    const at = { x: p[0], y: p[1] + PROBE_CENTER, z: p[2] };
    return this.sw.world.intersectionWithShape(at, ROT, this.probe, undefined, undefined, undefined, undefined, this.solid) !== null;
  }

  /** The ground under the feet at `p` (a floor, a ramp, a net, the elevator car): the height
   * the feet rest at, never above `p`; null when nothing is within reach. */
  groundUnder(p: Vec3): number | null {
    const { world, R } = this.sw;
    const y = p[1] + SUPPORT_START;
    const reach = SUPPORT_START + SUPPORT_DROP;
    const hit = world.castShape({ x: p[0], y: y + SUPPORT_RADIUS, z: p[2] }, ROT, { x: 0, y: -1, z: 0 }, this.foot, 0, reach, true, undefined, undefined, undefined, undefined, this.solid);
    if (hit && hit.normal1.y > SUPPORT_MIN_NORMAL_Y) return Math.min(p[1], y - hit.time_of_impact);
    // The ball met something steep first (a brace, the foot of a rail): look straight down.
    const ray = new R.Ray({ x: p[0], y, z: p[2] }, { x: 0, y: -1, z: 0 });
    const below = world.castRay(ray, reach, false, undefined, undefined, undefined, undefined, this.solid);
    return below ? Math.min(p[1], y - below.timeOfImpact) : null;
  }

  /** A place someone can be put: free of geometry, with ground under it. */
  standable(p: Vec3) {
    return !this.blocked(p) && this.groundUnder(p) !== null;
  }

  /** Checks the next pose against the track, and moves the track on if it is accepted. */
  check(track: Track, next: Vec3, now: number): Verdict {
    const dt = Math.min(Math.max((now - track.t) / 1000, 0), 1);
    track.t = now;
    track.reach = Math.min(REACH_CAP, track.reach + REACH_RATE * dt);
    track.lift = Math.min(LIFT_CAP, track.lift + LIFT_RATE * dt);

    const prev = track.p;
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const dz = next[2] - prev[2];
    const horizontal = Math.hypot(dx, dz);
    if (horizontal > track.reach) return { ok: false, reason: 'too-fast' };
    if (dy > track.lift) return { ok: false, reason: 'too-high' };

    if (this.blocked(next)) return { ok: false, reason: 'inside-geometry' };
    if (Math.hypot(dx, dy, dz) > 1e-4) {
      const start = { x: prev[0], y: prev[1] + PROBE_CENTER, z: prev[2] };
      const hit = this.sw.world.castShape(start, ROT, { x: dx, y: dy, z: dz }, this.probe, 0, 1, true, undefined, undefined, undefined, undefined, this.solid);
      if (hit && hit.time_of_impact < 1 - 1e-3) return { ok: false, reason: 'through-wall' };
    }

    const floor = this.groundUnder(next);
    if (floor === null) {
      // Nothing underfoot: only a jump or a fall from the last ground explains being here.
      const airborne = (now - track.groundT) / 1000;
      if (next[1] > track.ground[1] + airCeiling(airborne)) return { ok: false, reason: 'unsupported', to: track.ground };
    }

    track.reach -= horizontal;
    track.lift -= Math.max(0, dy);
    track.p = next;
    if (floor !== null) {
      // A jump is measured from the floor it left, not from the first pose in the air.
      track.ground = [next[0], floor, next[2]];
      track.groundT = now;
    }
    return { ok: true };
  }
}
