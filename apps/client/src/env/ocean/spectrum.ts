// Initial spectrum h0(k), conjugate packing and time-dependent spectra (Horvath 2015
// JONSWAP + directional spreading, TMA depth correction). Ported from
// owenyuwono/poseidon (MIT), after gasgiant/FFT-Ocean (MIT).
import {
  Fn,
  abs,
  atan,
  cos,
  cosh,
  exp,
  float,
  instanceIndex,
  int,
  length,
  max,
  min,
  mix,
  pow,
  sin,
  sqrt,
  step,
  tanh,
  uint,
  uniform,
  vec2,
  vec4,
} from 'three/tsl';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

export interface SeaParams {
  windSpeed: number;
  /** Direction the wind blows toward, degrees clockwise from north. */
  windDirection: number;
  fetch: number;
  scale: number;
  spreadBlend: number;
  swell: number;
  peakEnhancement: number;
  shortWavesFade: number;
  tailFalloff: number;
  tailFloor: number;
}

function frequency(k: N, g: N, depth: N) {
  return sqrt(g.mul(k).mul(tanh(min(k.mul(depth), float(20)))));
}

function frequencyDerivative(k: N, g: N, depth: N) {
  const th = tanh(min(k.mul(depth), float(20)));
  const ch = cosh(min(k.mul(depth), float(20)));
  const f = frequency(k, g, depth);
  return g.mul(depth.mul(k).div(ch).div(ch).add(th)).div(f).div(2);
}

function normalisationFactor(s: N) {
  const s2 = s.mul(s);
  const s3 = s2.mul(s);
  const s4 = s3.mul(s);
  const a = s4.mul(-0.000564).add(s3.mul(0.00776)).add(s2.mul(-0.044)).add(s.mul(0.192)).add(0.163);
  const b = s4.mul(-4.8e-8).add(s3.mul(1.07e-5)).add(s2.mul(-9.53e-4)).add(s.mul(5.9e-2)).add(3.93e-1);
  return mix(a, b, step(float(5), s));
}

const cosine2s = (theta: N, s: N) => normalisationFactor(s).mul(pow(abs(cos(theta.mul(0.5))), s.mul(2)));

function spreadPower(omega: N, peakOmega: N) {
  const r = omega.div(peakOmega);
  const hi = pow(abs(r), float(-2.5)).mul(9.77);
  const lo = pow(abs(r), float(5)).mul(6.97);
  return mix(lo, hi, step(peakOmega, omega));
}

function swellConcentration(omega: N, p: Set) {
  const r = omega.div(p.peakOmega);
  return tanh(min(r, float(20))).mul(min(float(1).div(max(r, float(1e-3))), float(1)));
}

function directionSpectrum(theta: N, omega: N, p: Set) {
  const s = spreadPower(omega, p.peakOmega).add(swellConcentration(omega, p).mul(16).mul(p.swell).mul(p.swell));
  const base = cos(theta).mul(cos(theta)).mul(2.0 / Math.PI);
  return mix(base, cosine2s(theta.sub(p.angle), s), p.spreadBlend);
}

function tmaCorrection(omega: N, g: N, depth: N) {
  const omegaH = omega.mul(sqrt(depth.div(g)));
  const c1 = omegaH.mul(omegaH).mul(0.5);
  const tw = float(2).sub(omegaH);
  const c2 = float(1).sub(tw.mul(tw).mul(0.5));
  return mix(c1, mix(c2, float(1), step(float(2), omegaH)), step(float(1), omegaH));
}

const tailRolloff = (omega: N, p: Set) => pow(max(min(p.peakOmega.div(omega), float(1)), p.tailFloor), p.tailFalloff);

function jonswap(omega: N, g: N, depth: N, p: Set) {
  const sigma = mix(float(0.07), float(0.09), step(p.peakOmega, omega));
  const dw = omega.sub(p.peakOmega);
  const r = exp(dw.mul(dw).mul(-1).div(sigma.mul(sigma).mul(p.peakOmega).mul(p.peakOmega).mul(2)));
  const oo = float(1).div(omega);
  const oo2 = oo.mul(oo);
  const oo5 = oo2.mul(oo2).mul(oo);
  const po = p.peakOmega.div(omega);
  const po2 = po.mul(po);
  const po4 = po2.mul(po2);
  return p.scale
    .mul(tmaCorrection(omega, g, depth))
    .mul(p.alpha)
    .mul(g)
    .mul(g)
    .mul(oo5)
    .mul(exp(po4.mul(-1.25)))
    .mul(pow(p.gamma, r))
    .mul(tailRolloff(omega, p));
}

const shortWavesFade = (kLen: N, p: Set) => exp(p.shortWavesFade.mul(p.shortWavesFade).mul(kLen).mul(kLen).mul(-1));

const cmul = (a: N, b: N) => vec2(a.x.mul(b.x).sub(a.y.mul(b.y)), a.x.mul(b.y).add(a.y.mul(b.x)));

// Wavenumber-weighted choppiness and downwind crest lean (see poseidon/spectrum.js).
export const chop = {
  falloff: uniform(0.28),
  floor: uniform(0.2),
  lean: uniform(0.55),
  windX: uniform(Math.SQRT1_2),
  windZ: uniform(Math.SQRT1_2),
};

function choppiness(kLen: N) {
  const r = kLen.div(chop.falloff);
  const r2 = r.mul(r);
  return chop.floor.add(float(1).sub(chop.floor).div(r2.mul(r2).add(1)));
}

const leanWeight = (k: N, c: N) => k.x.mul(chop.windX).add(k.y.mul(chop.windZ)).mul(chop.lean).mul(c);

function uniformSet() {
  return {
    scale: uniform(0),
    angle: uniform(0),
    spreadBlend: uniform(0),
    swell: uniform(0),
    alpha: uniform(0),
    peakOmega: uniform(1),
    gamma: uniform(1),
    shortWavesFade: uniform(0),
    tailFalloff: uniform(0),
    tailFloor: uniform(1),
  };
}
type Set = ReturnType<typeof uniformSet>;

export function createSharedSpectrumUniforms() {
  return { g: uniform(9.81), depth: uniform(500), local: uniformSet(), swell: uniformSet() };
}
export type SharedSpectrum = ReturnType<typeof createSharedSpectrumUniforms>;

/** World convention: our +x east, -z north. Spectrum angle is atan2(kz, kx). */
export function windAngle(directionDeg: number) {
  const d = (directionDeg * Math.PI) / 180;
  return Math.atan2(-Math.cos(d), Math.sin(d));
}

function fillSet(u: Set, d: SeaParams, g: number, scaleMul = 1) {
  const ws = Math.max(d.windSpeed, 1.5);
  u.scale.value = d.scale * scaleMul;
  u.angle.value = windAngle(d.windDirection);
  u.spreadBlend.value = d.spreadBlend;
  u.swell.value = Math.min(Math.max(d.swell, 0.01), 1);
  u.alpha.value = 0.076 * Math.pow((g * d.fetch) / (ws * ws), -0.22);
  u.peakOmega.value = 22 * Math.pow((ws * d.fetch) / (g * g), -0.33);
  u.gamma.value = d.peakEnhancement;
  u.shortWavesFade.value = d.shortWavesFade;
  u.tailFalloff.value = d.tailFalloff;
  u.tailFloor.value = d.tailFloor;
}

export function applySpectrum(u: SharedSpectrum, local: SeaParams, swell: SeaParams, swellScale: number) {
  const a = windAngle(local.windDirection);
  chop.windX.value = Math.cos(a);
  chop.windZ.value = Math.sin(a);
  fillSet(u.local, local, u.g.value);
  fillSet(u.swell, swell, u.g.value, swellScale);
}

export function buildInitialSpectrum(o: {
  N: number;
  noise: N;
  h0k: N;
  wavesData: N;
  shared: SharedSpectrum;
  deltaK: N;
  cutoffLow: N;
  cutoffHigh: N;
}) {
  const { N, noise, h0k, wavesData, shared, deltaK, cutoffLow, cutoffHigh } = o;
  return Fn(() => {
    const id = instanceIndex;
    const x = id.mod(uint(N));
    const y = id.div(uint(N));
    const k = vec2(float(int(x).sub(N / 2)), float(int(y).sub(N / 2))).mul(deltaK);
    const kLen = length(k);
    const kSafe = max(kLen, cutoffLow);
    const angle = atan(k.y, k.x.add(1e-9));
    const omega = frequency(kSafe, shared.g, shared.depth);
    const dOmega = frequencyDerivative(kSafe, shared.g, shared.depth);
    const spectrum = jonswap(omega, shared.g, shared.depth, shared.local)
      .mul(directionSpectrum(angle, omega, shared.local))
      .mul(shortWavesFade(kSafe, shared.local))
      .add(
        jonswap(omega, shared.g, shared.depth, shared.swell)
          .mul(directionSpectrum(angle, omega, shared.swell))
          .mul(shortWavesFade(kSafe, shared.swell)),
      );
    const inBand = step(cutoffLow, kLen).mul(step(kLen, cutoffHigh));
    const amplitude = sqrt(spectrum.mul(2).mul(abs(dOmega)).div(kSafe).mul(deltaK).mul(deltaK));
    h0k.element(id).assign(noise.element(id).mul(amplitude).mul(inBand));
    wavesData.element(id).assign(vec4(k.x, float(1).div(kSafe), k.y, omega));
  })().compute(N * N);
}

export function buildConjugate(N: number, h0k: N, h0: N) {
  return Fn(() => {
    const id = instanceIndex;
    const x = id.mod(uint(N));
    const y = id.div(uint(N));
    const xm = uint(N).sub(x).mod(uint(N));
    const ym = uint(N).sub(y).mod(uint(N));
    const a = h0k.element(id);
    const b = h0k.element(ym.mul(uint(N)).add(xm));
    h0.element(id).assign(vec4(a.x, a.y, b.x, b.y.negate()));
  })().compute(N * N);
}

export function buildTimeDependent(o: { N: number; h0: N; wavesData: N; DxDz: N; DyDxz: N; DyxDyz: N; DxxDzz: N; time: N }) {
  const { N, h0, wavesData, DxDz, DyDxz, DyxDyz, DxxDzz, time } = o;
  return Fn(() => {
    const id = instanceIndex;
    const wave = wavesData.element(id);
    const phase = wave.w.mul(time);
    const ex = vec2(cos(phase), sin(phase));
    const h0v = h0.element(id);
    const h = cmul(h0v.xy, ex).add(cmul(h0v.zw, vec2(ex.x, ex.y.negate())));
    const ih = vec2(h.y.negate(), h.x);
    const kInv = wave.y;
    const kHat = vec2(wave.x, wave.z).mul(kInv);
    const c = choppiness(float(1).div(kInv)).toVar();
    const lean = leanWeight(kHat, c).toVar();
    const hc = cmul(h, vec2(lean, c)).toVar();
    const ihc = vec2(hc.y.negate(), hc.x).toVar();
    const dispX = hc.mul(wave.x).mul(kInv);
    const dispY = h;
    const dispZ = hc.mul(wave.z).mul(kInv);
    const dispXdx = ihc.mul(wave.x).mul(wave.x).mul(kInv);
    const dispYdx = ih.mul(wave.x);
    const dispZdx = ihc.mul(wave.x).mul(wave.z).mul(kInv);
    const dispYdz = ih.mul(wave.z);
    const dispZdz = ihc.mul(wave.z).mul(wave.z).mul(kInv);
    DxDz.element(id).assign(vec2(dispX.x.sub(dispZ.y), dispX.y.add(dispZ.x)));
    DyDxz.element(id).assign(vec2(dispY.x.sub(dispZdx.y), dispY.y.add(dispZdx.x)));
    DyxDyz.element(id).assign(vec2(dispYdx.x.sub(dispYdz.y), dispYdx.y.add(dispYdz.x)));
    DxxDzz.element(id).assign(vec2(dispXdx.x.sub(dispZdz.y), dispXdx.y.add(dispZdz.x)));
  })().compute(N * N);
}
