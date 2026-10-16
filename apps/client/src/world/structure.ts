import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
} from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BoxElement, Element, Layout, MaterialId, RailElement, StairElement, Vec3 } from '@ocean-home/shared';
import type { MaterialSet } from './materials/index.ts';

const UP = new Vector3(0, 1, 0);
const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpV = new Vector3();
const tmpS = new Vector3(1, 1, 1);

class GeometryBins {
  private readonly bins = new Map<MaterialId, BufferGeometry[]>();
  add(material: MaterialId, g: BufferGeometry) {
    const list = this.bins.get(material) ?? [];
    list.push(g);
    this.bins.set(material, list);
  }
  build(materials: MaterialSet, opts: { castShadow: (m: MaterialId) => boolean }): Group {
    const group = new Group();
    for (const [id, list] of this.bins) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new Mesh(merged, materials[id]);
      mesh.name = `structure-${id}`;
      mesh.castShadow = opts.castShadow(id);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }
}

function segmentsFor(radius: number) {
  if (radius >= 1) return 48;
  if (radius >= 0.3) return 28;
  if (radius >= 0.1) return 14;
  return 8;
}

export function tubeGeometry(a: Vec3, b: Vec3, radius: number, segments = segmentsFor(radius)): BufferGeometry {
  const va = new Vector3(...a);
  const vb = new Vector3(...b);
  const dir = vb.clone().sub(va);
  const len = dir.length();
  const g = new CylinderGeometry(radius, radius, len, segments, 1, false);
  tmpQ.setFromUnitVectors(UP, dir.normalize());
  tmpM.compose(va.add(vb).multiplyScalar(0.5), tmpQ, tmpS);
  g.applyMatrix4(tmpM);
  return g;
}

export function boxGeometry(center: Vec3, size: Vec3, rotation?: BoxElement['rotation']): BufferGeometry {
  const g = new BoxGeometry(size[0], size[1], size[2]);
  if (rotation) tmpQ.set(rotation[0], rotation[1], rotation[2], rotation[3]);
  else tmpQ.identity();
  tmpM.compose(tmpV.set(...center), tmpQ, tmpS);
  g.applyMatrix4(tmpM);
  return g;
}

/** Box spanning a→b (centre line) with the given cross-section; local Y stays vertical. */
function orientedBox(a: Vec3, b: Vec3, height: number, width: number): BufferGeometry {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  const g = new BoxGeometry(len, height, width);
  const yaw = Math.atan2(dz, dx);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));
  tmpQ.setFromAxisAngle(UP, -yaw);
  const qp = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), pitch);
  tmpQ.multiply(qp);
  tmpM.compose(tmpV.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), tmpQ, tmpS);
  g.applyMatrix4(tmpM);
  return g;
}

function ibeam(bins: GeometryBins, el: Extract<Element, { type: 'ibeam' }>) {
  const tf = Math.max(0.03, el.depth * 0.07);
  const tw = Math.max(0.02, el.width * 0.08);
  const up = (v: Vec3, dy: number): Vec3 => [v[0], v[1] + dy, v[2]];
  const off = el.depth / 2 - tf / 2;
  bins.add(el.material, orientedBox(up(el.a, off), up(el.b, off), tf, el.width));
  bins.add(el.material, orientedBox(up(el.a, -off), up(el.b, -off), tf, el.width));
  bins.add(el.material, orientedBox(el.a, el.b, el.depth - 2 * tf, tw));
}

function stair(bins: GeometryBins, el: StairElement) {
  const { bottom, top, width, risers } = el;
  const dx = top[0] - bottom[0];
  const dz = top[2] - bottom[2];
  const run = Math.hypot(dx, dz);
  const ux = dx / run;
  const uz = dz / run;
  const rise = top[1] - bottom[1];
  const going = run / risers;
  const yaw = Math.atan2(dz, dx);
  const rot = new Quaternion().setFromAxisAngle(UP, -yaw);
  for (let i = 0; i < risers; i++) {
    const t = (i + 0.5) / risers;
    const y = bottom[1] + (rise * (i + 1)) / risers - 0.02;
    const g = new BoxGeometry(going + 0.04, 0.04, width - 0.04);
    tmpM.compose(tmpV.set(bottom[0] + ux * run * t, y, bottom[2] + uz * run * t), rot, tmpS);
    g.applyMatrix4(tmpM);
    bins.add(el.material, g);
  }
  // Stringers on both sides.
  const sx = -uz * (width / 2);
  const sz = ux * (width / 2);
  for (const s of [-1, 1]) {
    const a: Vec3 = [bottom[0] + sx * s, bottom[1] - 0.05, bottom[2] + sz * s];
    const b: Vec3 = [top[0] + sx * s, top[1] - 0.05, top[2] + sz * s];
    bins.add('steelYellow', orientedBox(a, b, 0.28, 0.025));
  }
}

function rail(bins: GeometryBins, el: RailElement) {
  const h = el.height;
  const pts = el.points;
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    const len = Math.hypot(q[0] - p[0], q[2] - p[2]);
    if (len < 1e-3) continue;
    const posts = Math.max(1, Math.ceil(len / 1.8));
    for (let k = 0; k <= posts; k++) {
      if (k === 0 && i > 0) continue; // shared corner post
      const t = k / posts;
      const x = p[0] + (q[0] - p[0]) * t;
      const y = p[1] + (q[1] - p[1]) * t;
      const z = p[2] + (q[2] - p[2]) * t;
      bins.add(el.material, tubeGeometry([x, y, z], [x, y + h, z], 0.024, 8));
    }
    bins.add(el.material, tubeGeometry([p[0], p[1] + h, p[2]], [q[0], q[1] + h, q[2]], 0.026, 10));
    bins.add(el.material, tubeGeometry([p[0], p[1] + h * 0.5, p[2]], [q[0], q[1] + h * 0.5, q[2]], 0.018, 8));
    if (Math.abs(p[1] - q[1]) < 0.01) {
      bins.add(el.material, orientedBox([p[0], p[1] + 0.06, p[2]], [q[0], q[1] + 0.06, q[2]], 0.1, 0.008));
    }
  }
}

/** Builds merged meshes (one per material) for every rendered layout element. */
export function buildStructure(layout: Layout, materials: MaterialSet): Group {
  const bins = new GeometryBins();
  for (const el of layout.elements) {
    if (!el.render) continue;
    switch (el.type) {
      case 'tube':
        bins.add(el.material, tubeGeometry(el.a, el.b, el.radius));
        break;
      case 'box':
        bins.add(el.material, boxGeometry(el.center, el.size, el.rotation));
        break;
      case 'ibeam':
        ibeam(bins, el);
        break;
      case 'stair':
        stair(bins, el);
        break;
      case 'rail':
        rail(bins, el);
        break;
      case 'hull':
        break;
    }
  }
  return bins.build(materials, {
    castShadow: (m) => m !== 'glass' && m !== 'glassFrosted' && m !== 'net',
  });
}
