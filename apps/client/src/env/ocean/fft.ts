// GPU inverse FFT (Stockham/Cooley-Tukey butterflies) in TSL compute.
// Ported from owenyuwono/poseidon (MIT), itself after gasgiant/FFT-Ocean (MIT).
import { Fn, attributeArray, float, instanceIndex, uint, vec2 } from 'three/tsl';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Buf = any;
type Kernel = any;

const cmul = (a: any, b: any) => vec2(a.x.mul(b.x).sub(a.y.mul(b.y)), a.x.mul(b.y).add(a.y.mul(b.x)));

function fillButterfly(array: Float32Array, N: number) {
  const logN = Math.log2(N);
  for (let step = 0; step < logN; step++) {
    const b = N >> (step + 1);
    for (let j = 0; j < N / 2; j++) {
      const i = (2 * b * Math.floor(j / b) + (j % b)) % N;
      const X = Math.floor(j / b) * b;
      const twRe = Math.cos((2 * Math.PI * X) / N);
      const twIm = -Math.sin((2 * Math.PI * X) / N);
      const put = (col: number, re: number, im: number) => {
        const o = (step * N + col) * 4;
        array[o] = re;
        array[o + 1] = im;
        array[o + 2] = i;
        array[o + 3] = i + b;
      };
      put(j, twRe, twIm);
      put(j + N / 2, -twRe, -twIm);
    }
  }
}

export interface FieldKernels {
  h: Kernel[];
  v: Kernel[];
  permute: Kernel;
}

export class FFT {
  readonly N: number;
  readonly logN: number;
  private readonly butterfly: Buf;

  constructor(N: number) {
    this.N = N;
    this.logN = Math.log2(N);
    this.butterfly = attributeArray(this.logN * N, 'vec4');
    fillButterfly(this.butterfly.value.array as Float32Array, N);
    this.butterfly.value.needsUpdate = true;
  }

  /** `pass` counts every step across both directions so the ping-pong parity is
   * continuous and the result always lands back in `field` (2·logN steps). */
  private step(field: Buf, scratch: Buf, s: number, vertical: boolean): Kernel {
    const N = this.N;
    const pass = vertical ? this.logN + s : s;
    const src = pass % 2 === 0 ? field : scratch;
    const dst = pass % 2 === 0 ? scratch : field;
    const bf = this.butterfly;
    return Fn(() => {
      const id = instanceIndex;
      const x = id.mod(uint(N));
      const y = id.div(uint(N));
      const data = bf.element(uint(s * N).add(vertical ? y : x));
      const tw = vec2(data.x, data.y.negate());
      const a = vertical ? src.element(uint(data.z).mul(N).add(x)) : src.element(y.mul(N).add(uint(data.z)));
      const b = vertical ? src.element(uint(data.w).mul(N).add(x)) : src.element(y.mul(N).add(uint(data.w)));
      dst.element(id).assign(a.add(cmul(tw, b)));
    })().compute(N * N);
  }

  private permute(field: Buf): Kernel {
    const N = this.N;
    return Fn(() => {
      const id = instanceIndex;
      const x = id.mod(uint(N));
      const y = id.div(uint(N));
      const sign = float(1).sub(float(x.add(y).mod(uint(2))).mul(2));
      field.element(id).assign(field.element(id).mul(sign));
    })().compute(N * N);
  }

  /** Kernels that inverse-transform `field` in place, using `scratch`. */
  buildField(field: Buf, scratch: Buf): FieldKernels {
    const h: Kernel[] = [];
    const v: Kernel[] = [];
    for (let s = 0; s < this.logN; s++) {
      h.push(this.step(field, scratch, s, false));
      v.push(this.step(field, scratch, s, true));
    }
    return { h, v, permute: this.permute(field) };
  }
}
