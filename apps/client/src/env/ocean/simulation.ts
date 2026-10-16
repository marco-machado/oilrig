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
import { mulberry32 } from '@ocean-home/shared';
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

const FIELDS = ['DxDz', 'DyDxz', 'DyxDyz', 'DxxDzz'] as const;

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

export interface Cascade {
  lengthScale: number;
  displacement: StorageTexture;
  derivatives: StorageTexture;
}

interface CascadeInternal extends Cascade {
  kInitial: Buf;
  kConjugate: Buf;
  kTime: Buf;
  fields: Record<(typeof FIELDS)[number], Buf>;
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
  readonly cascades: Cascade[];
  readonly lambda = uniform(1.6);
  private readonly internal: CascadeInternal[] = [];
  private readonly time = uniform(0);
  private readonly dt = uniform(1 / 60);
  private readonly foamDecay = uniform(3.9);
  private readonly drift = uniform(new Vector2());
  private readonly shared: SharedSpectrum;
  private readonly timeGroup: Buf[];
  private readonly stepGroups: Buf[][] = [];
  private readonly assembleGroups: Buf[][] = [[], []];
  private frame = 0;
  private dirty = true;
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

    const n2 = N * N;
    const boundary = (i: number) => ((2 * Math.PI) / lengthScales[i]) * 6;
    const fft = new FFT(N);
    const ffts: ReturnType<FFT['buildField']>[] = [];

    lengthScales.forEach((L, i) => {
      const h0k = attributeArray(n2, 'vec2');
      const h0 = attributeArray(n2, 'vec4');
      const wavesData = attributeArray(n2, 'vec4');
      const fields = Object.fromEntries(FIELDS.map((f) => [f, attributeArray(n2, 'vec2')])) as CascadeInternal['fields'];
      const deltaK = uniform((2 * Math.PI) / L);
      const cutoffLow = uniform(i === 0 ? 1e-4 : boundary(i));
      const cutoffHigh = uniform(i === lengthScales.length - 1 ? 9999 : boundary(i + 1));
      const kInitial = buildInitialSpectrum({ N, noise, h0k, wavesData, shared: this.shared, deltaK, cutoffLow, cutoffHigh });
      const kConjugate = buildConjugate(N, h0k, h0);
      const kTime = buildTimeDependent({ N, h0, wavesData, ...fields, time: this.time });
      for (const f of FIELDS) ffts.push(fft.buildField(fields[f], attributeArray(n2, 'vec2')));
      const displacement = mapTexture(N, true);
      const derivatives = mapTexture(N, true);
      const c: CascadeInternal = { lengthScale: L, displacement, derivatives, kInitial, kConjugate, kTime, fields };
      this.internal.push(c);
      const asm = this.buildAssemble(c);
      this.assembleGroups[0].push(asm[0]);
      this.assembleGroups[1].push(asm[1]);
    });
    this.cascades = this.internal;
    this.timeGroup = this.internal.map((c) => c.kTime);
    for (let s = 0; s < fft.logN; s++) this.stepGroups.push(ffts.map((f) => f.h[s]));
    for (let s = 0; s < fft.logN; s++) this.stepGroups.push(ffts.map((f) => f.v[s]));
    this.stepGroups.push(ffts.map((f) => f.permute));
  }

  private buildAssemble(c: CascadeInternal): [Buf, Buf] {
    const N = this.N;
    const { lambda, dt, foamDecay, drift } = this;
    const tauScale = Math.sqrt(c.lengthScale / 144);
    const hist = [mapTexture(N, false), mapTexture(N, false)];
    const build = (r: number, w: number) =>
      Fn(() => {
        const id = instanceIndex;
        const coord = uvec2(id.mod(uint(N)), id.div(uint(N)));
        const DxDz = c.fields.DxDz.element(id);
        const DyDxz = c.fields.DyDxz.element(id);
        const DyxDyz = c.fields.DyxDyz.element(id);
        const DxxDzz = c.fields.DxxDzz.element(id);
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
      for (const c of this.internal) {
        this.renderer.compute(c.kInitial);
        this.renderer.compute(c.kConjugate);
      }
    }
    this.time.value = t;
    this.dt.value = Math.min(Math.max(dt, 0), 0.1);
    const wd = (this.local.windDirection * Math.PI) / 180;
    const v = 0.03 * this.local.windSpeed;
    this.drift.value.set(v * Math.sin(wd), -v * Math.cos(wd));
    this.renderer.compute(this.timeGroup);
    for (const g of this.stepGroups) this.renderer.compute(g);
    this.renderer.compute(this.assembleGroups[this.frame & 1]);
    this.frame++;
  }
}
