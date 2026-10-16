import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  PointLight,
  Quaternion,
  TorusGeometry,
  Vector3,
} from 'three/webgpu';
import { abs, color, float, fract, max, mx_noise_float, positionWorld, sin, smoothstep, uv, vec2, vec3 } from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { FurnitureDef, Layout } from '@ocean-home/shared';
import { U } from '../state.ts';
import type { MaterialSet } from './materials/index.ts';
import { tubeGeometry } from './structure.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Procedural furniture. Every piece is built in its own frame (front = +z, floor = 0) from
// boxes, rounded boxes and tubes, then placed by its layout definition. The colliders come
// from the shared layout, so what you see is what you bump into.

type Bin = 'fabric' | 'oak' | 'stone' | 'teak' | 'frame' | 'steel' | 'ceramic' | 'net' | 'rope' | 'ember' | 'shade';

class Pieces {
  readonly geos = new Map<Bin, BufferGeometry[]>();
  private readonly frame = new Matrix4();
  private readonly q = new Quaternion();

  constructor(f: FurnitureDef) {
    this.q.setFromAxisAngle(new Vector3(0, 1, 0), f.rotationY);
    this.frame.compose(new Vector3(...f.position), this.q, new Vector3(1, 1, 1));
  }

  add(bin: Bin, geo: BufferGeometry, tint?: number) {
    // Rounded boxes come unindexed; make everything unindexed so pieces merge.
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (bin === 'fabric' || bin === 'rope') {
      const n = g.getAttribute('position').count;
      const c = new Float32Array(n * 3);
      const col = [((tint ?? 0xffffff) >> 16) & 255, ((tint ?? 0xffffff) >> 8) & 255, (tint ?? 0xffffff) & 255].map((v) => (v / 255) ** 2.2);
      for (let i = 0; i < n; i++) c.set(col, i * 3);
      g.setAttribute('color', new BufferAttribute(c, 3));
    }
    g.applyMatrix4(this.frame);
    const list = this.geos.get(bin) ?? [];
    list.push(g);
    this.geos.set(bin, list);
  }

  /** Axis-aligned box in the local frame, from min to max corner. */
  box(bin: Bin, min: [number, number, number], max: [number, number, number], tint?: number) {
    const g = new BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    g.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    this.add(bin, g, tint);
  }

  /** Soft box (cushions, mattresses). */
  soft(bin: Bin, min: [number, number, number], max: [number, number, number], radius: number, tint?: number, tiltX = 0) {
    const w = max[0] - min[0];
    const h = max[1] - min[1];
    const d = max[2] - min[2];
    const g = new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, w / 2, h / 2, d / 2) - 1e-4);
    if (tiltX) g.rotateX(tiltX);
    g.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    this.add(bin, g, tint);
  }

  tube(bin: Bin, a: [number, number, number], b: [number, number, number], r: number, segments = 10) {
    this.add(bin, tubeGeometry(a, b, r, segments));
  }

  cyl(bin: Bin, x: number, z: number, y0: number, y1: number, r0: number, r1 = r0, segments = 24, tint?: number) {
    const g = new CylinderGeometry(r1, r0, y1 - y0, segments);
    g.translate(x, (y0 + y1) / 2, z);
    this.add(bin, g, tint);
  }
}

const SAND = 0xcbbfa6;
const LINEN = 0xece7dd;
const OUTDOOR = 0xe2ddd2;
const SLATE = 0x56616b;
const DUVET = 0x8d9ba6;
const CHARCOAL = 0x34363a;

function sofa(p: Pieces, f: FurnitureDef) {
  const [w, , d] = f.size;
  const hw = w / 2;
  const hd = d / 2;
  const arm = 0.18;
  p.box('oak', [-hw + 0.05, 0, -hd + 0.06], [hw - 0.05, 0.1, hd - 0.06]);
  p.soft('fabric', [-hw, 0.1, -hd], [hw, 0.36, hd], 0.04, SAND);
  const n = 3;
  const cw = (w - 2 * arm) / n;
  for (let i = 0; i < n; i++) {
    const x0 = -hw + arm + i * cw;
    p.soft('fabric', [x0 + 0.01, 0.36, -hd + 0.24], [x0 + cw - 0.01, 0.5, hd - 0.02], 0.05, SAND);
    p.soft('fabric', [x0 + 0.02, 0.4, -hd + 0.02], [x0 + cw - 0.02, 0.84, -hd + 0.26], 0.07, SAND, -0.12);
  }
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? -hw : hw - arm;
    p.soft('fabric', [x0, 0.1, -hd], [x0 + arm, 0.62, hd], 0.06, SAND);
  }
  // A couple of throw cushions.
  p.soft('fabric', [-hw + arm + 0.05, 0.48, -hd + 0.22], [-hw + arm + 0.5, 0.88, -hd + 0.38], 0.08, SLATE, -0.25);
  p.soft('fabric', [hw - arm - 0.5, 0.48, -hd + 0.22], [hw - arm - 0.05, 0.88, -hd + 0.38], 0.08, 0xb78e62, -0.25);
}

function coffeeTable(p: Pieces, f: FurnitureDef) {
  const [w, h, d] = f.size;
  p.box('stone', [-w / 2, h - 0.05, -d / 2], [w / 2, h, d / 2]);
  for (const s of [-1, 1]) p.box('oak', [s * (w / 2 - 0.12) - 0.04, 0, -d / 2 + 0.05], [s * (w / 2 - 0.12) + 0.04, h - 0.05, d / 2 - 0.05]);
}

function rug(p: Pieces, f: FurnitureDef) {
  const [w, , d] = f.size;
  p.box('fabric', [-w / 2, 0, -d / 2], [w / 2, 0.008, d / 2], 0x9c8f7c);
  p.box('fabric', [-w / 2 + 0.18, 0.008, -d / 2 + 0.18], [w / 2 - 0.18, 0.011, d / 2 - 0.18], 0xbfb39f);
}

function diningTable(p: Pieces, f: FurnitureDef) {
  const [w, h, d] = f.size;
  p.box('oak', [-w / 2, h - 0.045, -d / 2], [w / 2, h, d / 2]);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (w / 2 - 0.12);
      const z = sz * (d / 2 - 0.1);
      p.box('frame', [x - 0.025, 0, z - 0.025], [x + 0.025, h - 0.045, z + 0.025]);
    }
    p.box('frame', [sx * (w / 2 - 0.12) - 0.02, h - 0.12, -d / 2 + 0.1], [sx * (w / 2 - 0.12) + 0.02, h - 0.045, d / 2 - 0.1]);
  }
}

function diningChair(p: Pieces, f: FurnitureDef) {
  const [w, h, d] = f.size;
  const hw = w / 2;
  const hd = d / 2;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (hw - 0.04);
      const z = sz * (hd - 0.04);
      p.box('oak', [x - 0.018, 0, z - 0.018], [x + 0.018, sz < 0 ? h : 0.44, z + 0.018]);
    }
  }
  p.box('oak', [-hw, 0.42, -hd], [hw, 0.45, hd]);
  p.soft('fabric', [-hw + 0.02, 0.45, -hd + 0.04], [hw - 0.02, 0.49, hd - 0.02], 0.015, SLATE);
  p.box('oak', [-hw, h - 0.2, -hd + 0.02], [hw, h - 0.02, -hd + 0.05]);
}

function kitchenIsland(p: Pieces, f: FurnitureDef) {
  const [w, h, d] = f.size;
  const hw = w / 2;
  const hd = d / 2;
  p.box('oak', [-hw + 0.05, 0.08, -hd], [hw - 0.05, h - 0.04, hd - 0.3]);
  p.box('frame', [-hw + 0.08, 0, -hd + 0.04], [hw - 0.08, 0.08, hd - 0.34]);
  p.box('stone', [-hw, h - 0.04, -hd], [hw, h, hd]);
  // Sink and tap.
  p.box('steel', [-0.9, h - 0.005, -hd + 0.15], [-0.35, h + 0.002, -hd + 0.55]);
  p.tube('steel', [-0.62, h, -hd + 0.1], [-0.62, h + 0.32, -hd + 0.1], 0.014);
  p.tube('steel', [-0.62, h + 0.32, -hd + 0.1], [-0.62, h + 0.3, -hd + 0.3], 0.012);
  // Cabinet door seams.
  for (let x = -hw + 0.05 + 0.6; x < hw - 0.1; x += 0.6) p.box('frame', [x - 0.004, 0.1, -hd - 0.002], [x + 0.004, h - 0.06, -hd + 0.002]);
}

function kitchenCounter(p: Pieces, f: FurnitureDef) {
  const [w, h, d] = f.size;
  const hw = w / 2;
  const hd = d / 2;
  p.box('frame', [-hw, 0, -hd + 0.05], [hw, 0.08, hd - 0.08]);
  p.box('oak', [-hw, 0.08, -hd], [hw, h - 0.04, hd]);
  p.box('stone', [-hw, h - 0.04, -hd], [hw, h, hd + 0.02]);
  p.box('frame', [-0.4, h, -0.2], [0.4, h + 0.006, 0.25]); // induction hob
  for (let x = -hw + 0.6; x < hw - 0.1; x += 0.6) p.box('frame', [x - 0.004, 0.1, hd - 0.002], [x + 0.004, h - 0.06, hd + 0.002]);
}

function barStool(p: Pieces, f: FurnitureDef) {
  const h = f.size[1];
  p.cyl('frame', 0, 0, 0, 0.02, 0.2, 0.2, 24);
  p.tube('frame', [0, 0.02, 0], [0, h - 0.04, 0], 0.025);
  const ring = new TorusGeometry(0.15, 0.01, 6, 24);
  ring.rotateX(Math.PI / 2);
  ring.translate(0, 0.3, 0);
  p.add('frame', ring);
  p.cyl('fabric', 0, 0, h - 0.05, h, 0.18, 0.19, 24, 0x6b4a33);
}

function bed(p: Pieces, f: FurnitureDef) {
  const [w, , d] = f.size;
  const hw = w / 2;
  const hd = d / 2;
  p.box('frame', [-hw + 0.1, 0, -hd + 0.1], [hw - 0.1, 0.1, hd - 0.1]);
  p.box('oak', [-hw, 0.1, -hd], [hw, 0.25, hd]);
  p.soft('fabric', [-hw + 0.05, 0.25, -hd + 0.06], [hw - 0.05, 0.47, hd - 0.04], 0.05, LINEN);
  p.soft('fabric', [-hw + 0.02, 0.4, -hd + 0.75], [hw - 0.02, 0.5, hd - 0.02], 0.04, DUVET);
  p.soft('fabric', [-hw + 0.02, 0.44, hd - 0.42], [hw - 0.02, 0.52, hd - 0.02], 0.035, 0xd8d1c4);
  for (const s of [-1, 1]) p.soft('fabric', [s > 0 ? 0.05 : -hw + 0.12, 0.47, -hd + 0.12], [s > 0 ? hw - 0.12 : -0.05, 0.62, -hd + 0.55], 0.07, LINEN, -0.3);
  p.soft('fabric', [-hw, 0.25, -hd - 0.02], [hw, 1.05, -hd + 0.08], 0.03, SAND);
}

function nightstand(p: Pieces, f: FurnitureDef, lamps: Array<[number, number, number]>) {
  const [w, h, d] = f.size;
  p.box('oak', [-w / 2, 0.06, -d / 2], [w / 2, h, d / 2]);
  p.box('frame', [-w / 2 + 0.03, 0, -d / 2 + 0.03], [w / 2 - 0.03, 0.06, d / 2 - 0.03]);
  p.box('frame', [-w / 2 + 0.03, h - 0.15, d / 2 - 0.002], [w / 2 - 0.03, h - 0.142, d / 2 + 0.002]);
  p.cyl('ceramic', 0.06, -0.05, h, h + 0.22, 0.06, 0.045, 16);
  p.cyl('shade', 0.06, -0.05, h + 0.2, h + 0.38, 0.13, 0.1, 24);
  const c = Math.cos(f.rotationY);
  const s = Math.sin(f.rotationY);
  lamps.push([f.position[0] + 0.06 * c - 0.05 * s, f.position[1] + h + 0.3, f.position[2] - 0.06 * s - 0.05 * c]);
}

function bathtub(p: Pieces, f: FurnitureDef) {
  const [w, h, d] = f.size;
  p.soft('ceramic', [-w / 2, 0, -d / 2], [w / 2, h, d / 2], 0.12);
  p.soft('stone', [-w / 2 + 0.07, h - 0.08, -d / 2 + 0.07], [w / 2 - 0.07, h - 0.005, d / 2 - 0.07], 0.08);
  p.tube('steel', [0, 0, -d / 2 - 0.12], [0, h + 0.25, -d / 2 - 0.12], 0.02);
  p.tube('steel', [0, h + 0.25, -d / 2 - 0.12], [0, h + 0.2, -d / 2 + 0.08], 0.016);
}

function outdoorSofa(p: Pieces, f: FurnitureDef) {
  const [w, , d] = f.size;
  const hw = w / 2;
  const hd = d / 2;
  // Teak frame: rails, legs and slatted arms.
  p.box('teak', [-hw, 0.08, -hd], [hw, 0.2, hd]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box('teak', [sx * hw - (sx > 0 ? 0.07 : 0), 0, sz * hd - (sz > 0 ? 0.07 : 0)], [sx * hw + (sx < 0 ? 0.07 : 0), 0.08, sz * hd + (sz < 0 ? 0.07 : 0)]);
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? -hw : hw - 0.1;
    for (let k = 0; k < 4; k++) p.box('teak', [x0, 0.2 + k * 0.1, -hd], [x0 + 0.1, 0.26 + k * 0.1, hd]);
  }
  p.box('teak', [-hw, 0.2, -hd], [hw, 0.62, -hd + 0.06]);
  const n = Math.max(2, Math.round((w - 0.2) / 0.85));
  const cw = (w - 0.2) / n;
  for (let i = 0; i < n; i++) {
    const x0 = -hw + 0.1 + i * cw;
    p.soft('fabric', [x0 + 0.01, 0.2, -hd + 0.06], [x0 + cw - 0.01, 0.38, hd - 0.02], 0.05, OUTDOOR);
    p.soft('fabric', [x0 + 0.02, 0.36, -hd + 0.06], [x0 + cw - 0.02, 0.76, -hd + 0.24], 0.07, OUTDOOR, -0.15);
  }
}

function firepit(p: Pieces, f: FurnitureDef) {
  const r = f.size[0] / 2;
  const h = f.size[1];
  p.cyl('stone', 0, 0, 0, h - 0.06, r - 0.04, r, 40);
  p.cyl('frame', 0, 0, h - 0.06, h, r, r, 40);
  p.cyl('ember', 0, 0, h - 0.06, h + 0.004, r - 0.14, r - 0.14, 32);
}

function sunLounger(p: Pieces, f: FurnitureDef) {
  const [w, , d] = f.size;
  const hw = w / 2;
  const hd = d / 2;
  for (const s of [-1, 1]) p.box('teak', [s * hw - (s > 0 ? 0.05 : 0), 0.06, -hd], [s * hw + (s < 0 ? 0.05 : 0), 0.3, hd]);
  for (const z of [-hd + 0.1, hd - 0.1]) for (const s of [-1, 1]) p.box('teak', [s * hw - (s > 0 ? 0.06 : 0), 0, z - 0.03], [s * hw + (s < 0 ? 0.06 : 0), 0.06, z + 0.03]);
  for (let z = -hd + 0.45; z < hd - 0.05; z += 0.09) p.box('teak', [-hw + 0.05, 0.27, z], [hw - 0.05, 0.3, z + 0.065]);
  p.soft('fabric', [-hw + 0.05, 0.3, -hd + 0.45], [hw - 0.05, 0.36, hd - 0.04], 0.025, 0xf1ede4);
  // Raised backrest at the head (local -z).
  const g = new RoundedBoxGeometry(w - 0.1, 0.06, 0.62, 2, 0.025);
  g.rotateX(-0.75);
  g.translate(0, 0.52, -hd + 0.22);
  p.add('fabric', g, 0xf1ede4);
  p.box('teak', [-hw + 0.05, 0.3, -hd], [hw - 0.05, 0.33, -hd + 0.45]);
}

function hammockNet(p: Pieces, f: FurnitureDef) {
  const [w, h, d] = f.size;
  const hw = w / 2;
  const hd = d / 2;
  // Posts and spreader bars at both ends.
  for (const s of [-1, 1]) {
    const x = s * (hw + 0.05);
    for (const z of [-hd, hd]) p.tube('steel', [x, 0, z], [x, h + 0.5, z], 0.035);
    p.tube('steel', [x, h + 0.02, -hd], [x, h + 0.02, hd], 0.03);
  }
  // Sagging net: a grid lowered towards the middle.
  const g = new PlaneGeometry(w, d, 32, 8);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / hw;
    const v = pos.getZ(i) / hd;
    pos.setY(i, h + 0.02 - 0.13 * (1 - u * u) * (1 - 0.6 * v * v));
  }
  g.computeVertexNormals();
  p.add('net', g);
  // Edge ropes along the long sides.
  const N = 16;
  for (const z of [-hd, hd]) {
    for (let i = 0; i < N; i++) {
      const u0 = -1 + (2 * i) / N;
      const u1 = -1 + (2 * (i + 1)) / N;
      const y = (u: number) => h + 0.02 - 0.13 * (1 - u * u) * 0.4;
      p.add('rope', tubeGeometry([u0 * hw, y(u0), z], [u1 * hw, y(u1), z], 0.018, 6), 0xe9e3d6);
    }
  }
}

/** Knotted rope net: square mesh cut out with alpha testing. */
function netMaterial() {
  const m = new MeshStandardNodeMaterial({ side: DoubleSide });
  const t = uv().mul(vec2(90, 14));
  const cell = abs(fract(t).sub(0.5));
  const rope = smoothstep(0.38, 0.46, max(cell.x, cell.y));
  m.opacityNode = rope;
  m.alphaTest = 0.5;
  m.colorNode = color(0xe6dfd0);
  m.roughnessNode = float(0.95);
  return m;
}

function emberMaterial() {
  const m = new MeshStandardNodeMaterial({ color: 0x1a1512, roughness: 0.9 });
  const n = mx_noise_float(vec3(positionWorld.x.mul(9), positionWorld.z.mul(9), U.time.mul(0.6))).mul(0.5).add(0.5);
  m.emissiveNode = color(0xff5a14).mul(smoothstep(0.45, 0.9, n)).mul(3);
  return m;
}

/** Flames: crossed quads with a scrolling noise mask, additive. */
function flames(x: number, y: number, z: number) {
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide, blending: AdditiveBlending });
  m.fog = false;
  const q = uv();
  const rise = q.y;
  const n = mx_noise_float(vec3(q.x.mul(4), q.y.mul(3).sub(U.time.mul(2.2)), U.time.mul(0.4))).mul(0.5).add(0.5);
  const sway = sin(U.time.mul(3).add(q.y.mul(4))).mul(0.06).mul(rise);
  const body = smoothstep(0.5, 0.05, abs(q.x.sub(0.5).add(sway)).mul(float(1.6).add(rise.mul(1.8))));
  const shape = body.mul(smoothstep(1, 0.25, rise)).mul(smoothstep(0.0, 0.08, rise));
  const intensity = shape.mul(n.mul(1.4)).mul(smoothstep(0.15, 0.6, shape.add(n.mul(0.3))));
  m.colorNode = color(0xff8a2a).mul(intensity.mul(2.4)).add(color(0xffd27a).mul(intensity.mul(intensity).mul(2)));
  m.opacityNode = intensity;
  const group = new Group();
  for (let k = 0; k < 3; k++) {
    const g = new PlaneGeometry(0.75, 0.75);
    g.translate(0, 0.375, 0);
    const mesh = new Mesh(g, m);
    mesh.rotation.y = (k / 3) * Math.PI;
    mesh.position.set(x, y, z);
    mesh.renderOrder = 20;
    group.add(mesh);
  }
  return group;
}

export interface Furniture {
  group: Group;
  /** Flames and lamps: hidden while the interior light probes bake. */
  dynamic: Group[];
  update(time: number): void;
}

export function buildFurniture(layout: Layout, materials: MaterialSet): Furniture {
  const group = new Group();
  group.name = 'furniture';
  const all = new Map<Bin, BufferGeometry[]>();
  const lamps: Array<[number, number, number]> = [];
  const fires: Array<[number, number, number]> = [];
  for (const f of layout.furniture) {
    const p = new Pieces(f);
    switch (f.kind) {
      case 'sofa':
        sofa(p, f);
        break;
      case 'coffee-table':
        coffeeTable(p, f);
        break;
      case 'rug':
        rug(p, f);
        break;
      case 'dining-table':
        diningTable(p, f);
        break;
      case 'dining-chair':
        diningChair(p, f);
        break;
      case 'kitchen-island':
        kitchenIsland(p, f);
        break;
      case 'kitchen-counter':
        kitchenCounter(p, f);
        break;
      case 'bar-stool':
        barStool(p, f);
        break;
      case 'bed':
        bed(p, f);
        break;
      case 'nightstand':
        nightstand(p, f, lamps);
        break;
      case 'bathtub':
        bathtub(p, f);
        break;
      case 'outdoor-sofa':
        outdoorSofa(p, f);
        break;
      case 'firepit':
        firepit(p, f);
        fires.push([f.position[0], f.position[1] + f.size[1], f.position[2]]);
        break;
      case 'sun-lounger':
        sunLounger(p, f);
        break;
      case 'hammock-net':
        hammockNet(p, f);
        break;
    }
    for (const [bin, list] of p.geos) all.set(bin, [...(all.get(bin) ?? []), ...list]);
  }

  const shade = new MeshStandardNodeMaterial({ color: 0xf3ead8, roughness: 0.9, side: DoubleSide });
  shade.emissiveNode = color(0xffd29a).mul(U.nightLights.mul(2.5));
  const mats: Record<Bin, Material> = {
    fabric: materials.fabric,
    oak: materials.oak,
    stone: materials.stone,
    teak: materials.teak,
    frame: materials.mullion,
    steel: materials.steelGrey,
    ceramic: new MeshStandardNodeMaterial({ color: 0xf4f2ee, roughness: 0.18 }),
    net: netMaterial(),
    rope: materials.fabric,
    ember: emberMaterial(),
    shade,
  };
  for (const [bin, list] of all) {
    const merged = mergeGeometries(list, false);
    if (!merged) {
      console.warn(`furniture: could not merge ${bin}`);
      continue;
    }
    const mesh = new Mesh(merged, mats[bin]);
    mesh.name = `furniture-${bin}`;
    mesh.castShadow = bin !== 'net' && bin !== 'shade';
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Bedside lamps and the fire light the place up at night.
  const lights: PointLight[] = [];
  for (const [x, y, z] of lamps) {
    const l = new PointLight(0xffc98a, 0, 4.5, 2);
    l.position.set(x, y, z);
    group.add(l);
    lights.push(l);
  }
  const fireLights: PointLight[] = [];
  const dynamic: Group[] = [];
  for (const [x, y, z] of fires) {
    const f = flames(x, y - 0.02, z);
    dynamic.push(f);
    group.add(f);
    const l = new PointLight(0xff8a3c, 0, 9, 2);
    l.position.set(x, y + 0.5, z);
    group.add(l);
    fireLights.push(l);
  }
  return {
    group,
    dynamic,
    update(time) {
      const night = U.nightLights.value;
      for (const l of lights) l.intensity = 3.5 * night;
      const flicker = 0.75 + 0.25 * Math.sin(time * 13.7) * Math.sin(time * 7.3 + 1) + 0.1 * Math.sin(time * 31);
      for (const l of fireLights) l.intensity = (2 + 18 * night) * flicker;
    },
  };
}
