import { BoxGeometry, type BufferGeometry, Group, Mesh, MeshStandardNodeMaterial } from 'three/webgpu';
import { color, fract, positionLocal, smoothstep, uniform, vec2 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DoorDef, Layout, StaticWorld } from '@oilrig/shared';
import { U } from '../state.ts';
import type { MaterialSet } from './materials/index.ts';
import { tubeGeometry } from './structure.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface DoorView {
  def: DoorDef;
  group: Group;
  open: boolean;
  t: number;
  /** 0..1 glow while the crosshair rests on the door. */
  focus: ReturnType<typeof uniform>;
}

/** Bronze frame that warms up when looked at, so a door reads as a door. */
function frameMaterial(focus: any) {
  const m = new MeshStandardNodeMaterial({ color: 0x8c6a43, metalness: 0.85, roughness: 0.32 });
  m.emissiveNode = color(0xffb35c).mul(focus.mul(1.6));
  return m;
}

/** Etched dot band on the glass (the safety marking real glass doors carry at eye level). */
function etchMaterial(alongX: boolean) {
  const m = new MeshStandardNodeMaterial({ color: 0xeef2f2, roughness: 0.6, metalness: 0 });
  const u = alongX ? positionLocal.x : positionLocal.z;
  const cell = fract(vec2(u, positionLocal.y).div(0.022)).sub(0.5);
  m.opacityNode = smoothstep(0.36, 0.3, cell.length());
  m.alphaTest = 0.5;
  return m;
}

/** Sliding glass doors: animated meshes plus the matching collider toggle. */
export class Doors {
  readonly group = new Group();
  private readonly views = new Map<string, DoorView>();
  private readonly sw: Pick<StaticWorld, 'setDoorOpen'>;
  private focused: string | null = null;
  /** Called when a door starts to move (for its sound). */
  onMove: ((def: DoorDef, open: boolean) => void) | null = null;

  constructor(layout: Layout, materials: MaterialSet, sw: Pick<StaticWorld, 'setDoorOpen'>) {
    this.sw = sw;
    this.group.name = 'doors';
    const header = new MeshStandardNodeMaterial({ color: 0x1a1b1d, roughness: 0.4 });
    header.emissiveNode = color(0xffe0b0).mul(U.nightLights.mul(7).add(0.8));
    const mat = new MeshStandardNodeMaterial({ color: 0x2f2a25, roughness: 1 });
    const fixtures: { header: BufferGeometry[]; sill: BufferGeometry[]; mat: BufferGeometry[] } = { header: [], sill: [], mat: [] };

    for (const def of layout.doors) {
      const g = new Group();
      const [sx, sy, sz] = def.size;
      const alongX = sx > sz;
      const len = alongX ? sx : sz;
      // Panel-local helpers: u runs along the door, n through it.
      const box = (u0: number, u1: number, y0: number, y1: number, n: number, nOff = 0) => {
        const b = new BoxGeometry(alongX ? u1 - u0 : n, y1 - y0, alongX ? n : u1 - u0);
        b.translate(alongX ? (u0 + u1) / 2 : nOff, (y0 + y1) / 2, alongX ? nOff : (u0 + u1) / 2);
        return b;
      };
      g.add(new Mesh(new BoxGeometry(sx, sy, sz), materials.glass));
      const focus = uniform(0);
      const f = 0.075;
      const h = sy / 2;
      const frame = new Mesh(
        mergeGeometries(
          [
            box(-len / 2, len / 2, h - f, h, 0.09),
            box(-len / 2, len / 2, -h, -h + f, 0.09),
            box(-len / 2, -len / 2 + f, -h, h, 0.09),
            box(len / 2 - f, len / 2, -h, h, 0.09),
          ],
          false,
        )!,
        frameMaterial(focus),
      );
      frame.castShadow = true;
      g.add(frame);
      // Two etched bands at the heights the eye and a child's eye fall on.
      const etch = etchMaterial(alongX);
      for (const y of [-h + 1.0, -h + 1.5]) {
        g.add(new Mesh(box(-len / 2 + f, len / 2 - f, y - 0.06, y + 0.06, (alongX ? sz : sx) + 0.004), etch));
      }
      // Long pull handles on both faces, at the edge that leads the opening.
      const slide = Math.sign(alongX ? def.openOffset[0] : def.openOffset[2]) || 1;
      const hu = -slide * (len / 2 - 0.16);
      const handles: BufferGeometry[] = [];
      for (const side of [-1, 1]) {
        const n = side * 0.075;
        const at = (y: number, off = 0): [number, number, number] => (alongX ? [hu, y, n * (1 - off)] : [n * (1 - off), y, hu]);
        handles.push(tubeGeometry(at(-h + 0.55), at(-h + 1.75), 0.017, 10));
        handles.push(tubeGeometry(at(-h + 0.6, 1), at(-h + 0.6, 0.45), 0.012, 8));
        handles.push(tubeGeometry(at(-h + 1.7, 1), at(-h + 1.7, 0.45), 0.012, 8));
      }
      const handle = new Mesh(mergeGeometries(handles, false)!, frameMaterial(focus));
      handle.castShadow = true;
      g.add(handle);
      g.position.set(...def.center);
      this.group.add(g);
      this.views.set(def.id, { def, group: g, open: false, t: 0, focus });

      // Fixed parts: a lit header strip on both faces, a steel sill, a mat outside.
      const [cx, cy, cz] = def.center;
      const [ox, oz] = def.outward;
      const top = cy + h;
      const floor = cy - h - 0.02;
      const at = (along: number, y: number, out: number, w: number, hh: number, d: number) => {
        const b = alongX ? new BoxGeometry(w, hh, d) : new BoxGeometry(d, hh, w);
        b.translate(cx + (alongX ? along : out * ox), y, cz + (alongX ? out * oz : along));
        return b;
      };
      for (const out of [-0.17, 0.1]) fixtures.header.push(at(0, top - 0.035, out, len + 0.1, 0.035, 0.05));
      fixtures.sill.push(at(0, floor + 0.006, 0, len + 0.2, 0.014, 0.42));
      fixtures.mat.push(at(0, floor - 0.062, 0.95, Math.min(len - 0.3, 1.8), 0.016, 0.9));
    }
    const fixed = (geos: BufferGeometry[], m: MeshStandardNodeMaterial | MaterialSet[keyof MaterialSet], shadow: boolean) => {
      const mesh = new Mesh(mergeGeometries(geos, false)!, m);
      mesh.receiveShadow = true;
      mesh.castShadow = shadow;
      this.group.add(mesh);
    };
    fixed(fixtures.header, header, false);
    fixed(fixtures.sill, materials.steelGrey, false);
    fixed(fixtures.mat, mat, false);
  }

  isOpen(id: string) {
    return this.views.get(id)?.open ?? false;
  }

  setOpen(id: string, open: boolean) {
    const v = this.views.get(id);
    if (!v) return;
    if (v.open !== open) this.onMove?.(v.def, open);
    v.open = open;
    this.sw.setDoorOpen(id, open);
  }

  /** The door the crosshair rests on, if any: it glows a little. */
  setFocus(id: string | null) {
    this.focused = id;
  }

  update(dt: number) {
    for (const [id, v] of this.views) {
      const target = v.open ? 1 : 0;
      v.t += Math.sign(target - v.t) * Math.min(Math.abs(target - v.t), dt / 0.9);
      const e = v.t * v.t * (3 - 2 * v.t);
      const [ox, oy, oz] = v.def.openOffset;
      const [cx, cy, cz] = v.def.center;
      // Slide just outside the fixed glass so the panels do not intersect.
      const out = Math.min(1, v.t * 6) * 0.08;
      const [nx, nz] = v.def.outward;
      v.group.position.set(cx + ox * e + nx * out, cy + oy * e, cz + oz * e + nz * out);
      const f = (v.focus as any).value as number;
      (v.focus as any).value = f + ((this.focused === id ? 1 : 0) - f) * Math.min(1, dt * 10);
    }
  }
}

