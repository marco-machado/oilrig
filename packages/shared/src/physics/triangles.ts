import type * as RAPIER from '@dimforge/rapier3d-compat';
import type { ColliderInfo, StaticWorld } from './colliders.ts';

export interface TriangleSoup {
  positions: number[];
  indices: number[];
}

type V = [number, number, number];

function rotate(q: { x: number; y: number; z: number; w: number }, v: V): V {
  // t = 2 (q.xyz × v);  v' = v + w t + q.xyz × t
  const tx = 2 * (q.y * v[2] - q.z * v[1]);
  const ty = 2 * (q.z * v[0] - q.x * v[2]);
  const tz = 2 * (q.x * v[1] - q.y * v[0]);
  return [
    v[0] + q.w * tx + (q.y * tz - q.z * ty),
    v[1] + q.w * ty + (q.z * tx - q.x * tz),
    v[2] + q.w * tz + (q.x * ty - q.y * tx),
  ];
}

/** Faces of the convex hull of a small point set, wound counter-clockwise seen from outside. */
export function hullTriangles(points: V[]): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const n = points.length;
  const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const nrm = cross(sub(points[j], points[i]), sub(points[k], points[i]));
        const len = Math.hypot(...nrm);
        if (len < 1e-9) continue;
        let pos = 0;
        let neg = 0;
        for (let m = 0; m < n; m++) {
          if (m === i || m === j || m === k) continue;
          const d = dot(nrm, sub(points[m], points[i])) / len;
          if (d > 1e-6) pos++;
          else if (d < -1e-6) neg++;
        }
        if (pos && neg) continue;
        // Every other point is behind the face: keep it, outward-facing.
        out.push(pos ? [i, k, j] : [i, j, k]);
      }
    }
  }
  return out;
}

const BOX_FACES: Array<[number, number, number]> = [
  [0, 2, 1], [0, 3, 2], // -z
  [4, 5, 6], [4, 6, 7], // +z
  [0, 1, 5], [0, 5, 4], // -y
  [3, 7, 6], [3, 6, 2], // +y
  [0, 4, 7], [0, 7, 3], // -x
  [1, 2, 6], [1, 6, 5], // +x
];

/**
 * Triangulates the static colliders of a physics world: exactly the surfaces the character
 * controller walks on and bumps into. Used to build the agents' navmesh.
 */
export function staticTriangles(sw: StaticWorld, include: (info: ColliderInfo, c: RAPIER.Collider) => boolean): TriangleSoup {
  const positions: number[] = [];
  const indices: number[] = [];
  const { R } = sw;
  const emit = (verts: V[], tris: Array<[number, number, number]>, c: RAPIER.Collider) => {
    const t = c.translation();
    const q = c.rotation();
    const base = positions.length / 3;
    for (const v of verts) {
      const r = rotate(q, v);
      positions.push(r[0] + t.x, r[1] + t.y, r[2] + t.z);
    }
    for (const [a, b, d] of tris) indices.push(base + a, base + b, base + d);
  };
  sw.world.forEachCollider((c) => {
    const info = sw.info.get(c.handle);
    if (!info || !c.isEnabled() || !include(info, c)) return;
    const shape = c.shape as RAPIER.Shape & Record<string, unknown>;
    switch (shape.type) {
      case R.ShapeType.Cuboid: {
        const h = (shape as unknown as RAPIER.Cuboid).halfExtents;
        const verts: V[] = [];
        for (const [x, y, z] of [
          [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
          [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
        ]) verts.push([x * h.x, y * h.y, z * h.z]);
        emit(verts, BOX_FACES, c);
        break;
      }
      case R.ShapeType.Cylinder: {
        const cyl = shape as unknown as RAPIER.Cylinder;
        const seg = 16;
        const verts: V[] = [];
        for (let i = 0; i < seg; i++) {
          const a = (i / seg) * Math.PI * 2;
          const x = Math.cos(a) * cyl.radius;
          const z = Math.sin(a) * cyl.radius;
          verts.push([x, -cyl.halfHeight, z], [x, cyl.halfHeight, z]);
        }
        verts.push([0, -cyl.halfHeight, 0], [0, cyl.halfHeight, 0]);
        const bot = seg * 2;
        const top = seg * 2 + 1;
        const tris: Array<[number, number, number]> = [];
        for (let i = 0; i < seg; i++) {
          const j = (i + 1) % seg;
          const b0 = i * 2, t0 = i * 2 + 1, b1 = j * 2, t1 = j * 2 + 1;
          tris.push([b0, t0, t1], [b0, t1, b1], [top, t1, t0], [bot, b0, b1]);
        }
        emit(verts, tris, c);
        break;
      }
      case R.ShapeType.ConvexPolyhedron: {
        const v = (shape as unknown as RAPIER.ConvexPolyhedron).vertices;
        const verts: V[] = [];
        for (let i = 0; i < v.length; i += 3) verts.push([v[i], v[i + 1], v[i + 2]]);
        emit(verts, hullTriangles(verts), c);
        break;
      }
      default:
        break;
    }
  });
  return { positions, indices };
}
