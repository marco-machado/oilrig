import type { Vec3 } from '../layout/types.ts';

export interface PoseSample {
  /** Server timestamp, ms. */
  t: number;
  p: Vec3;
  yaw: number;
  pitch: number;
  speed: number;
}

const MAX_SAMPLES = 32;
const MAX_EXTRAPOLATE_MS = 150;

function lerpAngle(a: number, b: number, u: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * u;
}

/**
 * Buffers timestamped poses of a remote player and reconstructs a smooth pose at a
 * render time that trails the newest data. Late (out-of-order) samples are slotted
 * into place, and samples older than what has already been shown are dropped so the
 * rendered motion never jumps backwards in time.
 */
export class InterpolationBuffer {
  private readonly samples: PoseSample[] = [];
  private lastRenderT = -Infinity;

  push(s: PoseSample) {
    if (s.t <= this.lastRenderT) return;
    let i = this.samples.length;
    while (i > 0 && this.samples[i - 1].t > s.t) i--;
    if (i > 0 && this.samples[i - 1].t === s.t) return;
    this.samples.splice(i, 0, s);
    if (this.samples.length > MAX_SAMPLES) this.samples.splice(0, this.samples.length - MAX_SAMPLES);
  }

  get size() {
    return this.samples.length;
  }

  sample(renderT: number): PoseSample | null {
    const s = this.samples;
    if (s.length === 0) return null;
    this.lastRenderT = Math.max(this.lastRenderT, renderT);
    // Drop samples we no longer need (keep one before renderT).
    while (s.length > 2 && s[1].t <= renderT) s.shift();
    if (s.length === 1 || renderT <= s[0].t) return { ...s[0], t: renderT };
    const a = s[0];
    const b = s[1];
    if (renderT <= b.t) {
      const u = (renderT - a.t) / (b.t - a.t);
      return {
        t: renderT,
        p: [a.p[0] + (b.p[0] - a.p[0]) * u, a.p[1] + (b.p[1] - a.p[1]) * u, a.p[2] + (b.p[2] - a.p[2]) * u],
        yaw: lerpAngle(a.yaw, b.yaw, u),
        pitch: a.pitch + (b.pitch - a.pitch) * u,
        speed: a.speed + (b.speed - a.speed) * u,
      };
    }
    // Past the newest sample: extrapolate briefly along the last segment, then hold.
    const dt = Math.min(renderT - b.t, MAX_EXTRAPOLATE_MS);
    const span = b.t - a.t;
    const k = span > 0 ? dt / span : 0;
    return {
      t: renderT,
      p: [b.p[0] + (b.p[0] - a.p[0]) * k, b.p[1] + (b.p[1] - a.p[1]) * k, b.p[2] + (b.p[2] - a.p[2]) * k],
      yaw: b.yaw,
      pitch: b.pitch,
      speed: b.speed,
    };
  }
}
