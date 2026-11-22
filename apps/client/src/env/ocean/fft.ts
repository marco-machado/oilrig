// GPU inverse FFT (Stockham/Cooley-Tukey butterflies) in TSL compute.
// Ported from owenyuwono/poseidon (MIT), itself after gasgiant/FFT-Ocean (MIT).
import { Fn, attributeArray, instanceIndex, uint, vec2, vec4 } from 'three/tsl';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Buf = any;
type Kernel = any;

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

/** A buffer of vec4, two complex numbers per element, and the scratch buffer it is transformed through. */
export type FieldPair = [field: Buf, scratch: Buf];

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

  /**
   * One butterfly pass over every N×N layer of every pair at once. `pass` counts the steps of
   * both directions, so the ping-pong parity is continuous and the result lands back in the
   * fields after 2·logN steps.
   */
  private step(pairs: FieldPair[], layers: number, s: number, vertical: boolean): Kernel {
    const N = this.N;
    const n2 = N * N;
    const pass = vertical ? this.logN + s : s;
    const bf = this.butterfly;
    return Fn(() => {
      const id = instanceIndex;
      const local = id.mod(uint(n2));
      const layer = id.sub(local);
      const x = local.mod(uint(N));
      const y = local.div(uint(N));
      const data = bf.element(uint(s * N).add(vertical ? y : x));
      const tw: any = vec2(data.x, data.y.negate()).toVar();
      const at = (i: any) => (vertical ? layer.add(uint(i).mul(N)).add(x) : layer.add(y.mul(N)).add(uint(i)));
      const ia = at(data.z).toVar();
      const ib = at(data.w).toVar();
      for (const [field, scratch] of pairs) {
        const src = pass % 2 === 0 ? field : scratch;
        const dst = pass % 2 === 0 ? scratch : field;
        const a = src.element(ia);
        const b: any = src.element(ib).toVar();
        // a + tw·b for both complex numbers of the element.
        const twb = vec4(tw.x.mul(b.x).sub(tw.y.mul(b.y)), tw.x.mul(b.y).add(tw.y.mul(b.x)), tw.x.mul(b.z).sub(tw.y.mul(b.w)), tw.x.mul(b.w).add(tw.y.mul(b.z)));
        dst.element(id).assign(a.add(twb));
      }
    })().compute(layers * n2);
  }

  /**
   * Kernels that inverse-transform, in place and in this order, the `layers` N×N fields stored
   * one after another in each pair. The result still carries the sign (-1)^(x+y) of the
   * centred spectrum: whoever reads it multiplies by `1 - 2·((x + y) mod 2)`.
   */
  build(pairs: FieldPair[], layers: number): Kernel[] {
    const kernels: Kernel[] = [];
    for (let s = 0; s < this.logN; s++) kernels.push(this.step(pairs, layers, s, false));
    for (let s = 0; s < this.logN; s++) kernels.push(this.step(pairs, layers, s, true));
    return kernels;
  }
}
