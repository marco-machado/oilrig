import type * as RAPIER from '@dimforge/rapier3d-compat';
import type RAPIER_DEFAULT from '@dimforge/rapier3d-compat';
import type { DoorDef, Element, Layout, Surface, Vec3 } from '../layout/types.ts';

export type Rapier = typeof RAPIER_DEFAULT;

export interface ColliderInfo {
  elementId: string;
  kind: string;
  surface?: Surface;
  doorId?: string;
}

export interface StaticWorld {
  R: Rapier;
  world: RAPIER.World;
  info: Map<number, ColliderInfo>;
  doors: Map<string, RAPIER.Collider>;
  setDoorOpen(id: string, open: boolean): void;
  isDoorOpen(id: string): boolean;
}

/** Quaternion rotating +Y onto the unit vector d. */
function quatFromUp(d: Vec3): { x: number; y: number; z: number; w: number } {
  const [x, y, z] = d;
  if (y < -0.999999) return { x: 1, y: 0, z: 0, w: 0 };
  // axis = up × d = (z, 0, -x); angle via half-vector trick
  const w = 1 + y;
  const q = { x: z, y: 0, z: -x, w };
  const n = Math.hypot(q.x, q.y, q.z, q.w);
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

function quatFromYaw(angle: number) {
  return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
}

function descsFor(R: Rapier, el: Element): RAPIER.ColliderDesc[] {
  switch (el.type) {
    case 'tube': {
      const d: Vec3 = [el.b[0] - el.a[0], el.b[1] - el.a[1], el.b[2] - el.a[2]];
      const len = Math.hypot(d[0], d[1], d[2]);
      const u: Vec3 = [d[0] / len, d[1] / len, d[2] / len];
      return [
        R.ColliderDesc.cylinder(len / 2, el.radius)
          .setTranslation((el.a[0] + el.b[0]) / 2, (el.a[1] + el.b[1]) / 2, (el.a[2] + el.b[2]) / 2)
          .setRotation(quatFromUp(u)),
      ];
    }
    case 'box': {
      const desc = R.ColliderDesc.cuboid(el.size[0] / 2, el.size[1] / 2, el.size[2] / 2).setTranslation(...el.center);
      if (el.rotation) desc.setRotation({ x: el.rotation[0], y: el.rotation[1], z: el.rotation[2], w: el.rotation[3] });
      return [desc];
    }
    case 'ibeam': {
      const dx = el.b[0] - el.a[0];
      const dz = el.b[2] - el.a[2];
      const len = Math.hypot(dx, dz);
      return [
        R.ColliderDesc.cuboid(len / 2, el.depth / 2, el.width / 2)
          .setTranslation((el.a[0] + el.b[0]) / 2, (el.a[1] + el.b[1]) / 2, (el.a[2] + el.b[2]) / 2)
          .setRotation(quatFromYaw(-Math.atan2(dz, dx))),
      ];
    }
    case 'hull': {
      const pts = new Float32Array(el.points.flat());
      const desc = R.ColliderDesc.convexHull(pts);
      return desc ? [desc] : [];
    }
    case 'rail': {
      const out: RAPIER.ColliderDesc[] = [];
      for (let i = 0; i < el.points.length - 1; i++) {
        const p = el.points[i];
        const q = el.points[i + 1];
        if (Math.abs(p[1] - q[1]) > 0.01) continue; // sloped rails are covered by stair walls
        const dx = q[0] - p[0];
        const dz = q[2] - p[2];
        const len = Math.hypot(dx, dz);
        if (len < 1e-3) continue;
        const h = el.height + 0.3;
        out.push(
          R.ColliderDesc.cuboid(len / 2 + 0.05, h / 2, 0.05)
            .setTranslation((p[0] + q[0]) / 2, p[1] + h / 2, (p[2] + q[2]) / 2)
            .setRotation(quatFromYaw(-Math.atan2(dz, dx))),
        );
      }
      return out;
    }
    case 'stair':
      return [];
  }
}

function doorDesc(R: Rapier, d: DoorDef) {
  return R.ColliderDesc.cuboid(d.size[0] / 2, d.size[1] / 2, d.size[2] / 2).setTranslation(...d.center);
}

/** Creates a Rapier world containing every static collider of the layout plus the doors. */
export function buildStaticWorld(R: Rapier, layout: Layout, openDoors: Record<string, boolean> = {}): StaticWorld {
  const world = new R.World({ x: 0, y: 0, z: 0 });
  const info = new Map<number, ColliderInfo>();
  for (const el of layout.elements) {
    if (!el.collide) continue;
    for (const desc of descsFor(R, el)) {
      const c = world.createCollider(desc);
      info.set(c.handle, { elementId: el.id, kind: el.kind, surface: el.surface });
    }
  }
  const doors = new Map<string, RAPIER.Collider>();
  for (const d of layout.doors) {
    const c = world.createCollider(doorDesc(R, d));
    c.setEnabled(!openDoors[d.id]);
    info.set(c.handle, { elementId: d.id, kind: 'door', surface: 'stone', doorId: d.id });
    doors.set(d.id, c);
  }
  world.step();
  return {
    R,
    world,
    info,
    doors,
    setDoorOpen(id, open) {
      const c = doors.get(id);
      if (!c) return;
      c.setEnabled(!open);
      world.step();
    },
    isDoorOpen(id) {
      const c = doors.get(id);
      return c ? !c.isEnabled() : false;
    },
  };
}
