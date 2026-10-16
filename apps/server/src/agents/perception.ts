import {
  type ColliderInfo,
  DIMS,
  type Layout,
  PLAYER,
  type Vec3,
  celestialAt,
  gameTime,
} from '@ocean-home/shared';
import type { World } from '../world/world.ts';
import { headingOf } from './agent.ts';

// Structured perception for AI agents. Nothing is rendered: what an agent "sees" is
// worked out from the layout's semantic objects, a field of view and Rapier ray casts
// against the same colliders people bump into. Clear glass does not block sight.

const VIEW_RANGE = 45;
const HALF_FOV = (60 * Math.PI) / 180;
const MAX_OBJECTS = 40;

export interface Perceivable {
  id: string;
  kind: string;
  name: string;
  /** Points that count as seeing the object if any of them is in clear view. */
  points: Vec3[];
  /** Colliders that are part of the object (a ray stopping on them still sees it). */
  owns: (info: ColliderInfo) => boolean;
  range?: number;
}

export interface Viewer {
  id: string;
  position: Vec3;
  yaw: number;
}

export interface SeenObject {
  id: string;
  kind: string;
  name: string;
  distance: number;
  /** Degrees from straight ahead, positive to the right. */
  bearing: number;
  direction: string;
  /** Height of the object's reference point relative to the viewer's feet, metres. */
  heightDelta: number;
  state?: string;
}

export interface SeenAvatar {
  id: string;
  name: string;
  kind: 'human' | 'agent';
  distance: number;
  bearing: number;
  direction: string;
  visible: boolean;
  moving: boolean;
}

export interface Perception {
  self: {
    id: string;
    name: string;
    position: Vec3;
    heading: number;
    facing: string;
    zone: string | null;
    area: { id: string; name: string; distance: number } | null;
    surface: string | null;
    task: string | null;
  };
  time: { local: string; hour: number; daylight: 'day' | 'twilight' | 'night'; sunElevation: number };
  weather: {
    kind: string;
    windSpeedMs: number;
    windFrom: string;
    windFromDeg: number;
    waveHeightM: number;
    rain: number;
    fog: number;
    cloudCover: number;
  };
  visible: SeenObject[];
  avatars: SeenAvatar[];
  drone: { phase: string; visible: boolean; distance: number; bearing: number; direction: string; pilot: string | null; passengers: number } | null;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

/** Bearing in degrees of `to` relative to a viewer at `from` facing `yaw` (positive = right). */
export function relativeBearing(from: Vec3, yaw: number, to: Vec3) {
  const abs = (Math.atan2(to[0] - from[0], -(to[2] - from[2])) * 180) / Math.PI;
  let rel = abs - headingOf(yaw);
  rel = ((rel % 360) + 540) % 360 - 180;
  return rel;
}

export function directionWord(bearing: number) {
  const b = Math.abs(bearing);
  const side = bearing > 0 ? 'right' : 'left';
  if (b <= 22.5) return 'ahead';
  if (b <= 67.5) return `ahead-${side}`;
  if (b <= 112.5) return side;
  if (b <= 157.5) return `behind-${side}`;
  return 'behind';
}

/** The fixed things worth reporting: furniture, doors and landmarks. */
export function perceivables(layout: Layout): Perceivable[] {
  const out: Perceivable[] = [];
  const byObject = (id: string) => (i: ColliderInfo) => i.object === id;
  const byElement = (ids: Set<string>) => (i: ColliderInfo) => ids.has(i.elementId);

  for (const f of layout.furniture) {
    const [x, y, z] = f.position;
    const h = Math.max(f.size[1], 0.05);
    const c = Math.cos(f.rotationY);
    const s = Math.sin(f.rotationY);
    const pts: Vec3[] = [[x, y + h * 0.6, z]];
    for (const [lx, lz] of [
      [-0.4, -0.4],
      [0.4, -0.4],
      [-0.4, 0.4],
      [0.4, 0.4],
    ]) {
      const ox = lx * f.size[0];
      const oz = lz * f.size[2];
      pts.push([x + ox * c + oz * s, y + h * 0.9, z - ox * s + oz * c]);
    }
    out.push({ id: f.id, kind: f.kind, name: f.name, points: pts, owns: byObject(f.id) });
  }
  for (const d of layout.doors) {
    out.push({ id: d.id, kind: 'door', name: d.name, points: [d.center, [d.center[0], d.center[1] - 0.6, d.center[2]]], owns: byObject(d.id) });
  }
  const els = (kind: string) => layout.elements.filter((e) => e.kind === kind);
  const center = (min: Vec3, max: Vec3): Vec3 => [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];

  const stair = (id: string, name: string, kind: string) => {
    const flights = els(kind).filter((e) => e.type === 'stair');
    const ramps = new Set(els(`${kind}-ramp`).map((e) => e.id));
    const pts: Vec3[] = [];
    for (const f of flights) if (f.type === 'stair') pts.push([f.top[0], f.top[1] + 0.3, f.top[2]], [f.bottom[0], f.bottom[1] + 0.3, f.bottom[2]]);
    if (pts.length) out.push({ id, kind: 'stair', name, points: pts, owns: byElement(ramps) });
  };
  stair('north-stair', 'Stair between the deck and the lower walkway', 'stair');
  stair('stair-tower', 'Stair tower down to the boat landing', 'tower-stair');
  stair('swim-stair', 'Stair down to the swim platform', 'swim-stair');

  const P = DIMS.POOL;
  out.push({
    id: 'pool',
    kind: 'pool',
    name: 'Plunge pool',
    points: [center([P.x0, P.water, P.z0], [P.x1, P.water, P.z1]), [P.x0 + 1, P.water, P.z0 + 1], [P.x1 - 1, P.water, P.z1 - 1]],
    owns: byElement(new Set([...els('pool-wall'), ...els('pool-floor')].map((e) => e.id))),
  });
  const H = DIMS.HELIPAD;
  out.push({
    id: 'helideck',
    kind: 'helipad',
    name: 'Helipad',
    points: [[(H.x0 + H.x1) / 2, H.top + 0.05, 0], [H.x0 + 2, H.top + 0.05, 0], [H.x0 + 2, H.top + 0.05, H.z0 + 2], [H.x0 + 2, H.top + 0.05, H.z1 - 2]],
    owns: byElement(new Set(els('helideck').map((e) => e.id))),
    range: 80,
  });
  const ws = layout.props.find((p) => p.kind === 'windsock');
  if (ws) out.push({ id: 'windsock', kind: 'windsock', name: 'Windsock', points: [ws.position], owns: () => false, range: 80 });
  els('planter').forEach((e, i) => {
    if (e.type !== 'box') return;
    out.push({ id: `planter-${i + 1}`, kind: 'planter', name: 'Grass planter', points: [[e.center[0], e.center[1] + e.size[1] / 2 + 0.2, e.center[2]]], owns: byElement(new Set([e.id])) });
  });
  const legNames = ['north-west', 'north-east', 'south-west', 'south-east'];
  els('leg').forEach((e, i) => {
    if (e.type !== 'tube') return;
    out.push({
      id: `leg-${legNames[i]}`,
      kind: 'leg',
      name: `Platform leg (${legNames[i]})`,
      points: [[e.a[0], DIMS.LOWER.top + 1.5, e.a[2]], [e.a[0], 6, e.a[2]], [e.a[0], 1.5, e.a[2]]],
      owns: byElement(new Set([e.id])),
      range: 80,
    });
  });
  const L = DIMS.LANDING;
  out.push({ id: 'boat-landing', kind: 'deck', name: 'Boat landing', points: [[(L.x0 + L.x1) / 2, L.top + 0.1, (L.z0 + L.z1) / 2]], owns: byElement(new Set(els('boat-landing').map((e) => e.id))), range: 60 });
  const S = DIMS.SWIM;
  out.push({ id: 'swim-platform', kind: 'deck', name: 'Swim platform', points: [[(S.x0 + S.x1) / 2, S.top + 0.1, (S.z0 + S.z1) / 2]], owns: byElement(new Set(els('swim-platform').map((e) => e.id))), range: 60 });
  for (const v of layout.vessels) {
    out.push({ id: v.id, kind: v.kind, name: v.name, points: [[v.position[0], 0.9, v.position[2]], [v.position[0] - 2, 0.9, v.position[2]], [v.position[0] + 2, 0.9, v.position[2]]], owns: () => false, range: 80 });
  }
  return out;
}

/** Ray-cast line of sight against the static colliders, ignoring clear glass. */
export class Sight {
  private readonly world: World;

  constructor(world: World) {
    this.world = world;
  }

  /** True if nothing opaque lies between `eye` and `p`, or what the ray hits first belongs to the target. */
  clear(eye: Vec3, p: Vec3, owns: (info: ColliderInfo) => boolean = () => false): boolean {
    const { R, world, info } = this.world.sw;
    const dx = p[0] - eye[0];
    const dy = p[1] - eye[1];
    const dz = p[2] - eye[2];
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-3) return true;
    const ray = new R.Ray({ x: eye[0], y: eye[1], z: eye[2] }, { x: dx / dist, y: dy / dist, z: dz / dist });
    const hit = world.castRay(ray, dist, true, undefined, undefined, undefined, undefined, (c) => {
      const i = info.get(c.handle);
      return !!i && !i.transparent;
    });
    if (!hit || hit.timeOfImpact >= dist - 0.08) return true;
    const i = info.get(hit.collider.handle);
    return !!i && owns(i);
  }
}

export interface PerceptionContext {
  world: World;
  sight: Sight;
  objects: Perceivable[];
}

function inView(viewer: Viewer, p: Vec3, range: number) {
  const [x, , z] = viewer.position;
  const d = Math.hypot(p[0] - x, p[2] - z);
  if (Math.hypot(p[0] - x, p[1] - viewer.position[1], p[2] - z) > range) return false;
  if (d < 0.8) return true; // right next to it
  return Math.abs((relativeBearing(viewer.position, viewer.yaw, p) * Math.PI) / 180) <= HALF_FOV;
}

export function timeReport(world: World, now = Date.now()): Perception['time'] {
  const cel = celestialAt(gameTime(world.clock, now));
  const hh = Math.floor(cel.localHour);
  const mm = Math.floor((cel.localHour - hh) * 60);
  return {
    local: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
    hour: round(cel.localHour, 2),
    daylight: cel.sunElevation > 6 ? 'day' : cel.sunElevation > -6 ? 'twilight' : 'night',
    sunElevation: round(cel.sunElevation),
  };
}

export function weatherReport(world: World, now = Date.now()): Perception['weather'] {
  const w = world.currentWeather(now);
  const windFromDeg = Math.round((w.windDirection + 180) % 360);
  return {
    kind: w.kind,
    windSpeedMs: round(w.windSpeed),
    windFrom: compass(windFromDeg),
    windFromDeg,
    waveHeightM: round(w.waveHeight),
    rain: round(w.rain, 2),
    fog: round(w.fog, 2),
    cloudCover: round(w.cloudCover, 2),
  };
}

/** The named place nearest to `pos` on the same level, if any is close. */
export function areaAt(world: World, pos: Vec3): Perception['self']['area'] {
  let area: Perception['self']['area'] = null;
  for (const pl of world.layout.places) {
    if (Math.abs(pl.position[1] - pos[1]) > 2.5) continue;
    const d = Math.hypot(pl.position[0] - pos[0], pl.position[2] - pos[2]);
    if (d < 15 && (!area || d < area.distance)) area = { id: pl.id, name: pl.name, distance: round(d) };
  }
  return area;
}

/** Builds the perception report for an avatar standing at `viewer`. */
export function perceive(ctx: PerceptionContext, viewer: Viewer, extra: { name: string; task: string | null; surface: string | null }, now = Date.now()): Perception {
  const { world, sight } = ctx;
  const pos = viewer.position;
  const eye: Vec3 = [pos[0], pos[1] + PLAYER.eyeHeight, pos[2]];
  const report = (id: string, kind: string, name: string, p: Vec3, state?: string): SeenObject => {
    const bearing = relativeBearing(pos, viewer.yaw, p);
    const o: SeenObject = {
      id,
      kind,
      name,
      distance: round(Math.hypot(p[0] - pos[0], p[1] - pos[1], p[2] - pos[2])),
      bearing: Math.round(bearing),
      direction: directionWord(bearing),
      heightDelta: round(p[1] - pos[1]),
    };
    if (state) o.state = state;
    return o;
  };

  const visible: SeenObject[] = [];
  for (const o of ctx.objects) {
    const range = o.range ?? VIEW_RANGE;
    const seenAt = o.points.find((p) => inView(viewer, p, range) && sight.clear(eye, p, o.owns));
    if (!seenAt) continue;
    const state = o.kind === 'door' ? (world.sw.isDoorOpen(o.id) ? 'open' : 'closed') : undefined;
    visible.push(report(o.id, o.kind, o.name, o.points[0], state));
  }

  // The drone, wherever it is in the sky or parked.
  let drone: Perception['drone'] = null;
  const ds = world.drone.state;
  if (ds.phase !== 'away') {
    const dp = world.dronePose(now);
    const c: Vec3 = [dp.position[0], dp.position[1] + 1.3, dp.position[2]];
    const seen = inView(viewer, c, 4000) && sight.clear(eye, c, (i) => i.object === 'drone');
    const bearing = relativeBearing(pos, viewer.yaw, c);
    const pilotId = world.crew.pilot;
    drone = {
      phase: ds.phase,
      visible: seen,
      distance: round(Math.hypot(c[0] - pos[0], c[1] - pos[1], c[2] - pos[2])),
      bearing: Math.round(bearing),
      direction: directionWord(bearing),
      pilot: pilotId ? (world.player(pilotId)?.info.name ?? null) : null,
      passengers: world.crew.seats.slice(1).filter(Boolean).length,
    };
    if (seen) visible.push(report('drone', 'drone', 'Passenger drone', c, ds.phase));
  }
  visible.sort((a, b) => a.distance - b.distance);
  visible.splice(MAX_OBJECTS);

  const avatars: SeenAvatar[] = [];
  for (const p of world.online()) {
    if (p.info.id === viewer.id) continue;
    const q = p.pose.p;
    const d = Math.hypot(q[0] - pos[0], q[1] - pos[1], q[2] - pos[2]);
    if (d > 60) continue;
    const head: Vec3 = [q[0], q[1] + PLAYER.eyeHeight, q[2]];
    const chest: Vec3 = [q[0], q[1] + 1.2, q[2]];
    const bearing = relativeBearing(pos, viewer.yaw, q);
    avatars.push({
      id: p.info.id,
      name: p.info.name,
      kind: p.info.kind ?? 'human',
      distance: round(d),
      bearing: Math.round(bearing),
      direction: directionWord(bearing),
      visible: (inView(viewer, head, 60) && sight.clear(eye, head)) || (inView(viewer, chest, 60) && sight.clear(eye, chest)),
      moving: p.pose.speed > 0.3,
    });
  }
  avatars.sort((a, b) => a.distance - b.distance);

  // Where am I?
  const zone = world.layout.zones.find((z) => pos[0] >= z.min[0] && pos[0] <= z.max[0] && pos[1] >= z.min[1] - 0.3 && pos[1] <= z.max[1] && pos[2] >= z.min[2] && pos[2] <= z.max[2]);
  const area = areaAt(world, pos);

  return {
    self: {
      id: viewer.id,
      name: extra.name,
      position: [round(pos[0], 2), round(pos[1], 2), round(pos[2], 2)],
      heading: Math.round(headingOf(viewer.yaw)),
      facing: compass(headingOf(viewer.yaw)),
      zone: zone?.id ?? null,
      area,
      surface: extra.surface,
      task: extra.task,
    },
    time: timeReport(world, now),
    weather: weatherReport(world, now),
    visible,
    avatars,
    drone,
  };
}
