import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  PointLight,
  Quaternion,
  Shape,
  Sphere,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three/webgpu';
import {
  Fn,
  attribute,
  cameraPosition,
  color,
  cross,
  float,
  fract,
  frontFacing,
  max,
  min,
  mix,
  mx_noise_float,
  normalize,
  positionLocal,
  positionWorld,
  select,
  sin,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DIMS, type DronePose, type Vec3 } from '@ocean-home/shared';
import type { AimedLight } from '../render/stableClusteredLighting.ts';
import { U } from '../state.ts';
import { tubeGeometry } from './structure.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

// The platform's passenger drone: a four-seat electric air taxi. A lofted pearl-white
// fuselage with a flat floor and a graphite belly, a wrap-around canopy from the nose over
// the front seats, four swept carbon arms carrying airfoil-section ducts with three-blade
// rotors, skids, a cabin with bucket seats, a glass dashboard and a side stick, navigation
// lights, a beacon, a strobe and a landing light. Built in its body frame (x right, y up from
// the skids, nose towards -z) and driven by a DronePose. It also owns the rotor wash:
// uniforms the ocean reads (flattening under it) and a spray of particles over whatever deck
// it hovers above.

const D = DIMS.DRONE;
const B = D.body;
const STROBE_AIM = new Vector3(0, -1, 0);
const LANDING_AIM = new Vector3(0, -1, -0.5).normalize();

// ---------------------------------------------------------------- fuselage

/** Where the glass is, in the body frame (heights above the skids, stations along z). */
const GLASS = {
  /** Window sill and dash line: glass above it. */
  sill: 1.46,
  /** Top of the side windows, where the solid roof begins. */
  doorTop: 2.14,
  /** The glass roof over the front seats ends here; solid roof behind. */
  roofBar: -0.42,
  /** The windscreen meets the side glass. */
  aPillar: -1.05,
  /** Between the front and rear doors. */
  bPillar: 0.48,
  /** Back edge of the side glass. */
  cPillar: 1.78,
  /** How low the windscreen glass dips at the nose cap, for the view down over the nose. */
  noseSill: 1.14,
} as const;

/** Height of the glass's lower edge at station z: the sill along the cabin, dipping ahead of the A-pillars. */
function sillAt(z: number) {
  if (z >= GLASS.aPillar) return GLASS.sill;
  return lerp(GLASS.sill, GLASS.noseSill, smooth01((GLASS.aPillar - z) / (GLASS.aPillar - B.nose)));
}
/** Lowest seam of the doors. */
const DOOR_SILL = 0.92;
const FLOOR = B.floor;
/** Vertical position of the widest line of the fuselage, as a fraction of its height. */
const SHOULDER = 0.45;
const N_TOP = 2.4;
const N_BOT = 3.3;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth01 = (v: number) => {
  const u = clamp01(v);
  return u * u * (3 - 2 * u);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface Section {
  /** Half-width at the shoulder line. */
  w: number;
  top: number;
  bottom: number;
  /** Height of the shoulder line. */
  yc: number;
  /** How close to a tip this station is (0 in the cabin, 1 at the nose or tail), where the section rounds off. */
  tip: number;
}

/** The fuselage's cross-section at station z: a plateau through the cabin, elliptical tips. */
function section(z: number): Section {
  const u = clamp01((z - B.nose) / (B.tail - B.nose));
  // Plan view: full width from the A-pillars back past the rear seats, a blunt nose, a longer tail.
  const uw = 0.47;
  let w: number;
  if (u < uw - 0.1) {
    const t = (uw - 0.1 - u) / (uw - 0.1);
    w = B.halfWidth * Math.sqrt(Math.max(0, 1 - Math.pow(t, 2.3)));
  } else if (u > uw + 0.1) {
    const t = (u - uw - 0.1) / (1 - uw - 0.1);
    w = B.halfWidth * Math.pow(Math.max(0, 1 - Math.pow(t, 1.75)), 0.6);
  } else w = B.halfWidth;
  // Side view: the tips sit at cabin mid-height; the roof is level over the cabin, the belly flat under it.
  const tipY = lerp(1.36, 1.5, u);
  const tt = Math.max(0, (Math.abs(u - 0.5) - 0.13) / (0.5 - 0.13));
  const top = tipY + (B.roof - tipY) * Math.sqrt(Math.max(0, 1 - tt * tt));
  const tb = Math.max(0, (Math.abs(u - 0.52) - 0.21) / (0.48 - 0.21));
  const bottom = B.belly + (tipY - B.belly) * Math.pow(Math.min(1, tb), 2.2);
  const yc = bottom + (top - bottom) * SHOULDER;
  const tip = smooth01((0.5 - w) / 0.42);
  return { w: Math.max(w, 0.004), top, bottom, yc, tip };
}

/** Superellipse exponent at angle φ (−π/2 belly … π/2 roof) for a section. */
function exponentAt(s: Section, phi: number) {
  const nt = lerp(N_TOP, 2, s.tip);
  const nb = lerp(N_BOT, 2, s.tip);
  return lerp(nb, nt, smooth01((phi + 0.45) / 0.9));
}

/** A point on the shell: φ runs from −π/2 (belly) through 0 (right shoulder) to π/2 (roof) and on round. */
function shellPoint(s: Section, phi: number): [number, number] {
  const c = Math.cos(phi);
  const sn = Math.sin(phi);
  const n = exponentAt(s, Math.atan2(sn, Math.abs(c)));
  const h = sn >= 0 ? s.top - s.yc : s.yc - s.bottom;
  const x = s.w * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
  const y = s.yc + h * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n);
  return [x, y];
}

/** Half-width of the inside of the shell at height y and station z (0 outside it). */
function halfWidthAt(y: number, z: number) {
  const s = section(z);
  const up = y >= s.yc;
  const h = up ? s.top - s.yc : s.yc - s.bottom;
  const t = Math.abs(y - s.yc) / Math.max(h, 1e-6);
  if (t >= 1) return 0;
  const n = exponentAt(s, up ? Math.PI / 2 : -Math.PI / 2);
  return s.w * Math.pow(1 - Math.pow(t, n), 1 / n);
}

/** Height of the roof at (x, z). */
function roofAt(x: number, z: number) {
  const s = section(z);
  const n = exponentAt(s, Math.PI / 2);
  const t = Math.min(1, Math.abs(x) / s.w);
  return s.yc + (s.top - s.yc) * Math.pow(1 - Math.pow(t, n), 1 / n);
}

/** Ring layout: vertices per segment from the belly up the right side, over the roof, and down the left. */
const RING = { belly: 22, window: 14, roof: 30 } as const;
const RING_N = RING.belly * 2 + RING.window * 2 + RING.roof;

/**
 * The lofted shell as two index sets over one vertex set: the painted body and the glass.
 * Each ring runs through the sill and the window-top heights as grid lines, and the stations
 * include the pillars and the roof bar, so the glass's edges fall exactly on the grid.
 */
function loft(): { body: BufferGeometry; glass: BufferGeometry } {
  const NZ = 120;
  const stations: number[] = [];
  for (let i = 0; i <= NZ; i++) {
    // Cosine spacing: denser rings at the tips, where the shell curves most.
    const u = 0.5 - 0.5 * Math.cos((Math.PI * i) / NZ);
    stations.push(lerp(B.nose, B.tail, u));
  }
  for (const z of [GLASS.aPillar, GLASS.roofBar, GLASS.bPillar, GLASS.cPillar]) stations.push(z);
  stations.sort((a, b) => a - b);
  const NS = stations.length;
  const positions = new Float32Array(NS * RING_N * 3);
  const uvs = new Float32Array(NS * RING_N * 2);
  for (let i = 0; i < NS; i++) {
    const z = stations[i];
    const s = section(z);
    const top = s.top - 1e-4;
    const phiSill = phiAtHeight(z, Math.min(sillAt(z), top));
    const phiTop = Math.max(phiSill, phiAtHeight(z, Math.min(GLASS.doorTop, top)));
    // Angles of the ring: belly → sill → window top → over the roof → window top → sill → belly.
    const angles: number[] = [];
    const run = (a: number, b: number, n: number) => {
      for (let k = 0; k < n; k++) angles.push(lerp(a, b, k / n));
    };
    run(-Math.PI / 2, phiSill, RING.belly);
    run(phiSill, phiTop, RING.window);
    run(phiTop, Math.PI - phiTop, RING.roof);
    run(Math.PI - phiTop, Math.PI - phiSill, RING.window);
    run(Math.PI - phiSill, Math.PI * 1.5, RING.belly);
    for (let k = 0; k < RING_N; k++) {
      const [x, y] = shellPoint(s, angles[k]);
      const o = (i * RING_N + k) * 3;
      positions[o] = x;
      positions[o + 1] = y;
      positions[o + 2] = z;
      uvs[(i * RING_N + k) * 2] = k / RING_N;
      uvs[(i * RING_N + k) * 2 + 1] = (z - B.nose) / (B.tail - B.nose);
    }
  }
  // Which segment of the ring a vertex index belongs to: 0 belly, 1 window, 2 roof (either side).
  const segmentOf = (k: number) => {
    if (k < RING.belly) return 0;
    if (k < RING.belly + RING.window) return 1;
    if (k < RING.belly + RING.window + RING.roof) return 2;
    if (k < RING.belly + RING.window * 2 + RING.roof) return 1;
    return 0;
  };
  const bodyIdx: number[] = [];
  const glassIdx: number[] = [];
  for (let i = 0; i < NS - 1; i++) {
    const zc = (stations[i] + stations[i + 1]) / 2;
    const inGlassZ = zc < GLASS.cPillar;
    for (let k = 0; k < RING_N; k++) {
      const k1 = (k + 1) % RING_N;
      const a = i * RING_N + k;
      const b = i * RING_N + k1;
      const c = (i + 1) * RING_N + k1;
      const d = (i + 1) * RING_N + k;
      const seg = segmentOf(k);
      const glass = inGlassZ && (seg === 1 || (seg === 2 && zc < GLASS.roofBar));
      const into = glass ? glassIdx : bodyIdx;
      // Outward winding: stations advance towards +z, φ runs counter-clockwise seen from the nose.
      into.push(a, b, d, b, c, d);
    }
  }
  const make = (idx: number[]) => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.setAttribute('uv', new BufferAttribute(uvs, 2));
    g.setIndex(idx);
    return g;
  };
  // Normals from the whole shell, so the body and the glass shade as one surface across their edge.
  const whole = make([...bodyIdx, ...glassIdx]);
  whole.computeVertexNormals();
  const normal = whole.getAttribute('normal');
  const body = make(bodyIdx);
  const glass = make(glassIdx);
  body.setAttribute('normal', normal);
  glass.setAttribute('normal', normal);
  return { body, glass };
}

/** A hoop of tube following the shell at station z between two angles, standing `lift` proud of it. */
function hoop(z: number, phi0: number, phi1: number, radius: number, lift = 0.012, steps = 28): BufferGeometry[] {
  const s = section(z);
  const out: BufferGeometry[] = [];
  const lifted = { ...s, w: s.w + lift, top: s.top + lift, bottom: s.bottom - lift };
  const at = (phi: number): Vec3 => {
    const [x, y] = shellPoint(lifted, phi);
    return [x, y, z];
  };
  for (let k = 0; k < steps; k++) {
    const a = at(lerp(phi0, phi1, k / steps));
    const b = at(lerp(phi0, phi1, (k + 1) / steps));
    out.push(tubeGeometry(a, b, radius, 8));
  }
  return out;
}

/** The angle on the shell where the right side reaches height y (upper half). */
function phiAtHeight(z: number, y: number) {
  const s = section(z);
  const up = y >= s.yc;
  const h = up ? s.top - s.yc : s.yc - s.bottom;
  const n = exponentAt(s, up ? Math.PI / 2 : -Math.PI / 2);
  const t = Math.min(1, Math.abs(y - s.yc) / Math.max(h, 1e-6));
  const sn = Math.pow(t, n / 2);
  return (up ? 1 : -1) * Math.asin(Math.min(1, sn));
}

// ---------------------------------------------------------------- materials

/** The wordmark and registration painted on the tail: a canvas, redrawn once the UI fonts are in. */
function wordmarkTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const tex = new CanvasTexture(canvas);
  tex.anisotropy = 8;
  const draw = () => {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'alphabetic';
    const family = '"Instrument Sans Variable", "Instrument Sans", "Helvetica Neue", Arial, sans-serif';
    ctx.font = `700 150px ${family}`;
    (ctx as any).letterSpacing = '14px';
    // Top 60%: the wordmark; bottom 40%: the registration, each sampled by its own decal.
    const text = 'OCEAN HOME';
    const width = ctx.measureText(text).width;
    const scale = Math.min(1, 940 / width);
    ctx.save();
    ctx.translate(40, 136);
    ctx.scale(scale, scale);
    ctx.fillText(text, 0, 0);
    ctx.restore();
    ctx.font = `600 84px ${family}`;
    (ctx as any).letterSpacing = '10px';
    ctx.fillText('OH-04', 40, 246);
    tex.needsUpdate = true;
  };
  draw();
  if (typeof document !== 'undefined' && document.fonts?.ready) document.fonts.ready.then(draw).catch(() => undefined);
  return tex;
}

/** Distance in the (z, y) plane from an axis-aligned segment. */
function segDist(z: any, y: any, seg: { z?: number; y?: number; from: number; to: number }) {
  if (seg.y !== undefined) {
    const over = max(max(float(seg.from).sub(z), z.sub(seg.to)), 0);
    return vec2(y.sub(seg.y), over).length();
  }
  const over = max(max(float(seg.from).sub(y), y.sub(seg.to)), 0);
  return vec2(z.sub(seg.z!), over).length();
}

/**
 * Pearl-white paint with a clearcoat; on the fuselage it also carries the graphite belly, the
 * rig-yellow stripe, the door seams, the rubber seal round the glass, the wordmark, and a
 * cabin liner on its inside faces.
 */
function paintMaterial(fuselage: boolean) {
  const m = new MeshPhysicalNodeMaterial({ roughness: 0.24, metalness: 0.04, clearcoat: 1, clearcoatRoughness: 0.08, side: DoubleSide });
  const pearl = color(0xf1f2ee);
  if (!fuselage) {
    m.colorNode = pearl;
    return m;
  }
  const p = positionLocal;
  const y = p.y;
  const z = p.z;
  const ax = p.x.abs();
  const graphite = color(0x24282d);
  const accent = color(0xf2b40c);
  const seal = color(0x121416);
  const seam = color(0x5a5e63);
  const G = GLASS;
  // Graphite below the door sills, the yellow line just above them, fading out at the tips.
  const belly = smoothstep(DOOR_SILL + 0.03, DOOR_SILL - 0.03, y);
  const tipsFade = smoothstep(B.nose + 0.3, B.nose + 0.9, z).mul(smoothstep(B.tail - 0.2, B.tail - 0.8, z));
  const stripe = smoothstep(0.016, 0.006, y.sub(DOOR_SILL + 0.07).abs()).mul(tipsFade);
  // Seal round every edge of the glass.
  const sillHere = mix(float(G.sill), float(G.noseSill), smoothstep(G.aPillar, B.nose, z));
  const edges = [
    { z: G.cPillar, from: G.sill, to: G.doorTop },
    { y: G.doorTop, from: G.roofBar, to: G.cPillar },
    { z: G.roofBar, from: G.doorTop, to: 3 },
  ];
  let dEdge: any = vec2(y.sub(sillHere), max(z.sub(G.cPillar), 0)).length();
  for (const e of edges) dEdge = min(dEdge, segDist(z, y, e));
  const band = smoothstep(0.05, 0.03, dEdge);
  // Door outlines on the sides: two doors a side, from the sill seam up to the glass.
  const doors = [
    { z: G.aPillar, from: DOOR_SILL, to: G.sill },
    { z: G.bPillar, from: DOOR_SILL, to: G.sill },
    { z: G.cPillar, from: DOOR_SILL, to: G.sill },
    { y: DOOR_SILL, from: G.aPillar, to: G.cPillar },
  ];
  let dSeam: any = float(10);
  for (const e of doors) dSeam = min(dSeam, segDist(z, y, e));
  const sides = smoothstep(0.25, 0.5, ax);
  const seams = smoothstep(0.012, 0.005, dSeam).mul(sides);
  // Flush door handles: a dark slot below each window, behind the front edge of the door.
  const handle = (zc: number) => {
    const dz = z.sub(zc).abs().sub(0.07).max(0);
    const dy = y.sub(1.34).abs().sub(0.012).max(0);
    return smoothstep(0.012, 0.004, vec2(dz, dy).length());
  };
  const handles = max(handle(G.bPillar - 0.18), handle(G.cPillar - 0.18)).mul(sides);
  // Wordmark on the rear door panel and the registration on the tail cone, reading
  // nose-forward on both sides.
  const mark = wordmarkTexture();
  const decalAt = (z0: number, len: number, y0: number, h: number, v0: number, v1: number) => {
    const u = select(p.x.greaterThan(0), float(z0 + len).sub(z).div(len), z.sub(z0).div(len));
    const v = y.sub(y0).div(h);
    const inside = smoothstep(0.0, 0.01, u).mul(smoothstep(1.0, 0.99, u)).mul(smoothstep(0.0, 0.02, v)).mul(smoothstep(1.0, 0.98, v)).mul(smoothstep(0.3, 0.6, ax));
    return texture(mark, vec2(u, float(v0).add(v.mul(v1 - v0)))).a.mul(inside);
  };
  const decal = max(decalAt(G.bPillar + 0.14, 1.12, 1.1, 1.12 * 0.15, 0.42, 1.0), decalAt(1.95, 0.5, 1.56, 0.5 * 0.2, 0.0, 0.38));

  let outside: any = mix(pearl, graphite, belly);
  outside = mix(outside, accent, stripe);
  outside = mix(outside, seam, seams.mul(0.85));
  outside = mix(outside, seal, max(band, handles));
  outside = mix(outside, graphite, decal.mul(0.92));
  // Inside: a warm grey headliner above the windows, charcoal panels below them.
  const inside = mix(color(0x2f3236), color(0xb9b4ab), smoothstep(G.doorTop - 0.3, G.doorTop + 0.1, y));
  m.colorNode = select(frontFacing, outside, inside);
  const dull = max(band, max(belly.mul(0.55), seams));
  m.roughnessNode = select(frontFacing, mix(float(0.22), float(0.62), dull), float(0.9));
  m.clearcoatNode = select(frontFacing, float(1).sub(band), float(0));
  m.metalnessNode = select(frontFacing, float(0.04), float(0));
  return m;
}

function canopyMaterial() {
  // Dark tint, like the other clear glass: a pale one lit up in the sun and veiled the pilot's view.
  const m = new MeshPhysicalNodeMaterial({
    color: 0x1a2622,
    roughness: 0.08,
    metalness: 0,
    transparent: true,
    opacity: 0.2,
    side: DoubleSide,
    depthWrite: false,
  });
  return m;
}

function carbonMaterial() {
  const m = new MeshStandardNodeMaterial({ roughness: 0.38, metalness: 0.3 });
  const weave = smoothstep(0.4, 0.6, fract(positionLocal.x.add(positionLocal.z).mul(70))).mul(smoothstep(0.4, 0.6, fract(positionLocal.x.sub(positionLocal.z).mul(70)).oneMinus()));
  m.colorNode = mix(color(0x15171a), color(0x202327), weave);
  return m;
}

/** Translucent disc that stands in for propeller blades too fast to see. */
function discMaterial(opacity: any) {
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
  const r = positionLocal.xz.length().div(D.ductRadius);
  const bands = sin(r.mul(34)).mul(0.1).add(0.9);
  // Unlit, so it takes the light of the sky around it: dark at night, not a grey glow.
  m.colorNode = color(0x26282b).mul(U.ambient);
  m.opacityNode = opacity.mul(smoothstep(1.0, 0.92, r)).mul(smoothstep(0.14, 0.24, r)).mul(bands).mul(0.4);
  return m;
}

function emissive(hex: number, strength: any, base = 0x111111) {
  const m = new MeshStandardNodeMaterial({ color: base, roughness: 0.35 });
  m.emissiveNode = color(hex).mul(strength);
  return m;
}

/** The dashboard display: a horizon band, a heading tape and a few soft gauges, all in TSL. */
function screenMaterial(on: any) {
  const m = new MeshStandardNodeMaterial({ color: 0x06090c, roughness: 0.2, metalness: 0.1 });
  const uvn = attribute('uv', 'vec2') as any;
  const u = uvn.x;
  const v = uvn.y;
  const sea = color(0x7fd8e3);
  const rig = color(0xf2b40c);
  // Horizon: a bright line a third of the way down that breathes, over a dim sky/sea split.
  const horizon = float(0.62).add(sin(U.time.mul(0.7)).mul(0.015));
  const sky = smoothstep(horizon, horizon.add(0.5), v).mul(0.07);
  const line = smoothstep(0.02, 0.0, v.sub(horizon).abs()).mul(0.9);
  // Heading tape along the bottom: ticks sliding with time.
  const ticks = smoothstep(0.08, 0.0, fract(u.mul(18).add(U.time.mul(0.15))).sub(0.5).abs().sub(0.42).max(0)).mul(smoothstep(0.1, 0.09, v.sub(0.12).abs())).mul(0.55);
  // Two round gauges, left and right.
  const gauge = (cx: number) => {
    const d = vec2(u.sub(cx).mul(6.4), v.sub(0.6)).length();
    return smoothstep(0.02, 0.0, d.sub(0.22).abs()).mul(0.5).add(smoothstep(0.1, 0.0, d).mul(0.3));
  };
  const rings = max(gauge(0.14), gauge(0.86));
  const glow = sea.mul(sky.add(line).add(rings)).add(rig.mul(ticks));
  m.emissiveNode = glow.mul(on);
  return m;
}

// ---------------------------------------------------------------- geometry helpers

const tmpQ = new Quaternion();
const tmpM = new Matrix4();
const UP = new Vector3(0, 1, 0);

/** Merges geometries whether or not they are indexed (rounded boxes and extrusions are not). */
function mergeAll(geometries: BufferGeometry[]): BufferGeometry {
  const mixed = geometries.some((g) => !g.index) && geometries.some((g) => !!g.index);
  return mergeGeometries(mixed ? geometries.map((g) => (g.index ? g.toNonIndexed() : g)) : geometries, false)!;
}

/** A tube from a to b whose radius goes from ra to rb. */
function taperedTube(a: Vec3, b: Vec3, ra: number, rb: number, segments = 14) {
  const va = new Vector3(...a);
  const vb = new Vector3(...b);
  const dir = vb.clone().sub(va);
  const len = dir.length();
  const g = new CylinderGeometry(rb, ra, len, segments, 1, false);
  tmpQ.setFromUnitVectors(UP, dir.normalize());
  tmpM.compose(va.add(vb).multiplyScalar(0.5), tmpQ, new Vector3(1, 1, 1));
  g.applyMatrix4(tmpM);
  return g;
}

function rounded(w: number, h: number, d: number, r: number, segments = 3) {
  return new RoundedBoxGeometry(w, h, d, segments, Math.min(r, w / 2, h / 2, d / 2));
}

/** One rotor blade lying along +x from the hub: a tapered planform with a rounded tip, pitched by `pitch`. */
function bladeGeometry(root: number, tip: number, pitch: number) {
  const s = new Shape();
  const c0 = 0.21;
  const c1 = 0.12;
  s.moveTo(root, -c0 * 0.45);
  s.lineTo(tip - 0.1, -c1 * 0.5);
  s.quadraticCurveTo(tip, -c1 * 0.5, tip, 0);
  s.quadraticCurveTo(tip, c1 * 0.5, tip - 0.1, c1 * 0.5);
  s.lineTo(root, c0 * 0.55);
  s.closePath();
  const g = new ExtrudeGeometry(s, { depth: 0.016, bevelEnabled: false });
  g.translate(0, 0, -0.008);
  g.rotateX(-Math.PI / 2); // planform in the x-z plane, thickness along y
  g.rotateX(pitch);
  return g;
}

/** Spray kicked up from a deck: camera-facing quads flowing outward along the surface. */
function deckSpray(count: number) {
  const seeds = new Float32Array(count * 4 * 4);
  const corners = new Float32Array(count * 4 * 2);
  const idx = new Uint32Array(count * 6);
  const cs = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  for (let i = 0; i < count; i++) {
    const s = [Math.random(), Math.random(), Math.random(), Math.random()];
    for (let k = 0; k < 4; k++) {
      seeds.set(s, (i * 4 + k) * 4);
      corners.set(cs[k], (i * 4 + k) * 2);
    }
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(count * 4 * 3), 3));
  g.setAttribute('aSeed', new BufferAttribute(seeds, 4));
  g.setAttribute('aCorner', new BufferAttribute(corners, 2));
  g.setIndex(new BufferAttribute(idx, 1));
  g.boundingSphere = new Sphere(new Vector3(), 1e5);

  const center = uniform(new Vector3(D.pad[0], D.pad[1], D.pad[2]));
  const strength = uniform(0);
  /** Light on the spray: sky, sun and the lamps around it (unlit, it would glow white at night). */
  const light = uniform(new Color(1, 1, 1));
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  m.fog = true;
  const life: any = Fn(() => {
    const sd = attribute('aSeed', 'vec4') as any;
    return fract(U.time.mul(sd.w.mul(0.6).add(0.55)).add(sd.x));
  })();
  m.positionNode = Fn(() => {
    const sd = attribute('aSeed', 'vec4') as any;
    const c = attribute('aCorner', 'vec2') as any;
    const t: any = life;
    const ang: any = sd.y.mul(Math.PI * 2).add(t.mul(0.5));
    const r: any = float(1.6).add(t.mul(t.mul(-6).add(17)));
    const hop: any = sin(t.mul(Math.PI)).mul(sd.z.mul(1.0).add(0.15));
    const base: any = (center as any).add(vec3(ang.cos().mul(r), hop.add(0.08), ang.sin().mul(r)));
    const size = t.mul(2.0).add(0.45);
    const toCam = normalize(cameraPosition.sub(base));
    const right = normalize(cross(vec3(0, 1, 0), toCam));
    const up = cross(toCam, right);
    return base.add(right.mul(c.x.mul(size))).add(up.mul(c.y.mul(size)));
  })();
  const c = attribute('aCorner', 'vec2') as any;
  const soft = smoothstep(1, 0.2, c.length());
  const n = mx_noise_float(vec3(c.mul(1.7), life.mul(3))).mul(0.5).add(0.5);
  // Fine mist: it scatters back only part of the light falling on it.
  m.colorNode = mix(color(0xb9c2c6), color(0xeef2f3), n).mul(light).mul(0.45);
  // Puffs fade out close to the camera, so none sweep through the cockpit as a hard-edged veil.
  const near = smoothstep(2.0, 4.5, positionWorld.sub(cameraPosition).length());
  m.opacityNode = soft.mul(n.mul(0.6).add(0.4)).mul(life.oneMinus()).mul(smoothstep(0, 0.1, life)).mul(strength).mul(near).mul(0.2);
  const mesh = new Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 15;
  mesh.name = 'rotor-wash';
  return { mesh, center, strength, light };
}

// ---------------------------------------------------------------- sway

/**
 * The small movements of a hovering machine: a slow bob and a slight wander in pitch and roll,
 * calmer at speed and gone once the skids touch. Cosmetic: every browser adds its own from
 * the clock, and the seats (and so the cameras in them) follow it.
 */
export function swayPose<T extends DronePose & { grounded?: boolean }>(pose: T, t: number): T {
  if (!pose.visible || pose.grounded || pose.rotor < 0.5) return pose;
  const speed = Math.hypot(pose.velocity[0], pose.velocity[2]);
  const k = (0.45 + 0.55 * Math.max(0, 1 - speed / 12)) * clamp01(pose.altitude / 4);
  if (k <= 0) return pose;
  const dy = (Math.sin(t * 1.9) * 0.035 + Math.sin(t * 3.1 + 1.3) * 0.02) * k;
  return {
    ...pose,
    position: [pose.position[0], pose.position[1] + dy, pose.position[2]],
    pitch: pose.pitch + Math.sin(t * 1.5 + 2) * 0.007 * k,
    roll: pose.roll + Math.sin(t * 1.15) * 0.01 * k,
  };
}

// ---------------------------------------------------------------- the drone

export class Drone {
  readonly group = new Group();
  readonly spray = deckSpray(700);
  private readonly body = new Group();
  private readonly props: Group[] = [];
  private readonly discOpacity = uniform(0);
  private readonly strobe = uniform(0);
  private readonly beacon = uniform(0);
  private readonly strobeLight = new PointLight(0xffffff, 0, 30, 2);
  private readonly landingLight = new PointLight(0xfff2dc, 0, 40, 2);
  private readonly cabinLight = new PointLight(0xbfe6ff, 0, 4, 2);
  private readonly screens = uniform(0);
  private readonly landingLens = uniform(0);
  private angle = 0;
  private time = 0;
  /** Lamplight around the spray (lampLightAt), set by the caller each frame. */
  sprayLamplight = 0;
  /** Latest pose, for audio and debugging. */
  pose: DronePose | null = null;

  constructor() {
    this.group.name = 'drone';
    this.build();
    this.group.add(this.body);
    this.group.visible = false;
  }

  private build() {
    const paint = paintMaterial(true);
    const ductPaint = paintMaterial(false);
    const carbon = carbonMaterial();
    const dark = new MeshStandardNodeMaterial({ color: 0x1b1e22, roughness: 0.5, metalness: 0.45 });
    const rubber = new MeshStandardNodeMaterial({ color: 0x0f1113, roughness: 0.92 });
    const seatMat = new MeshStandardNodeMaterial({ color: 0x2c3036, roughness: 0.82 });
    const seatTrim = new MeshStandardNodeMaterial({ color: 0x8e8a82, roughness: 0.7 });
    const floorMat = new MeshStandardNodeMaterial({ color: 0x25282c, roughness: 0.9 });
    const trim = new MeshStandardNodeMaterial({ color: 0x9ea3a7, roughness: 0.28, metalness: 0.85 });
    const liner = new MeshStandardNodeMaterial({ color: 0xd8d4cc, roughness: 0.85 });

    // Fuselage: painted shell and glass from one loft.
    const shell = loft();
    this.body.add(new Mesh(shell.body, paint));
    const glass = new Mesh(shell.glass, canopyMaterial());
    glass.renderOrder = 12;
    this.body.add(glass);

    // Pillars and the roof bar, in carbon, standing just proud of the glass.
    const G = GLASS;
    const frame: BufferGeometry[] = [];
    const sideTop = (z: number) => phiAtHeight(z, G.doorTop);
    const sill = (z: number) => phiAtHeight(z, G.sill);
    frame.push(...hoop(G.aPillar, sill(G.aPillar), Math.PI - sill(G.aPillar), 0.034, 0.012, 40));
    frame.push(...hoop(G.roofBar, sideTop(G.roofBar), Math.PI - sideTop(G.roofBar), 0.04, 0.012, 32));
    for (const z of [G.bPillar, G.cPillar]) {
      frame.push(...hoop(z, sill(z), sideTop(z) + 0.04, 0.03, 0.01, 10));
      frame.push(...hoop(z, Math.PI - sideTop(z) - 0.04, Math.PI - sill(z), 0.03, 0.01, 10));
    }
    this.body.add(new Mesh(mergeAll(frame), carbon));

    // Arms: swept carbon from the roof shoulders out to the ducts, each with a root fairing.
    const arms: BufferGeometry[] = [];
    const R = D.ductRadius;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const cx = sx * D.armX;
        const cy = D.ductY;
        const cz = sz * D.armZ;
        const rz = sz < 0 ? -0.95 : 1.1;
        const rx = sx * 0.82;
        const root: Vec3 = [rx, roofAt(rx, rz) - 0.02, rz];
        const dx = cx - rx;
        const dz = cz - rz;
        const dl = Math.hypot(dx, dz);
        const end: Vec3 = [cx - (dx / dl) * (R + 0.02), cy - 0.02, cz - (dz / dl) * (R + 0.02)];
        arms.push(taperedTube(root, end, 0.12, 0.08, 16));
        const fairing = new SphereGeometry(1, 16, 10);
        fairing.scale(0.26, 0.1, 0.32);
        fairing.translate(rx, roofAt(rx, rz) + 0.02, rz);
        arms.push(fairing);
      }
    }
    this.body.add(new Mesh(mergeAll(arms), carbon));

    // Ducts: an airfoil ring, painted outside and dark inside, with stators, a motor and a rotor.
    const shrouds: BufferGeometry[] = [];
    const liners: BufferGeometry[] = [];
    const hubs: BufferGeometry[] = [];
    const shroudProfile: Array<[number, number]> = [
      [R + 0.0, -0.22],
      [R + 0.08, -0.15],
      [R + 0.14, -0.03],
      [R + 0.13, 0.1],
      [R + 0.08, 0.18],
      [R + 0.01, 0.21],
    ];
    const linerProfile: Array<[number, number]> = [
      [R + 0.01, 0.21],
      [R - 0.05, 0.17],
      [R - 0.08, 0.08],
      [R - 0.08, -0.12],
      [R - 0.05, -0.2],
      [R + 0.0, -0.22],
    ];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const cx = sx * D.armX;
        const cy = D.ductY;
        const cz = sz * D.armZ;
        const shroud = new LatheGeometry(shroudProfile.map(([r, y]) => new Vector2(r, y)), 80);
        shroud.translate(cx, cy, cz);
        shrouds.push(shroud);
        const lin = new LatheGeometry(linerProfile.map(([r, y]) => new Vector2(r, y)), 80);
        lin.translate(cx, cy, cz);
        liners.push(lin);
        // Three stator vanes under the rotor, a motor can with a domed cap.
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2 + 0.5;
          const vane = new BoxGeometry(R - 0.26, 0.11, 0.028);
          vane.rotateX(0.35);
          vane.translate((R - 0.26) / 2 + 0.18, 0, 0);
          vane.rotateY(a);
          vane.translate(cx, cy - 0.1, cz);
          hubs.push(vane);
        }
        const motor = new CylinderGeometry(0.19, 0.2, 0.3, 24);
        motor.translate(cx, cy - 0.08, cz);
        hubs.push(motor);
        const cap = new SphereGeometry(0.2, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
        cap.translate(cx, cy - 0.23, cz);
        hubs.push(cap);
        // Rotor: three pitched blades and a spinner, spun as a group. Diagonal pairs counter-rotate.
        const dir = sx * sz;
        const prop = new Group();
        prop.position.set(cx, cy + 0.09, cz);
        const blades: BufferGeometry[] = [];
        for (let k = 0; k < D.blades; k++) {
          const b = bladeGeometry(0.17, R - 0.1, dir * 0.3);
          b.rotateY((k / D.blades) * Math.PI * 2);
          blades.push(b);
        }
        const spinner = new SphereGeometry(0.12, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
        spinner.scale(1, 0.8, 1);
        blades.push(spinner);
        const bladeMesh = new Mesh(mergeAll(blades), carbon);
        bladeMesh.castShadow = true;
        prop.add(bladeMesh);
        const disc = new CircleGeometry(R - 0.09, 64);
        disc.rotateX(-Math.PI / 2);
        const discMesh = new Mesh(disc, discMaterial(this.discOpacity));
        discMesh.renderOrder = 16;
        discMesh.castShadow = false;
        prop.add(discMesh);
        prop.userData.dir = dir;
        prop.userData.blades = bladeMesh;
        this.props.push(prop);
        this.body.add(prop);
      }
    }
    this.body.add(new Mesh(mergeAll(shrouds), ductPaint));
    this.body.add(new Mesh(mergeAll(liners), dark));
    this.body.add(new Mesh(mergeAll(hubs), dark));

    // Landing gear: two skids with swept tips, on four splayed struts, with a step under each door.
    const gear: BufferGeometry[] = [];
    const steps: BufferGeometry[] = [];
    const SKID_X = 1.05;
    for (const s of [-1, 1]) {
      const x = s * SKID_X;
      gear.push(tubeGeometry([x, 0.055, -1.75], [x, 0.055, 1.95], 0.05, 12));
      gear.push(tubeGeometry([x, 0.055, -1.75], [x * 0.98, 0.3, -2.15], 0.05, 12));
      const tipCap = new SphereGeometry(0.05, 10, 8);
      tipCap.translate(x * 0.98, 0.3, -2.15);
      gear.push(tipCap);
      const endCap = new SphereGeometry(0.05, 10, 8);
      endCap.translate(x, 0.055, 1.95);
      gear.push(endCap);
      for (const z of [-1.05, 1.05]) {
        const top: Vec3 = [s * 0.66, B.belly + 0.04, z * 0.92];
        gear.push(taperedTube([x, 0.07, z], top, 0.045, 0.06, 12));
      }
      const step = new BoxGeometry(0.26, 0.03, 1.1);
      step.translate(x - s * 0.02, 0.12, 0.05);
      steps.push(step);
    }
    this.body.add(new Mesh(mergeAll(gear), trim));
    this.body.add(new Mesh(mergeAll(steps), rubber));

    // Cabin floor, cut to the shell a little below its top so it clears the belly all round.
    const edge: Vector2[] = [];
    for (let z = -1.7; z <= 1.9; z += 0.05) {
      const w = halfWidthAt(FLOOR - 0.025, z) - 0.012;
      if (w > 0.12) edge.push(new Vector2(w, z));
    }
    const floor = new ExtrudeGeometry(new Shape([...edge, ...edge.map((p) => new Vector2(-p.x, p.y)).reverse()]), { depth: 0.025, bevelEnabled: false });
    floor.rotateX(Math.PI / 2).translate(0, FLOOR, 0);
    this.body.add(new Mesh(floor, floorMat));

    // Bucket seats: base, cushion with bolsters, reclined backrest with a headrest.
    const seats: BufferGeometry[] = [];
    const trims: BufferGeometry[] = [];
    for (const [x, y, z] of D.seats) {
      const base = rounded(0.44, y - 0.07 - FLOOR, 0.42, 0.03);
      base.translate(x, (y - 0.07 + FLOOR) / 2, z + 0.02);
      trims.push(base);
      const cushion = rounded(0.54, 0.13, 0.52, 0.05);
      cushion.translate(x, y - 0.065, z);
      seats.push(cushion);
      for (const sx of [-1, 1]) {
        const bolster = rounded(0.09, 0.1, 0.46, 0.035);
        bolster.translate(x + sx * 0.24, y - 0.01, z + 0.02);
        seats.push(bolster);
      }
      const back = rounded(0.54, 0.64, 0.12, 0.05);
      back.rotateX(0.2);
      back.translate(x, y + 0.3, z + 0.3);
      seats.push(back);
      const wings = rounded(0.1, 0.5, 0.16, 0.04);
      for (const sx of [-1, 1]) {
        const wing = wings.clone();
        wing.rotateX(0.2);
        wing.translate(x + sx * 0.24, y + 0.25, z + 0.24);
        seats.push(wing);
      }
      const headrest = rounded(0.28, 0.16, 0.1, 0.04);
      headrest.rotateX(0.2);
      headrest.translate(x, y + 0.74, z + 0.4);
      seats.push(headrest);
    }
    this.body.add(new Mesh(mergeAll(seats), seatMat));
    this.body.add(new Mesh(mergeAll(trims), seatTrim));

    // Dashboard: a wide cowl with a glass display, on a pedestal, and a centre console.
    const dashParts: BufferGeometry[] = [];
    const cowl = rounded(1.9, 0.16, 0.42, 0.06);
    cowl.rotateX(-0.12);
    cowl.translate(0, 1.4, -1.5);
    dashParts.push(cowl);
    const pedestal = rounded(0.46, 1.34 - FLOOR, 0.3, 0.04);
    pedestal.translate(0, (1.34 + FLOOR) / 2, -1.48);
    dashParts.push(pedestal);
    const console = rounded(0.32, 0.3, 0.9, 0.05);
    console.translate(0, FLOOR + 0.15, -0.5);
    dashParts.push(console);
    // The pilot's side stick on a short console by the door.
    const stickBase = rounded(0.16, 0.08, 0.34, 0.03);
    stickBase.translate(-0.94, 1.28, -0.66);
    dashParts.push(stickBase);
    dashParts.push(tubeGeometry([-0.94, 1.3, -0.7], [-0.94, 1.5, -0.74], 0.018, 10));
    const grip = rounded(0.05, 0.1, 0.06, 0.02);
    grip.translate(-0.94, 1.54, -0.75);
    dashParts.push(grip);
    this.body.add(new Mesh(mergeAll(dashParts), dark));
    // Glare shield: a matte deck from the cowl forward over the nose cavity, sloping down with the glass.
    const shieldZ0 = -1.3;
    const shieldZ1 = -2.0;
    const shieldY = (z: number) => lerp(1.45, 1.3, (z - shieldZ0) / (shieldZ1 - shieldZ0));
    const shieldEdge: Vector2[] = [];
    for (let z = shieldZ1; z <= shieldZ0 + 1e-6; z += 0.05) shieldEdge.push(new Vector2(halfWidthAt(shieldY(z), z) - 0.012, z));
    const shield = new ExtrudeGeometry(new Shape([...shieldEdge, ...shieldEdge.map((p) => new Vector2(-p.x, p.y)).reverse()]), { depth: 0.03, bevelEnabled: false });
    shield.rotateX(Math.PI / 2);
    const slope = (shieldY(shieldZ1) - shieldY(shieldZ0)) / (shieldZ1 - shieldZ0);
    shield.applyMatrix4(new Matrix4().set(1, 0, 0, 0, 0, 1, slope, shieldY(shieldZ0) - slope * shieldZ0, 0, 0, 1, 0, 0, 0, 0, 1));
    this.body.add(new Mesh(shield, new MeshStandardNodeMaterial({ color: 0x1f2225, roughness: 0.95 })));
    const screenOn = this.screens.mul(mix(float(1.6), float(0.25), U.nightLights));
    const screen = new BoxGeometry(1.6, 0.11, 0.01);
    screen.rotateX(-0.55);
    screen.translate(0, 1.5, -1.36);
    this.body.add(new Mesh(screen, screenMaterial(screenOn)));
    const consoleScreen = new BoxGeometry(0.22, 0.01, 0.3);
    consoleScreen.translate(0, FLOOR + 0.306, -0.7);
    this.body.add(new Mesh(consoleScreen, screenMaterial(screenOn.mul(0.6))));

    // Headliner panel with two dome lights.
    const domes: BufferGeometry[] = [];
    for (const z of [-0.2, 0.95]) {
      const dome = new CircleGeometry(0.07, 16);
      dome.rotateX(Math.PI / 2);
      dome.translate(0, roofAt(0, z) - 0.03, z);
      domes.push(dome);
    }
    this.body.add(new Mesh(mergeAll(domes), emissive(0xdff2ff, this.screens.mul(mix(float(2.5), float(0.5), U.nightLights)), 0xd8d4cc)));
    const sills: BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      const sillBar = new BoxGeometry(0.08, 0.04, 2.5);
      sillBar.translate(s * (halfWidthAt(FLOOR + 0.02, 0.5) - 0.06), FLOOR + 0.04, 0.5);
      sills.push(sillBar);
    }
    this.body.add(new Mesh(mergeAll(sills), liner));

    // Underside: a sensor dome and the landing light under the nose, the strobe under the cabin.
    const domeGlass = new SphereGeometry(0.11, 18, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    domeGlass.translate(0.34, section(-1.8).bottom + 0.02, -1.8);
    this.body.add(new Mesh(domeGlass, new MeshStandardNodeMaterial({ color: 0x0b0d10, roughness: 0.15, metalness: 0.2 })));
    const housings: BufferGeometry[] = [];
    const landingHousing = new CylinderGeometry(0.1, 0.1, 0.06, 18);
    landingHousing.translate(-0.34, section(-1.8).bottom + 0.01, -1.8);
    housings.push(landingHousing);
    this.body.add(new Mesh(mergeAll(housings), dark));
    const landingLens = new CircleGeometry(0.08, 18);
    landingLens.rotateX(Math.PI / 2);
    landingLens.translate(-0.34, section(-1.8).bottom - 0.021, -1.8);
    this.body.add(new Mesh(landingLens, emissive(0xfff2dc, this.landingLens.mul(12), 0x222222)));

    // Lights: red/green on the front ducts, white on the rear, a beacon on the roof, a strobe below.
    const navGlow = U.nightLights.mul(12).add(1.5);
    const nav = (hex: number, x: number, z: number) => {
      const housing = new SphereGeometry(0.075, 12, 8);
      housing.scale(1, 0.7, 1);
      housing.translate(x, D.ductY + 0.02, z);
      this.body.add(new Mesh(housing, emissive(hex, navGlow)));
    };
    const rimX = D.armX + D.ductRadius + 0.13;
    nav(0xff2010, -rimX, -D.armZ);
    nav(0x20ff40, rimX, -D.armZ);
    nav(0xffffff, -rimX, D.armZ);
    nav(0xffffff, rimX, D.armZ);
    const beacon = new SphereGeometry(0.06, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    beacon.translate(0, roofAt(0, 0.95) + 0.02, 0.95);
    this.body.add(new Mesh(beacon, emissive(0xff2a1a, this.beacon.mul(40).add(U.nightLights.mul(2)), 0x3a0a08)));
    const strobe = new SphereGeometry(0.06, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    strobe.translate(0, B.belly + 0.0, 0.3);
    this.body.add(new Mesh(strobe, emissive(0xffffff, this.strobe.mul(60))));
    // The strobe and the landing light are aimed down from the belly, so they light the deck
    // and the sea, not the drone itself or the cabin above them.
    this.strobeLight.position.set(0, B.belly - 0.1, 0.3);
    this.landingLight.position.set(-0.34, B.belly - 0.2, -1.8);
    Object.assign(this.strobeLight.userData, { aim: new Vector3(0, -1, 0), cone: 0.1 } satisfies AimedLight);
    Object.assign(this.landingLight.userData, { aim: new Vector3(0, -1, -0.5).normalize(), cone: 0.72 } satisfies AimedLight);
    this.cabinLight.position.set(0, B.roof - 0.2, 0.2);
    this.body.add(this.strobeLight, this.landingLight, this.cabinLight);

    this.body.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh && mesh !== glass && mesh.renderOrder < 16) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }

  /**
   * Places the drone. `ground` is the height of whatever solid surface lies under it (null
   * over open water); `occupied` lights the cabin and the instruments.
   */
  update(pose: DronePose, dt: number, ground: number | null, occupied: boolean) {
    this.pose = pose;
    this.time += dt;
    this.group.visible = pose.visible;
    if (!pose.visible) {
      U.washSea.value = 0;
      U.droneCabin.value.w = 0;
      this.spray.strength.value = 0;
      this.strobeLight.intensity = 0;
      this.landingLight.intensity = 0;
      this.cabinLight.intensity = 0;
      return;
    }
    const [x, y, z] = pose.position;
    this.group.position.set(x, y, z);
    this.group.rotation.set(pose.pitch, pose.yaw, pose.roll, 'YXZ');
    this.group.updateMatrixWorld();
    for (const [l, local] of [
      [this.strobeLight, STROBE_AIM],
      [this.landingLight, LANDING_AIM],
    ] as const) {
      (l.userData as AimedLight).aim!.copy(local).transformDirection(this.group.matrixWorld);
    }
    U.droneCabin.value.set(x, y + (B.roof + B.floor) / 2, z, 1.6);

    // Rotors: blades blur into discs as they speed up.
    const rpm = Math.max(0, pose.rotor);
    this.angle += rpm * D.rotorHz * Math.PI * 2 * dt;
    const blur = Math.min(1, Math.max(0, (rpm - 0.12) / 0.3));
    this.discOpacity.value = blur;
    for (const p of this.props) {
      p.rotation.y = this.angle * p.userData.dir;
      (p.userData.blades as Mesh).visible = blur < 0.97;
    }
    const powered = rpm > 0.02 || occupied;
    this.screens.value += ((powered ? 1 : 0) - this.screens.value) * Math.min(1, dt * 3);
    // Dim: night exposure runs up to 6×, and anything brighter blows the white shell out into a haze.
    this.cabinLight.intensity = occupied ? 0.3 : 0;

    // Beacon (double blink) and strobe flash whenever the motors run; the landing light near the ground at night.
    const running = rpm > 0.05;
    const c = this.time % 1.0;
    const flash = running && c < 0.07 ? 1 : 0;
    const bc = (this.time + 0.4) % 1.3;
    this.beacon.value = running && (bc < 0.07 || (bc > 0.2 && bc < 0.27)) ? 1 : 0;
    this.strobe.value = flash;
    this.strobeLight.intensity = flash * (2 + 25 * U.nightLights.value);
    const height = ground === null ? y : y - ground;
    const low = height < 60 && rpm > 0.5 && height > 0.4;
    const night = U.nightLights.value;
    this.landingLight.intensity = low ? 30 * night : 0;
    this.landingLens.value = low ? 0.1 + 0.9 * night : 0;

    // Rotor wash: spray on a deck below, flattening on the sea.
    // Idling on the pad moves no air worth seeing; the spray builds towards lift-off.
    const thrust = Math.max(0, Math.min(1, (rpm - 0.45) / 0.4));
    const deck = ground !== null && ground > 0.5 ? thrust * thrust * Math.max(0, Math.min(1, 1 - height / 12)) : 0;
    this.spray.center.value.set(x, ground ?? 0, z);
    this.spray.strength.value = deck;
    const lamps = this.sprayLamplight / Math.PI;
    this.spray.light.value.copy(U.ambient.value).addScalar(lamps);
    U.washCenter.value.set(x, z);
    U.washSea.value = ground === null || ground < 0.5 ? rpm * rpm * Math.max(0, Math.min(1, (26 - y) / 20)) : 0;
  }
}
