// Spectral ocean simulation: cascades, inverse FFT and map assembly with a
// persistent foam accumulator. Structure after owenyuwono/poseidon (MIT).
import { HalfFloatType, LinearFilter, RepeatWrapping, StorageTexture, Vector2, type WebGPURenderer } from 'three/webgpu';
import {
  Fn,
  attributeArray,
  exp,
  float,
  instanceIndex,
  max,
  min,
  mix,
  sqrt,
  texture,
  textureStore,
  uint,
  uniform,
  uvec2,
  vec2,
  vec4,
} from 'three/tsl';
import { mulberry32 } from '@oilrig/shared';
import { FFT } from './fft.ts';
import {
  type SeaParams,
  type SharedSpectrum,
  applySpectrum,
  buildConjugate,
  buildInitialSpectrum,
  buildTimeDependent,
  createSharedSpectrumUniforms,
} from './spectrum.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Buf = any;

function gaussianNoise(N: number, seed = 0x5eed0cea) {
  const rand = mulberry32(seed);
  const data = new Float32Array(N * N * 2);
  for (let i = 0; i < N * N; i++) {
    const u1 = Math.max(rand(), 1e-7);
    const u2 = rand();
    const r = Math.sqrt(-2 * Math.log(u1));
    data[i * 2] = r * Math.cos(2 * Math.PI * u2);
    data[i * 2 + 1] = r * Math.sin(2 * Math.PI * u2);
  }
  return data;
}

function mapTexture(N: number, mips: boolean) {
  const tex = new StorageTexture(N, N);
  tex.type = HalfFloatType;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  if (!mips) {
    tex.generateMipmaps = false;
    tex.minFilter = LinearFilter;
    tex.magFilter = LinearFilter;
  }
  return tex;
}

/**
 * A storage buffer that only the kernels write, created empty on the device.
 *
 * three creates a storage buffer mapped and copies the attribute's array into it. For these
 * buffers that is megabytes of zeros (20 MB at N = 256, 78 MB at 512), and the browser holds on
 * to memory such an upload passes through: with it the renderer process was 27–31 MB larger at
 * 256 and 125 MB at 512, the GPU process 9–11 MB and 64 MB (docs/performance.md). A buffer
 * made here is never mapped, and its array, never read, takes no memory either.
 *
 * This depends on three's internals: `createAttribute` in `WebGPUAttributeUtils` leaves alone
 * a buffer that the backend's data for the attribute already holds, and `createStorageAttribute`
 * in `WebGPUBackend` asks for the usage given here. `OceanSimulation.checkBuffers` reports it
 * if three replaces the buffer with its own; if three stopped looking there at all, nothing
 * would, and `pnpm bench count` is the check (GPU buffers alive on High stay 65.3 MB).
 */
function deviceArray(renderer: WebGPURenderer, made: Array<[attribute: object, buffer: GPUBuffer]>, count: number, type: 'vec2' | 'vec4'): Buf {
  const node: Buf = type === 'vec2' ? attributeArray(count, 'vec2') : attributeArray(count, 'vec4');
  const backend = renderer.backend as any;
  const device: GPUDevice | undefined = backend.device;
  const usage = (globalThis as any).GPUBufferUsage;
  if (!device || !usage) return node;
  const attribute = node.value;
  const buffer = device.createBuffer({
    size: attribute.array.byteLength,
    usage: usage.STORAGE | usage.VERTEX | usage.COPY_SRC | usage.COPY_DST,
  });
  backend.get(attribute).buffer = buffer;
  made.push([attribute, buffer]);
  return node;
}

export interface Cascade {
  lengthScale: number;
  displacement: StorageTexture;
  derivatives: StorageTexture;
}

export const SWELL: SeaParams = {
  windSpeed: 12,
  windDirection: 320,
  fetch: 400_000,
  scale: 0.3,
  spreadBlend: 0.97,
  swell: 0.88,
  peakEnhancement: 4.5,
  shortWavesFade: 2.5,
  tailFalloff: 1.7,
  tailFloor: 0.15,
};

export const LOCAL_DEFAULTS: Omit<SeaParams, 'windSpeed' | 'windDirection'> = {
  fetch: 60_000,
  scale: 0.55,
  spreadBlend: 0.78,
  swell: 0.4,
  peakEnhancement: 3.3,
  shortWavesFade: 0.07,
  tailFalloff: 0.95,
  tailFloor: 0.45,
};

export class OceanSimulation {
  readonly N: number;
  readonly cascades: Cascade[] = [];
  readonly lambda = uniform(1.6);
  private readonly time = uniform(0);
  private readonly dt = uniform(1 / 60);
  private readonly foamDecay = uniform(3.9);
  private readonly drift = uniform(new Vector2());
  private readonly shared: SharedSpectrum;
  /** The initial spectra of every cascade, then their conjugates: run when the wind changes. */
  private readonly spectrumKernels: Buf[] = [];
  /**
   * One frame of the simulation as one compute pass: the spectra at the current time, the
   * inverse FFT and the maps. There are two because the foam history alternates between two
   * textures; the arrays themselves are what three keys the pass by, so they are kept.
   */
  private readonly frameKernels: [Buf[], Buf[]];
  private frame = 0;
  private dirty = true;
  /** The buffers made by `deviceArray`, until `checkBuffers` has seen three use them. */
  private readonly deviceBuffers: Array<[attribute: object, buffer: GPUBuffer]> = [];
  private readonly renderer: WebGPURenderer;
  private local: SeaParams;

  constructor(renderer: WebGPURenderer, N: number, lengthScales: number[]) {
    this.renderer = renderer;
    this.N = N;
    this.shared = createSharedSpectrumUniforms();
    this.local = { ...LOCAL_DEFAULTS, windSpeed: 8, windDirection: 300 };

    const noise = attributeArray(N * N, 'vec2');
    (noise.value.array as Float32Array).set(gaussianNoise(N));
    noise.value.needsUpdate = true;

    // Every cascade's data lies in the same buffers, one N×N layer after another, so each step
    // of a frame is one dispatch over all of them (it was one per cascade and field: 200 a frame).
    const n2 = N * N;
    const total = lengthScales.length * n2;
    const boundary = (i: number) => ((2 * Math.PI) / lengthScales[i]) * 6;
    // The kernels write all of these before anything reads them, so they are made empty.
    const empty = (type: 'vec2' | 'vec4') => deviceArray(renderer, this.deviceBuffers, total, type);
    const h0k = empty('vec2');
    const h0 = empty('vec4');
    const wavesData = empty('vec4');
    // The four complex fields, two to a buffer: DxDz with DyDxz, DyxDyz with DxxDzz.
    const fieldsA = empty('vec4');
    const fieldsB = empty('vec4');
    const conjugates: Buf[] = [];
    const assemble: Array<[Buf, Buf]> = [];

    lengthScales.forEach((L, i) => {
      const offset = i * n2;
      const deltaK = uniform((2 * Math.PI) / L);
      const cutoffLow = uniform(i === 0 ? 1e-4 : boundary(i));
      const cutoffHigh = uniform(i === lengthScales.length - 1 ? 9999 : boundary(i + 1));
      this.spectrumKernels.push(buildInitialSpectrum({ N, offset, noise, h0k, wavesData, shared: this.shared, deltaK, cutoffLow, cutoffHigh }));
      conjugates.push(buildConjugate(N, offset, h0k, h0));
      const c: Cascade = { lengthScale: L, displacement: mapTexture(N, true), derivatives: mapTexture(N, true) };
      this.cascades.push(c);
      assemble.push(this.buildAssemble(c, offset, fieldsA, fieldsB));
    });
    this.spectrumKernels.push(...conjugates);
    const kTime = buildTimeDependent({ count: total, h0, wavesData, a: fieldsA, b: fieldsB, time: this.time });
    const fft = new FFT(N).build(
      [
        [fieldsA, empty('vec4')],
        [fieldsB, empty('vec4')],
      ],
      lengthScales.length,
    );
    this.frameKernels = [
      [kTime, ...fft, ...assemble.map((k) => k[0])],
      [kTime, ...fft, ...assemble.map((k) => k[1])],
    ];
  }

  /** Writes a cascade's displacement, derivative and foam maps from its transformed fields at `offset`. */
  private buildAssemble(c: Cascade, offset: number, fieldsA: Buf, fieldsB: Buf): [Buf, Buf] {
    const N = this.N;
    const { lambda, dt, foamDecay, drift } = this;
    const tauScale = Math.sqrt(c.lengthScale / 144);
    const hist = [mapTexture(N, false), mapTexture(N, false)];
    const build = (r: number, w: number) =>
      Fn(() => {
        const id = instanceIndex;
        const coord = uvec2(id.mod(uint(N)), id.div(uint(N)));
        // The sign the transform leaves in (see FFT.build).
        const sign = float(1).sub(float(coord.x.add(coord.y).mod(uint(2))).mul(2));
        const a: any = fieldsA.element(id.add(uint(offset))).mul(sign).toVar();
        const b: any = fieldsB.element(id.add(uint(offset))).mul(sign).toVar();
        const DxDz = a.xy;
        const DyDxz = a.zw;
        const DyxDyz = b.xy;
        const DxxDzz = b.zw;
        const jxx = float(1).add(lambda.mul(DxxDzz.x));
        const jzz = float(1).add(lambda.mul(DxxDzz.y));
        const jxz = lambda.mul(DyDxz.y);
        const half = jxx.add(jzz).mul(0.5);
        const disc = sqrt(jxx.sub(jzz).mul(jxx.sub(jzz)).add(jxz.mul(jxz).mul(4))).mul(0.5);
        const lMin = half.sub(disc);
        const uv = vec2(float(coord.x), float(coord.y)).add(0.5).div(N).sub(drift.mul(dt).div(c.lengthScale));
        const tx = float(1 / N);
        const tap = (ox: number, oy: number) => texture(hist[r], uv.add(vec2(tx.mul(ox), tx.mul(oy)))).level(float(0)).x;
        const tent = tap(0.5, 0.5).add(tap(-0.5, 0.5)).add(tap(0.5, -0.5)).add(tap(-0.5, -0.5)).mul(0.25);
        const fPrev = mix(tap(0, 0), tent, min(dt.mul(1.32), float(0.3)));
        const tau = max(min(foamDecay.mul(tauScale), dt.mul(1500)), float(1e-3));
        const decayed = fPrev.mul(exp(dt.negate().div(tau)));
        const inj = min(float(1).sub(lMin).mul(1.05), float(8));
        const f: any = max(inj, decayed).toVar();
        textureStore(hist[w], coord, vec4(f, 0, 0, 1)).toWriteOnly();
        textureStore(c.displacement, coord, vec4(DxDz.x.mul(lambda), DyDxz.x, DxDz.y.mul(lambda), float(1).sub(f))).toWriteOnly();
        textureStore(c.derivatives, coord, vec4(DyxDyz.x, DyxDyz.y, DxxDzz.x.mul(lambda), DxxDzz.y.mul(lambda))).toWriteOnly();
      })().compute(N * N);
    return [build(0, 1), build(1, 0)];
  }

  /** Sets the local wind sea. The spectrum is rebuilt lazily when it changes noticeably. */
  setWind(speed: number, directionDeg: number) {
    const dS = Math.abs(speed - this.local.windSpeed);
    let dD = Math.abs(directionDeg - this.local.windDirection) % 360;
    if (dD > 180) dD = 360 - dD;
    if (dS > 0.15 || dD > 1.5) {
      this.local = { ...this.local, windSpeed: speed, windDirection: directionDeg };
      this.dirty = true;
    }
  }

  update(t: number, dt: number) {
    if (this.dirty) {
      this.dirty = false;
      const swellScale = Math.pow(Math.min(Math.max(this.local.windSpeed / 10.5, 0.35), 1.7), 0.7);
      applySpectrum(this.shared, this.local, SWELL, swellScale);
      this.renderer.compute(this.spectrumKernels);
    }
    this.time.value = t;
    this.dt.value = Math.min(Math.max(dt, 0), 0.1);
    const wd = (this.local.windDirection * Math.PI) / 180;
    const v = 0.03 * this.local.windSpeed;
    this.drift.value.set(v * Math.sin(wd), -v * Math.cos(wd));
    this.renderer.compute(this.frameKernels[this.frame & 1]);
    this.frame++;
    if (this.deviceBuffers.length > 0) this.checkBuffers();
  }

  /**
   * After the first frame's kernels have run, the backend should still hold every buffer made by
   * `deviceArray`. If three put its own there instead, ours would be megabytes held for nothing.
   */
  private checkBuffers() {
    const backend = this.renderer.backend as any;
    for (const [attribute, buffer] of this.deviceBuffers) {
      if (backend.get(attribute).buffer === buffer) continue;
      buffer.destroy();
      console.error('OceanSimulation: three did not take a storage buffer made for it (see deviceArray in ocean/simulation.ts).');
    }
    this.deviceBuffers.length = 0;
  }
}
