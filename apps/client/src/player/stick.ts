/** Radius of the on-screen stick, in CSS pixels. */
export const STICK_RADIUS = 56;
/** Fraction of the radius around the centre that does nothing, so a resting thumb stands still. */
export const STICK_DEAD_ZONE = 0.14;
/** Dragging this many radii from the centre runs. */
export const STICK_RUN_AT = 1.6;

export interface StickState {
  /** -1..1, forward positive. */
  forward: number;
  /** -1..1, right positive. */
  right: number;
  run: boolean;
  /** Where to draw the knob, in CSS pixels from the centre (never outside the ring). */
  knobX: number;
  knobY: number;
}

/**
 * The on-screen stick: a drag of (dx, dy) CSS pixels from where the thumb went down (screen
 * axes, y down) as movement input. Past the dead zone the speed grows evenly to full at the
 * ring, and a drag well beyond the ring runs.
 */
export function stickVector(dx: number, dy: number, radius = STICK_RADIUS): StickState {
  const d = Math.hypot(dx, dy);
  const raw = d / radius;
  if (!(raw > STICK_DEAD_ZONE)) return { forward: 0, right: 0, run: false, knobX: dx, knobY: dy };
  const amount = Math.min(1, (raw - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE));
  const ux = dx / d;
  const uy = dy / d;
  const reach = Math.min(d, radius);
  // "+ 0" turns a -0 from the multiplication into 0.
  return { forward: -uy * amount + 0, right: ux * amount + 0, run: raw >= STICK_RUN_AT, knobX: ux * reach, knobY: uy * reach };
}
