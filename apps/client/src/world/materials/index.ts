import {
  Color,
  DoubleSide,
  type Material,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
} from 'three/webgpu';
import {
  abs,
  attribute,
  bumpMap,
  cameraPosition,
  color,
  float,
  floor,
  fract,
  fwidth,
  hash,
  length,
  max,
  min,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  mx_worley_noise_float,
  normalWorld,
  normalize,
  positionWorld,
  pow,
  saturate,
  select,
  smoothstep,
  step,
  vec2,
  vec3,
} from 'three/tsl';
import type { MaterialId } from '@ocean-home/shared';
import { DIMS } from '@ocean-home/shared';
import { U } from '../../state.ts';

// TSL graph builders: node types are kept loose on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;

const n01 = (n: Node) => n.mul(0.5).add(0.5);

/** Surface wetness for exposed surfaces (more on upward faces, none below the waterline). */
function wetMask() {
  const up = saturate(normalWorld.y);
  return U.wetness.mul(up.mul(0.6).add(0.4)).mul(step(0.3, positionWorld.y));
}

function paintedSteel(base: number, rustiness: number) {
  const m = new MeshStandardNodeMaterial();
  const p = positionWorld;
  const grime: Node = n01(mx_fractal_noise_float(p.mul(0.35), 4, 2, 0.5)).toVar();
  const fine: Node = n01(mx_noise_float(p.mul(9))).toVar();
  const streak = n01(mx_fractal_noise_float(p.mul(vec3(4, 0.08, 4)), 3, 2, 0.5));
  const rustSpot = smoothstep(0.66, 0.84, n01(mx_fractal_noise_float(p.mul(1.7).add(13.1), 4, 2, 0.55)));
  const streakMask = smoothstep(0.58, 0.86, streak);
  const splash = smoothstep(7, 2, p.y).mul(smoothstep(-3.5, -0.5, p.y));
  const submerged = smoothstep(-0.3, -2.5, p.y);
  const rustCol = mix(color(0x4a1f0c), color(0x9a4e1e), fine);
  const growthCol = mix(color(0x1c2615), color(0x46502f), grime);
  const paint = color(base).mul(grime.mul(0.22).add(0.84));
  const rustAmt = saturate(
    max(
      rustSpot.mul(0.8 * rustiness),
      max(streakMask.mul(0.45 * rustiness), splash.mul(smoothstep(0.25, 0.65, grime.add(fine.mul(0.4)))).mul(0.9)),
    ),
  ).toVar();
  const up = saturate(normalWorld.y);
  const salt = up.mul(smoothstep(0.72, 0.95, fine)).mul(0.22);
  const c = mix(mix(mix(paint, rustCol, rustAmt), growthCol, submerged.mul(0.88)), color(0xd8d3c2), salt);
  const wet = wetMask();
  m.colorNode = c.mul(float(1).sub(wet.mul(0.3)));
  m.roughnessNode = mix(grime.mul(0.2).add(0.36), float(0.86), rustAmt).mul(float(1).sub(wet.mul(0.55)));
  m.metalnessNode = float(0);
  return m;
}

function bareSteel(base: number, metal = 0.55) {
  const m = new MeshStandardNodeMaterial();
  const p = positionWorld;
  const grime: Node = n01(mx_fractal_noise_float(p.mul(0.8), 3, 2, 0.5));
  const wet = wetMask();
  m.colorNode = color(base).mul(grime.mul(0.3).add(0.75)).mul(float(1).sub(wet.mul(0.25)));
  m.roughnessNode = grime.mul(0.25).add(0.35).mul(float(1).sub(wet.mul(0.5)));
  m.metalnessNode = float(metal);
  return m;
}

/**
 * Bar grating with see-through gaps. Coverage accounts for the bar depth, so it reads
 * open when looking down and nearly solid at grazing angles, the way real grating does.
 */
function grating(opts: { base: number; period: [number, number]; half: [number, number]; depth: [number, number]; metal: number }) {
  const m = new MeshStandardNodeMaterial();
  m.alphaHash = true;
  m.side = DoubleSide;
  const p = positionWorld;
  const V = normalize(cameraPosition.sub(p));
  const vy = max(abs(V.y), 0.05);
  const s = p.xz;
  const [pa, pb] = opts.period;
  const coverage = (coord: Node, period: number, half: number, depth: number, vh: Node) => {
    const d = abs(fract(coord.div(period)).sub(0.5)).mul(period);
    const w = min(float(half).add(vh.mul(depth * 0.5).div(vy)), float(period * 0.5));
    const aa = fwidth(coord).mul(0.75).max(1e-5);
    const sharp = float(1).sub(smoothstep(w.sub(aa), w.add(aa), d));
    // When the pattern is sub-pixel, fall back to its analytic coverage.
    const blur = saturate(aa.mul(4 / period));
    return mix(sharp, w.mul(2 / period), blur);
  };
  const cA = coverage(s.y, pa, opts.half[0], opts.depth[0], abs(V.z));
  const cB = coverage(s.x, pb, opts.half[1], opts.depth[1], abs(V.x));
  const cov = float(1).sub(float(1).sub(cA).mul(float(1).sub(cB)));
  const horizontal = abs(normalWorld.y).greaterThan(0.5);
  m.opacityNode = select(horizontal, cov, float(1));
  // Bar tops catch the light; between them you look into the dark depth of the grating.
  const zero = float(0);
  const tops = float(1).sub(float(1).sub(coverage(s.y, pa, opts.half[0], 0, zero)).mul(float(1).sub(coverage(s.x, pb, opts.half[1], 0, zero))));
  // At grazing angles the bar sides fill the view, so the darkening fades out.
  const grazing = float(1).sub(vy).pow(2);
  const shade = select(horizontal, mix(mix(float(0.32), float(1), tops), float(0.9), grazing), float(1));
  const grime: Node = n01(mx_fractal_noise_float(p.mul(0.5), 3, 2, 0.5));
  const wet = wetMask();
  m.colorNode = color(opts.base).mul(grime.mul(0.35).add(0.7)).mul(shade).mul(float(1).sub(wet.mul(0.25)));
  m.roughnessNode = grime.mul(0.2).add(0.45).mul(float(1).sub(wet.mul(0.5)));
  m.metalnessNode = float(opts.metal);
  return m;
}

function teak() {
  const m = new MeshStandardNodeMaterial();
  const p = positionWorld;
  const W = 0.14;
  const L = 2.4;
  const across = p.z;
  const along = p.x;
  const row = floor(across.div(W));
  const off = hash(row.add(10000)).mul(L);
  const seg = floor(along.add(off).div(L));
  const plank = hash(row.mul(31).add(seg.mul(7)).add(50000)).toVar();
  const v = fract(across.div(W)).mul(W);
  const seamD = min(v, float(W).sub(v));
  const u = fract(along.add(off).div(L)).mul(L);
  const endD = min(u, float(L).sub(u));
  const aa = fwidth(across).max(1e-5);
  const seam = float(1).sub(smoothstep(float(0.004).sub(aa), float(0.004).add(aa), seamD));
  const endSeam = float(1).sub(smoothstep(float(0.0025).sub(aa), float(0.0025).add(aa), endD));
  const caulk = max(seam, endSeam).mul(step(0.5, abs(normalWorld.y))).toVar();
  const grain = n01(mx_fractal_noise_float(vec3(along.mul(0.7), across.mul(26), plank.mul(40)), 3, 2.2, 0.5)).toVar();
  const wood = mix(color(0x6e4224), color(0x9a6438), plank).mul(grain.mul(0.35).add(0.8));
  const weathered = mix(wood, color(0x8f8476), n01(mx_noise_float(p.mul(0.25))).mul(0.25));
  const wet = wetMask();
  m.colorNode = mix(weathered, color(0x0c0c0c), caulk).mul(float(1).sub(wet.mul(0.4)));
  m.roughnessNode = mix(grain.mul(0.15).add(0.55), float(0.45), caulk).mul(float(1).sub(wet.mul(0.6)));
  m.metalnessNode = float(0);
  m.normalNode = bumpMap(float(1).sub(caulk.mul(0.6)).add(grain.mul(0.08)), float(0.25));
  return m;
}

function concrete() {
  const m = new MeshStandardNodeMaterial();
  const p = positionWorld;
  const mottle = n01(mx_fractal_noise_float(p.mul(0.6), 4, 2, 0.55));
  const speck = smoothstep(0.08, 0.0, mx_worley_noise_float(p.mul(38)));
  m.colorNode = mix(color(0x9e9a93), color(0xbdb8b0), mottle).mul(float(1).sub(speck.mul(0.18)));
  m.roughnessNode = mottle.mul(0.14).add(0.18);
  m.metalnessNode = float(0);
  return m;
}

function plaster() {
  const m = new MeshStandardNodeMaterial();
  const n = n01(mx_noise_float(positionWorld.mul(3)));
  m.colorNode = color(0xeeebe4).mul(n.mul(0.05).add(0.96));
  m.roughnessNode = float(0.92);
  m.metalnessNode = float(0);
  return m;
}

function glass(frosted: boolean) {
  const m = new MeshPhysicalNodeMaterial({
    color: new Color(frosted ? 0xf4f6f6 : 0xf6fbf9),
    metalness: 0,
    roughness: frosted ? 0.5 : 0.02,
    transmission: 1,
    thickness: 0.02,
    ior: 1.52,
  });
  return m;
}

function helideck() {
  const m = new MeshStandardNodeMaterial();
  const p = positionWorld;
  const H = DIMS.HELIPAD;
  const cx = (H.x0 + H.x1) / 2;
  const cz = (H.z0 + H.z1) / 2;
  const q = vec2(p.x.sub(cx), p.z.sub(cz)).toVar();
  const half = (H.x1 - H.x0) / 2;
  const aa = fwidth(p.x).max(1e-4).mul(1.5);
  const inside = (d: Node) => smoothstep(aa, aa.negate(), d); // 1 where d < 0
  // perimeter line
  const dEdge = min(float(half).sub(abs(q.x)), float(half).sub(abs(q.y)));
  const perimeter = inside(abs(dEdge.sub(0.35)).sub(0.15));
  // TD/PM circle
  const r = length(q);
  const ring = inside(abs(r.sub(3.6)).sub(0.5));
  // "H", readable from the bridge (west)
  const bar = (a: Node, b: Node, ha: number, hb: number) => inside(max(abs(a).sub(ha), abs(b).sub(hb)));
  const hMark = max(max(bar(q.x, q.y.sub(1.4), 2.0, 0.35), bar(q.x, q.y.add(1.4), 2.0, 0.35)), bar(q.x, q.y, 0.35, 1.4));
  const wear = smoothstep(0.25, 0.75, n01(mx_fractal_noise_float(p.mul(1.3), 3, 2, 0.5)));
  const grooves = smoothstep(0.02, 0.0, abs(fract(p.z.div(0.3)).sub(0.5)).mul(0.3).sub(0.135)).mul(step(0.5, normalWorld.y));
  const base = color(0x37413e).mul(n01(mx_noise_float(p.mul(2.5))).mul(0.15).add(0.9)).mul(float(1).sub(grooves.mul(0.35)));
  const white = color(0xe9e7df);
  const yellow = color(0xe7b10e);
  const mark = (c: Node, mask: Node) => (prev: Node) => mix(prev, c.mul(wear.mul(0.15).add(0.85)), mask.mul(0.95));
  const top = step(0.5, normalWorld.y);
  const painted = mark(white, hMark.mul(top))(mark(yellow, ring.mul(top))(mark(white, perimeter.mul(top))(base)));
  const wet = wetMask();
  m.colorNode = painted.mul(float(1).sub(wet.mul(0.3)));
  m.roughnessNode = float(0.72).sub(max(ring, max(perimeter, hMark)).mul(0.12)).mul(float(1).sub(wet.mul(0.55)));
  m.metalnessNode = float(0.1);
  return m;
}

function poolTile() {
  const m = new MeshStandardNodeMaterial();
  const p = positionWorld;
  const tile = 0.05;
  const uvw = vec3(p.x, p.y, p.z).div(tile);
  const cell = floor(uvw);
  const h = hash(cell.x.add(cell.y.mul(57)).add(cell.z.mul(113)).add(100000));
  const f = fract(uvw);
  const n = abs(normalWorld);
  // grout lines on the two axes in the face plane
  const g = (a: Node) => smoothstep(0.06, 0.0, min(a, float(1).sub(a)));
  const grout = select(n.y.greaterThan(0.5), max(g(f.x), g(f.z)), select(n.x.greaterThan(0.5), max(g(f.y), g(f.z)), max(g(f.x), g(f.y))));
  const tileCol = mix(mix(color(0x2c7fa8), color(0x5fb3cf), h), color(0xd8eef2), step(0.9, h));
  const base = mix(tileCol, color(0xc9d4d2), grout.mul(0.8));
  // Animated caustics on submerged surfaces.
  const under = smoothstep(DIMS.POOL.water, DIMS.POOL.water - 0.2, p.y);
  const cz = mx_worley_noise_float(vec3(p.x.mul(2.2), p.z.mul(2.2), U.time.mul(0.55)));
  const cz2 = mx_worley_noise_float(vec3(p.x.mul(3.1).add(4.0), p.z.mul(3.1), U.time.mul(0.7)));
  const caustic = pow(saturate(float(1).sub(min(cz, cz2).mul(2.2))), 4).mul(under);
  m.colorNode = base;
  m.emissiveNode = color(0xdffaff).mul(caustic).mul(U.sunIntensity.mul(saturate(U.sunDir.y)).mul(0.012));
  m.roughnessNode = mix(float(0.12), float(0.7), grout);
  m.metalnessNode = float(0);
  return m;
}

function corten() {
  const m = new MeshStandardNodeMaterial();
  const p = positionWorld;
  const n = n01(mx_fractal_noise_float(p.mul(1.8), 4, 2, 0.55));
  const wet = wetMask();
  m.colorNode = mix(color(0x5a2810), color(0x94481d), n).mul(float(1).sub(wet.mul(0.35)));
  m.roughnessNode = n.mul(0.15).add(0.78).mul(float(1).sub(wet.mul(0.4)));
  m.metalnessNode = float(0);
  return m;
}

function simple(hex: number, roughness: number, metalness = 0) {
  const m = new MeshStandardNodeMaterial({ color: new Color(hex), roughness, metalness });
  return m;
}

/** Woven upholstery. Each piece sets its own colour through vertex colours. */
function fabric() {
  const m = new MeshStandardNodeMaterial();
  m.vertexColors = true;
  const p = positionWorld;
  const weave = n01(mx_noise_float(p.mul(vec3(260, 90, 260)))).mul(0.5).add(n01(mx_noise_float(p.mul(vec3(90, 260, 90)))).mul(0.5));
  const mottle = n01(mx_fractal_noise_float(p.mul(3), 3, 2, 0.5));
  m.colorNode = attribute('color', 'vec3').mul(weave.mul(0.12).add(0.88)).mul(mottle.mul(0.08).add(0.94));
  m.roughnessNode = float(0.92);
  m.metalnessNode = float(0);
  return m;
}

/** Pale oiled oak with long grain. */
function oak() {
  const m = new MeshStandardNodeMaterial();
  const p = positionWorld;
  const grain = n01(mx_fractal_noise_float(vec3(p.x.mul(0.6), p.y.mul(24), p.z.mul(24)), 3, 2.3, 0.5)).toVar();
  const rings = smoothstep(0.35, 0.65, fract(grain.mul(7)));
  m.colorNode = mix(color(0xa77b4f), color(0xc89d6c), grain).mul(rings.mul(0.12).add(0.9));
  m.roughnessNode = grain.mul(0.15).add(0.45);
  m.metalnessNode = float(0);
  return m;
}

/** Honed pale stone (travertine) with faint veins. */
function stone() {
  const m = new MeshStandardNodeMaterial();
  const p = positionWorld;
  const base = n01(mx_fractal_noise_float(p.mul(1.4), 4, 2, 0.5));
  const vein = smoothstep(0.03, 0.0, abs(mx_fractal_noise_float(p.mul(vec3(0.9, 2.5, 0.9)), 4, 2, 0.55)));
  m.colorNode = mix(color(0xd9d2c4), color(0xeee9df), base).mul(float(1).sub(vein.mul(0.18)));
  m.roughnessNode = base.mul(0.1).add(0.22);
  m.metalnessNode = float(0);
  return m;
}

function lamp() {
  const m = new MeshStandardNodeMaterial({ color: new Color(0x2a2a2a), roughness: 0.5, metalness: 0.3 });
  m.emissiveNode = color(0xffd7a3).mul(U.nightLights.mul(18));
  return m;
}

export type MaterialSet = Record<MaterialId, Material>;

export function createMaterials(): MaterialSet {
  return {
    steelYellow: paintedSteel(0xf0b20a, 1),
    steelDark: paintedSteel(0x2b2a28, 1.4),
    steelGrey: bareSteel(0x8b8e90),
    grating: grating({ base: 0x8e9193, period: [0.034, 0.1], half: [0.0028, 0.0025], depth: [0.03, 0.012], metal: 0.45 }),
    net: grating({ base: 0x1f2224, period: [0.1, 0.1], half: [0.006, 0.006], depth: [0.01, 0.01], metal: 0 }),
    teak: teak(),
    concrete: concrete(),
    plaster: plaster(),
    mullion: simple(0x17181a, 0.38, 0.6),
    glass: glass(false),
    glassFrosted: glass(true),
    helideck: helideck(),
    rubber: simple(0x0f0f0f, 0.88),
    poolTile: poolTile(),
    corten: corten(),
    soil: simple(0x2a1c12, 1),
    lamp: lamp(),
    fabric: fabric(),
    oak: oak(),
    stone: stone(),
  };
}
