import type { WebGPURenderer } from 'three/webgpu';

// Dynamic resolution: when frames take longer than a 60 fps budget, render fewer pixels;
// when they have been comfortably on time for a while, try more again. Steps are coarse and
// spaced out, because every change resizes the post-processing targets (a small hitch), and
// a step up that turns out too slow backs off for longer before the next try.

const SLOW_MS = 18.5; // below ~54 fps
const OK_MS = 17.4; // on time at 60 Hz (or better)
const STEP = 0.1;
const MIN_SCALE = 0.5;
/** The first seconds compile shaders and bake light probes: those frames say nothing about resolution. */
const WARM_UP_S = 10;

export class DynamicResolution {
  /** Fraction of the preset's pixel ratio being rendered, 0.5..1. */
  scale = 1;
  enabled: boolean;
  private readonly renderer: WebGPURenderer;
  private readonly basePixelRatio: number;
  private sum = 0;
  private n = 0;
  private onTimeFor = 0;
  private lastChange = 0;
  private retryAfter = 5;
  private raisedAt = -Infinity;

  constructor(renderer: WebGPURenderer, basePixelRatio: number, enabled: boolean) {
    this.renderer = renderer;
    this.basePixelRatio = basePixelRatio;
    this.enabled = enabled;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on && this.scale !== 1) this.apply(1, 0);
  }

  private apply(scale: number, now: number) {
    this.scale = Math.round(scale * 100) / 100;
    this.renderer.setPixelRatio(this.basePixelRatio * this.scale);
    this.lastChange = now;
    this.sum = 0;
    this.n = 0;
    this.onTimeFor = 0;
  }

  /** Call once per frame with the frame's wall time in ms and the time in seconds. */
  update(frameMs: number, now: number) {
    if (!this.enabled || frameMs <= 0 || frameMs > 250 || now < WARM_UP_S) return;
    this.sum += frameMs;
    this.n++;
    // Judge about once a second (sooner than 30 frames when frames are very slow).
    if (now - this.lastChange < 1 || (this.n < 30 && this.sum < 1000)) return;
    const avg = this.sum / this.n;
    this.sum = 0;
    this.n = 0;
    if (avg > SLOW_MS && this.scale > MIN_SCALE) {
      // A step up that made it slow: wait longer before trying that again.
      if (now - this.raisedAt < 4) this.retryAfter = Math.min(60, this.retryAfter * 2);
      // Far over budget: pixels scale with the square of the ratio, so jump most of the way.
      const step = avg > 2 * SLOW_MS ? Math.max(STEP, this.scale - this.scale * Math.sqrt(SLOW_MS / avg)) : STEP;
      this.apply(Math.max(MIN_SCALE, this.scale - step), now);
      return;
    }
    if (avg <= OK_MS) this.onTimeFor += 1;
    else this.onTimeFor = 0;
    if (this.onTimeFor >= this.retryAfter && this.scale < 1) {
      this.raisedAt = now;
      this.apply(Math.min(1, this.scale + STEP), now);
    }
  }
}
