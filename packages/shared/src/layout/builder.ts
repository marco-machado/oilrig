import type {
  BoxElement,
  DoorDef,
  Element,
  FurnitureDef,
  LightDef,
  MaterialId,
  PlaceDef,
  PropDef,
  Quat,
  Rect,
  Surface,
  Vec3,
  VesselDef,
  ZoneDef,
} from './types.ts';

const normalize3 = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

interface Opts {
  collide?: boolean;
  render?: boolean;
  surface?: Surface;
  object?: string;
}

/** Subtracts axis-aligned holes from a rectangle, returning disjoint rectangles. */
export function subtractRects(outer: Rect, holes: Rect[]): Rect[] {
  const clipped = holes
    .map((h) => ({
      x0: Math.max(h.x0, outer.x0),
      x1: Math.min(h.x1, outer.x1),
      z0: Math.max(h.z0, outer.z0),
      z1: Math.min(h.z1, outer.z1),
    }))
    .filter((h) => h.x1 > h.x0 && h.z1 > h.z0);
  const xs = [...new Set([outer.x0, outer.x1, ...clipped.flatMap((h) => [h.x0, h.x1])])].sort(
    (a, b) => a - b,
  );
  const out: Rect[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i];
    const x1 = xs[i + 1];
    const mid = (x0 + x1) / 2;
    const blocks = clipped
      .filter((h) => h.x0 <= mid && h.x1 >= mid)
      .map((h) => [h.z0, h.z1] as const)
      .sort((a, b) => a[0] - b[0]);
    let z = outer.z0;
    for (const [b0, b1] of blocks) {
      if (b0 > z) out.push({ x0, x1, z0: z, z1: b0 });
      z = Math.max(z, b1);
    }
    if (z < outer.z1) out.push({ x0, x1, z0: z, z1: outer.z1 });
  }
  // Merge vertically adjacent strips with identical z spans to keep the count low.
  const merged: Rect[] = [];
  for (const r of out) {
    const prev = merged.find(
      (m) => Math.abs(m.x1 - r.x0) < 1e-9 && Math.abs(m.z0 - r.z0) < 1e-9 && Math.abs(m.z1 - r.z1) < 1e-9,
    );
    if (prev) prev.x1 = r.x1;
    else merged.push({ ...r });
  }
  return merged;
}

export function rectsOverlap(a: Rect, b: Rect, pad = 0): boolean {
  return a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.z0 < b.z1 + pad && a.z1 > b.z0 - pad;
}

export class LayoutBuilder {
  readonly elements: Element[] = [];
  readonly doors: DoorDef[] = [];
  readonly zones: ZoneDef[] = [];
  readonly lights: LightDef[] = [];
  readonly places: PlaceDef[] = [];
  readonly props: PropDef[] = [];
  readonly furniture: FurnitureDef[] = [];
  readonly vessels: VesselDef[] = [];
  private counter = 0;

  nextId(kind: string): string {
    this.counter += 1;
    return `${kind}-${this.counter}`;
  }

  tube(kind: string, a: Vec3, b: Vec3, radius: number, material: MaterialId = 'steelYellow', o: Opts = {}) {
    this.elements.push({
      type: 'tube',
      id: this.nextId(kind),
      kind,
      a,
      b,
      radius,
      material,
      collide: o.collide ?? false,
      render: o.render ?? true,
      surface: o.surface,
      ...(o.object ? { object: o.object } : {}),
    });
  }

  box(kind: string, center: Vec3, size: Vec3, material: MaterialId, o: Opts & { rotation?: Quat } = {}) {
    const el: BoxElement = {
      type: 'box',
      id: this.nextId(kind),
      kind,
      center,
      size,
      material,
      collide: o.collide ?? true,
      render: o.render ?? true,
      surface: o.surface,
    };
    if (o.object) el.object = o.object;
    if (o.rotation) el.rotation = o.rotation;
    this.elements.push(el);
    return el;
  }

  /** Axis-aligned box from min/max corners. */
  boxMinMax(kind: string, min: Vec3, max: Vec3, material: MaterialId, o: Opts = {}) {
    return this.box(
      kind,
      [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
      [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
      material,
      o,
    );
  }

  /** A slab covering `rect` minus `holes`, with its top at `top`. */
  slab(kind: string, rect: Rect, holes: Rect[], top: number, thickness: number, material: MaterialId, o: Opts = {}) {
    for (const r of subtractRects(rect, holes)) {
      this.boxMinMax(kind, [r.x0, top - thickness, r.z0], [r.x1, top, r.z1], material, o);
    }
  }

  beam(kind: string, a: Vec3, b: Vec3, depth: number, width: number, material: MaterialId = 'steelYellow', o: Opts = {}) {
    this.elements.push({
      type: 'ibeam',
      id: this.nextId(kind),
      kind,
      a,
      b,
      depth,
      width,
      material,
      collide: o.collide ?? false,
      render: o.render ?? true,
    });
  }

  /**
   * Stair flight. Adds a solid wedge collider under the walking line so nothing can be
   * walked under it, and renders treads + stringers.
   */
  stair(kind: string, bottom: Vec3, top: Vec3, width: number, risers: number, material: MaterialId = 'grating') {
    this.elements.push({
      type: 'stair',
      id: this.nextId(kind),
      kind,
      bottom,
      top,
      width,
      risers,
      material,
      collide: false,
      render: true,
      surface: material === 'grating' ? 'grating' : 'metal',
    });
    this.ramp(`${kind}-ramp`, bottom, top, width, material === 'grating' ? 'grating' : 'metal');
  }

  /**
   * Invisible solid wedge whose top surface runs from `bottom` to `top`. Rapier's
   * character controller cannot autostep a capsule over steps much taller than
   * ~0.1 m, so anything stepped (stairs, pool steps) walks on one of these.
   */
  ramp(kind: string, bottom: Vec3, top: Vec3, width: number, surface: Surface) {
    const dx = top[0] - bottom[0];
    const dz = top[2] - bottom[2];
    const len = Math.hypot(dx, dz);
    const sx = (-dz / len) * (width / 2);
    const sz = (dx / len) * (width / 2);
    const floor = bottom[1] - 0.05;
    this.elements.push({
      type: 'hull',
      id: this.nextId(kind),
      kind,
      material: 'steelGrey',
      collide: true,
      render: false,
      surface,
      points: [
        [bottom[0] + sx, bottom[1], bottom[2] + sz],
        [bottom[0] - sx, bottom[1], bottom[2] - sz],
        [top[0] + sx, top[1], top[2] + sz],
        [top[0] - sx, top[1], top[2] - sz],
        [top[0] + sx, floor, top[2] + sz],
        [top[0] - sx, floor, top[2] - sz],
        [bottom[0] + sx, floor, bottom[2] + sz],
        [bottom[0] - sx, floor, bottom[2] - sz],
      ],
    });
  }

  /** Visible handrail along a polyline; collider is a set of tall thin walls. */
  rail(kind: string, points: Vec3[], o: { height?: number; collide?: boolean; material?: MaterialId } = {}) {
    this.elements.push({
      type: 'rail',
      id: this.nextId(kind),
      kind,
      points,
      height: o.height ?? 1.1,
      material: o.material ?? 'steelYellow',
      collide: o.collide ?? true,
      render: true,
    });
  }

  prop(kind: PropDef['kind'], position: Vec3, extra: { size?: Vec3; rotationY?: number } = {}) {
    this.props.push({ id: this.nextId(kind), kind, position, ...extra });
  }

  /** Invisible blocking wall between two points (vertical, given bottom/top). */
  wall(kind: string, a: [number, number], b: [number, number], y0: number, y1: number, thickness = 0.1) {
    const cx = (a[0] + b[0]) / 2;
    const cz = (a[1] + b[1]) / 2;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    this.box(kind, [cx, (y0 + y1) / 2, cz], [len, y1 - y0, thickness], 'steelGrey', {
      render: false,
      collide: true,
      rotation: quatY(-angle),
    });
  }

  light(kind: LightDef['kind'], position: Vec3, color: number, intensity: number, distance: number, casts = true, beam?: { aim: Vec3; cone: number }) {
    const aim = beam && normalize3(beam.aim);
    this.lights.push({ id: this.nextId(kind), kind, position, color, intensity, distance, casts, ...(aim ? { aim, cone: beam.cone } : {}) });
  }

  /**
   * Records a piece of furniture and gives it box colliders. Each collider is
   * [local x, local z, width, depth, bottom, top] relative to the footprint centre and floor.
   */
  addFurniture(def: FurnitureDef, colliders: Array<[number, number, number, number, number, number]>, surface: Surface = 'wood') {
    this.furniture.push(def);
    const c = Math.cos(def.rotationY);
    const s = Math.sin(def.rotationY);
    const [px, py, pz] = def.position;
    for (const [lx, lz, w, d, y0, y1] of colliders) {
      // Rotation about +y: local (x, z) -> (x cos + z sin, -x sin + z cos).
      const wx = px + lx * c + lz * s;
      const wz = pz - lx * s + lz * c;
      this.box(def.kind, [wx, py + (y0 + y1) / 2, wz], [w, y1 - y0, d], 'steelGrey', {
        render: false,
        collide: true,
        surface,
        object: def.id,
        rotation: quatY(def.rotationY),
      });
    }
  }

  vessel(def: VesselDef) {
    this.vessels.push(def);
  }

  zone(id: string, kind: ZoneDef['kind'], min: Vec3, max: Vec3) {
    this.zones.push({ id, kind, min, max });
  }

  place(id: string, name: string, position: Vec3) {
    this.places.push({ id, name, position });
  }

  door(def: DoorDef) {
    this.doors.push(def);
  }
}

export function quatY(angle: number): Quat {
  return [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
}
