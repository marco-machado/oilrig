import { ReadbackBuffer, type WebGPURenderer } from 'three/webgpu';
import { Fn, float, instanceIndex, instancedArray, texture, vec2, vec4 } from 'three/tsl';
import type { Cascade } from './simulation.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Reads the ocean surface height back from the GPU at a few points, so floating things
// ride the same waves that are drawn. The FFT displacement is horizontal as well as
// vertical (choppy waves), so the sample position is found by fixed-point iteration:
// the surface point that ends up above P started at P - D(start).

export class WaveSampler {
  readonly count: number;
  /** Latest heights (m) and horizontal displacement at each point: [h, dx, dz] per point. */
  readonly result: Float32Array;
  /** Frames since the result was refreshed (it lags the GPU by a frame or two). */
  age = Infinity;
  readbacks = 0;
  private readonly input: any;
  private readonly output: any;
  private readonly kernel: any;
  private readonly renderer: WebGPURenderer;
  /** The GPU buffer the heights are copied to and mapped from, reused by every readback. */
  private readonly readback: ReadbackBuffer;
  private pending = false;

  constructor(renderer: WebGPURenderer, cascades: Cascade[], count: number) {
    this.renderer = renderer;
    this.count = count;
    this.result = new Float32Array(count * 3);
    this.readback = new ReadbackBuffer(count * 16);
    this.input = instancedArray(count, 'vec4');
    this.output = instancedArray(count, 'vec4');
    const input = this.input;
    const output = this.output;
    const sample = (xz: any) => {
      let d: any = vec4(0);
      for (const c of cascades) d = d.add(texture(c.displacement, xz.div(c.lengthScale)).level(float(0)));
      return d;
    };
    this.kernel = Fn(() => {
      const p = input.element(instanceIndex).xy;
      const x = vec2(p).toVar();
      for (let i = 0; i < 4; i++) x.assign(p.sub(sample(x).xz));
      const d = sample(x);
      output.element(instanceIndex).assign(vec4(d.y, d.x, d.z, 1));
    })().compute(count);
  }

  /** Sets the world XZ of sample point `i`. */
  setPoint(i: number, x: number, z: number) {
    const arr = this.input.value.array as Float32Array;
    if (arr[i * 4] === x && arr[i * 4 + 1] === z) return;
    arr[i * 4] = x;
    arr[i * 4 + 1] = z;
    this.input.value.needsUpdate = true;
  }

  /** Dispatches the sampling pass and starts a readback if none is in flight. */
  update() {
    this.age += 1;
    if (this.pending) return;
    this.pending = true;
    this.renderer.compute(this.kernel);
    this.renderer
      .getArrayBufferAsync(this.output.value, this.readback)
      .then(() => {
        try {
          const f = new Float32Array(this.readback.buffer!);
          for (let i = 0; i < this.count; i++) {
            this.result[i * 3] = f[i * 4];
            this.result[i * 3 + 1] = f[i * 4 + 1];
            this.result[i * 3 + 2] = f[i * 4 + 2];
          }
        } finally {
          // Unmaps it: the next readback copies into the same GPU buffer.
          this.readback.release();
        }
        this.age = 0;
        this.readbacks += 1;
      })
      .catch((e) => {
        console.warn('wave readback failed', e);
        // Whatever state it was left in: the next readback must be able to use the buffer.
        this.readback.release();
      })
      .finally(() => {
        this.pending = false;
      });
  }
}
