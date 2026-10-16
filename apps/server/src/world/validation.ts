import { PLAYER, type StaticWorld, type Vec3 } from '@ocean-home/shared';

export interface AcceptedPose {
  p: Vec3;
  /** Server receive time, ms. */
  t: number;
}

export type Verdict = { ok: true } | { ok: false; reason: 'too-fast' | 'too-high' | 'through-wall' | 'inside-geometry' };

// A slimmer capsule lifted above step height: floors, ramps and small steps never
// touch it, but walls, rails and glass do.
const PROBE_RADIUS = 0.2;
const PROBE_HALF = 0.42;
const PROBE_LIFT = PLAYER.maxStepHeight + 0.05;
const PROBE_CENTER = PROBE_LIFT + PROBE_RADIUS + PROBE_HALF;

/** Server-side sanity checks for client-predicted movement. */
export class MovementValidator {
  private readonly sw: StaticWorld;
  private readonly probe;

  constructor(sw: StaticWorld) {
    this.sw = sw;
    this.probe = new sw.R.Capsule(PROBE_HALF, PROBE_RADIUS);
  }

  check(prev: AcceptedPose, next: Vec3, now: number): Verdict {
    const dt = Math.min(Math.max((now - prev.t) / 1000, 0.016), 1.0);
    const dx = next[0] - prev.p[0];
    const dy = next[1] - prev.p[1];
    const dz = next[2] - prev.p[2];
    const horizontal = Math.hypot(dx, dz);
    // Generous slack for network jitter and bursty delivery.
    if (horizontal > PLAYER.runSpeed * 1.5 * dt + 0.75) return { ok: false, reason: 'too-fast' };
    if (dy > Math.max(PLAYER.jumpSpeed, PLAYER.runSpeed * 0.8) * dt + 0.9) return { ok: false, reason: 'too-high' };

    const { world, info } = this.sw;
    const rot = { x: 0, y: 0, z: 0, w: 1 };
    const filter = (c: { handle: number }) => info.has(c.handle);
    const end = { x: next[0], y: next[1] + PROBE_CENTER, z: next[2] };
    if (world.intersectionWithShape(end, rot, this.probe, undefined, undefined, undefined, undefined, filter)) {
      return { ok: false, reason: 'inside-geometry' };
    }
    const len = Math.hypot(dx, dy, dz);
    if (len > 1e-4) {
      const start = { x: prev.p[0], y: prev.p[1] + PROBE_CENTER, z: prev.p[2] };
      const hit = world.castShape(start, rot, { x: dx, y: dy, z: dz }, this.probe, 0, 1, true, undefined, undefined, undefined, undefined, filter);
      if (hit && hit.time_of_impact < 1 - 1e-3) return { ok: false, reason: 'through-wall' };
    }
    return { ok: true };
  }
}
