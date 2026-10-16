import { BoxGeometry, Group, Mesh } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DoorDef, Layout, StaticWorld } from '@ocean-home/shared';
import type { MaterialSet } from './materials/index.ts';

interface DoorView {
  def: DoorDef;
  group: Group;
  open: boolean;
  t: number;
}

/** Sliding glass doors: animated meshes plus the matching collider toggle. */
export class Doors {
  readonly group = new Group();
  private readonly views = new Map<string, DoorView>();
  private readonly sw: StaticWorld;

  constructor(layout: Layout, materials: MaterialSet, sw: StaticWorld) {
    this.sw = sw;
    for (const def of layout.doors) {
      const g = new Group();
      const [sx, sy, sz] = def.size;
      const glass = new Mesh(new BoxGeometry(sx, sy, sz), materials.glass);
      g.add(glass);
      const f = 0.06;
      const alongX = sx > sz;
      const len = alongX ? sx : sz;
      const frameGeos = [
        new BoxGeometry(alongX ? len : f * 1.4, f, alongX ? f * 1.4 : len).translate(0, sy / 2 - f / 2, 0),
        new BoxGeometry(alongX ? len : f * 1.4, f, alongX ? f * 1.4 : len).translate(0, -sy / 2 + f / 2, 0),
        new BoxGeometry(alongX ? f : f * 1.4, sy, alongX ? f * 1.4 : f).translate(alongX ? len / 2 - f / 2 : 0, 0, alongX ? 0 : len / 2 - f / 2),
        new BoxGeometry(alongX ? f : f * 1.4, sy, alongX ? f * 1.4 : f).translate(alongX ? -len / 2 + f / 2 : 0, 0, alongX ? 0 : -len / 2 + f / 2),
      ];
      const frame = new Mesh(mergeGeometries(frameGeos, false)!, materials.mullion);
      frame.castShadow = true;
      g.add(frame);
      g.position.set(...def.center);
      this.group.add(g);
      this.views.set(def.id, { def, group: g, open: false, t: 0 });
    }
  }

  isOpen(id: string) {
    return this.views.get(id)?.open ?? false;
  }

  setOpen(id: string, open: boolean) {
    const v = this.views.get(id);
    if (!v) return;
    v.open = open;
    this.sw.setDoorOpen(id, open);
  }

  update(dt: number) {
    for (const v of this.views.values()) {
      const target = v.open ? 1 : 0;
      v.t += Math.sign(target - v.t) * Math.min(Math.abs(target - v.t), dt / 0.9);
      const e = v.t * v.t * (3 - 2 * v.t);
      const [ox, oy, oz] = v.def.openOffset;
      const [cx, cy, cz] = v.def.center;
      // Slide just outside the fixed glass so the panels do not intersect.
      const out = Math.min(1, v.t * 6) * 0.08;
      const alongX = v.def.size[0] > v.def.size[2];
      v.group.position.set(cx + ox * e + (alongX ? 0 : out), cy + oy * e, cz + oz * e + (alongX ? out : 0));
    }
  }
}
