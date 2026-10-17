import type { LayoutBuilder } from './builder.ts';
import { PAVILION, POOL, TERRACE } from './dims.ts';
import type { Rect, Vec3 } from './types.ts';

const GLASS_T = 0.04;
const MULLION = 0.09;
const PANEL = 2.4;

interface Facade {
  /** Fixed axis value (z for north/south, x for east/west). */
  fixed: number;
  axis: 'x' | 'z';
  from: number;
  to: number;
  openings: Array<[number, number]>;
}

function facade(b: LayoutBuilder, f: Facade) {
  const y0 = PAVILION.floor;
  const y1 = PAVILION.floor + PAVILION.height;
  const yc = (y0 + y1) / 2;
  const h = y1 - y0;
  // Split [from, to] into solid runs around the openings.
  const runs: Array<[number, number]> = [];
  let cursor = f.from;
  for (const [a, c] of [...f.openings].sort((p, q) => p[0] - q[0])) {
    if (a > cursor) runs.push([cursor, a]);
    cursor = c;
  }
  if (cursor < f.to) runs.push([cursor, f.to]);

  const at = (u: number, y: number): Vec3 => (f.axis === 'x' ? [u, y, f.fixed] : [f.fixed, y, u]);
  const sizeAlong = (len: number, thick: number): Vec3 => (f.axis === 'x' ? [len, h, thick] : [thick, h, len]);
  const mullion = (u: number) =>
    b.box('mullion', at(u, yc), f.axis === 'x' ? [MULLION, h, 0.14] : [0.14, h, MULLION], 'mullion', { collide: false });

  for (const [a, c] of runs) {
    const count = Math.max(1, Math.round((c - a) / PANEL));
    const w = (c - a) / count;
    for (let i = 0; i < count; i++) {
      const u0 = a + i * w;
      const u1 = u0 + w;
      const mid = (u0 + u1) / 2;
      b.box('glass-wall', at(mid, yc), sizeAlong(w, GLASS_T), 'glass', { surface: 'stone' });
      mullion(u0);
    }
    mullion(c);
  }
  // Floor and head channels along the whole facade.
  const len = f.to - f.from;
  const mid = (f.from + f.to) / 2;
  const chan = (y: number) =>
    b.box('glazing-channel', at(mid, y), f.axis === 'x' ? [len, 0.08, 0.16] : [0.16, 0.08, len], 'mullion', {
      collide: false,
    });
  chan(y0 + 0.04);
  chan(y1 - 0.04);
}

export function buildHome(b: LayoutBuilder) {
  const P = PAVILION;
  const floorRect: Rect = { x0: P.x0, x1: P.x1, z0: P.z0, z1: P.z1 };
  const poolRect: Rect = { x0: POOL.x0, x1: POOL.x1, z0: POOL.z0, z1: POOL.z1 };
  const terraceRect: Rect = { x0: TERRACE.x0, x1: TERRACE.x1, z0: TERRACE.z0, z1: TERRACE.z1 };

  // Teak terrace around the pavilion and pool.
  b.slab('terrace', terraceRect, [floorRect, poolRect], TERRACE.top, 0.15, 'teak', { surface: 'wood' });

  // Pavilion floor, roof and fascia.
  b.boxMinMax('pavilion-floor', [P.x0, 19.9, P.z0], [P.x1, P.floor, P.z1], 'concrete', { surface: 'stone' });
  const ceiling = P.floor + P.height;
  const o = P.overhang;
  b.boxMinMax('roof', [P.x0 - o, ceiling, P.z0 - o], [P.x1 + o, ceiling + P.roofThickness, P.z1 + o], 'plaster');
  const fy0 = ceiling - 0.05;
  const fy1 = ceiling + P.roofThickness + 0.08;
  b.boxMinMax('fascia', [P.x0 - o - 0.05, fy0, P.z0 - o - 0.05], [P.x1 + o + 0.05, fy1, P.z0 - o], 'mullion', { collide: false });
  b.boxMinMax('fascia', [P.x0 - o - 0.05, fy0, P.z1 + o], [P.x1 + o + 0.05, fy1, P.z1 + o + 0.05], 'mullion', { collide: false });
  b.boxMinMax('fascia', [P.x0 - o - 0.05, fy0, P.z0 - o], [P.x0 - o, fy1, P.z1 + o], 'mullion', { collide: false });
  b.boxMinMax('fascia', [P.x1 + o, fy0, P.z0 - o], [P.x1 + o + 0.05, fy1, P.z1 + o], 'mullion', { collide: false });
  for (const [x, z] of [
    [P.x0 - o + 0.4, P.z0 - o + 0.4],
    [P.x1 + o - 0.4, P.z0 - o + 0.4],
    [P.x0 - o + 0.4, P.z1 + o - 0.4],
    [P.x1 + o - 0.4, P.z1 + o - 0.4],
    [-8, P.z1 + o - 0.4],
  ] as const) {
    b.tube('roof-column', [x, TERRACE.top, z], [x, ceiling, z], 0.08, 'mullion', { collide: true });
  }

  // Facades: a sliding door on every side (two on the terrace side).
  const southDoors: Array<[number, number]> = [
    [-8, -5.6],
    [2, 4.4],
  ];
  const northDoor: [number, number] = [-7.2, -4.8];
  const eastDoor: [number, number] = [-6, -3.6];
  const westDoor: [number, number] = [-5.2, -2.8];
  facade(b, { axis: 'x', fixed: P.z1, from: P.x0, to: P.x1, openings: southDoors });
  facade(b, { axis: 'x', fixed: P.z0, from: P.x0, to: P.x1, openings: [northDoor] });
  facade(b, { axis: 'z', fixed: P.x0, from: P.z0, to: P.z1, openings: [westDoor] });
  facade(b, { axis: 'z', fixed: P.x1, from: P.z0, to: P.z1, openings: [eastDoor] });

  const doorH = P.height - 0.12;
  const doorY = P.floor + doorH / 2 + 0.02;
  // Panels hang just outside the glass line and slide over the fixed glass beside the opening.
  const alongX = (id: string, name: string, [a, c]: [number, number], z: number, out: 1 | -1) =>
    b.door({ id, name, center: [(a + c) / 2, doorY, z + out * 0.07], size: [c - a, doorH, 0.05], openOffset: [-(c - a) + 0.12, 0, 0], outward: [0, out] });
  const alongZ = (id: string, name: string, [a, c]: [number, number], x: number, out: 1 | -1) =>
    b.door({ id, name, center: [x + out * 0.07, doorY, (a + c) / 2], size: [0.05, doorH, c - a], openOffset: [0, 0, -(c - a) + 0.12], outward: [out, 0] });
  alongX('door-south-1', 'Living room sliding door', southDoors[0], P.z1, 1);
  alongX('door-south-2', 'Kitchen sliding door', southDoors[1], P.z1, 1);
  alongX('door-north', 'North sliding door', northDoor, P.z0, -1);
  alongZ('door-east', 'Pool sliding door', eastDoor, P.x1, 1);
  alongZ('door-west', 'West sliding door', westDoor, P.x0, -1);

  // Recessed downlights.
  for (let x = P.x0 + 2; x < P.x1; x += 4) {
    for (const z of [-9.5, -5, -0.5]) {
      b.light('downlight', [x, ceiling - 0.05, z], 0xffd2a0, 22, 7.5);
    }
  }

  // Pool basin, steps and lights.
  const pw = 0.2;
  const pb = POOL.floor - 0.2;
  b.boxMinMax('pool-floor', [POOL.x0, pb, POOL.z0], [POOL.x1, POOL.floor, POOL.z1], 'poolTile', { surface: 'tile' });
  b.boxMinMax('pool-wall', [POOL.x0 - pw, pb, POOL.z0 - pw], [POOL.x1 + pw, TERRACE.top - 0.02, POOL.z0], 'poolTile');
  b.boxMinMax('pool-wall', [POOL.x0 - pw, pb, POOL.z1], [POOL.x1 + pw, TERRACE.top - 0.02, POOL.z1 + pw], 'poolTile');
  b.boxMinMax('pool-wall', [POOL.x0 - pw, pb, POOL.z0], [POOL.x0, TERRACE.top - 0.02, POOL.z1], 'poolTile');
  b.boxMinMax('pool-wall', [POOL.x1, pb, POOL.z0], [POOL.x1 + pw, TERRACE.top - 0.02, POOL.z1], 'poolTile');
  // Wide steps out of the east end (0.24 rise, 0.42 tread); the collider is a ramp up to terrace level.
  const stepRun = 2.5;
  const steps = 6;
  const rise = TERRACE.top - POOL.floor;
  for (let k = 0; k < steps; k++) {
    const x0 = POOL.x1 - stepRun + (stepRun / steps) * k;
    b.boxMinMax('pool-step', [x0, POOL.floor, POOL.z0], [POOL.x1, POOL.floor + (rise * (k + 1)) / steps - 0.02, POOL.z1], 'poolTile', {
      collide: false,
    });
  }
  const zc = (POOL.z0 + POOL.z1) / 2;
  b.ramp('pool-ramp', [POOL.x1 - stepRun, POOL.floor, zc], [POOL.x1, TERRACE.top, zc], POOL.z1 - POOL.z0, 'tile');
  b.light('poolLight', [POOL.x0 + 2.5, POOL.floor + 0.6, POOL.z1 - 0.3], 0x9fe8ff, 18, 6);
  b.light('poolLight', [POOL.x0 + 6.5, POOL.floor + 0.6, POOL.z1 - 0.3], 0x9fe8ff, 18, 6);

  // Corten planters with grass beds.
  const planters: Rect[] = [
    { x0: POOL.x0 - 0.5, x1: POOL.x1 + 0.5, z0: -13.8, z1: -12.8 },
    { x0: -27.6, x1: -26.6, z0: -11, z1: 1 },
    { x0: -17, x1: -15, z0: 8, z1: 10 },
    { x0: -3, x1: -1, z0: 10.5, z1: 12.5 },
    { x0: 13, x1: 15, z0: 8, z1: 10 },
    { x0: 25.4, x1: 26.4, z0: -12, z1: -4 },
    { x0: 25.4, x1: 26.4, z0: 4, z1: 12 },
  ];
  const ph = 0.6;
  for (const r of planters) {
    b.boxMinMax('planter', [r.x0, TERRACE.top, r.z0], [r.x1, TERRACE.top + ph, r.z1], 'corten', { surface: 'metal' });
    b.prop('grass', [(r.x0 + r.x1) / 2, TERRACE.top + ph - 0.04, (r.z0 + r.z1) / 2], {
      size: [r.x1 - r.x0 - 0.12, 0, r.z1 - r.z0 - 0.12],
    });
  }

  // Bollard lamps along the terrace.
  const bollards: Array<[number, number]> = [
    [-24, 15],
    [-12, 15],
    [0, 15],
    [12, 15],
    [24, 15],
    [-27, 4],
    [-27, -13.8],
    [9, -11.5],
    [21, -11.5],
    [21, -4.5],
    [9, 4],
    [26, -2.5],
    [26, 2.5],
  ];
  for (const [x, z] of bollards) {
    b.prop('bollard', [x, TERRACE.top, z]);
    b.light('deckLamp', [x, TERRACE.top + 0.75, z], 0xffcf96, 5, 5);
  }
  // Obstruction light on the roof corner.
  b.light('obstruction', [P.x1 + o - 0.3, ceiling + P.roofThickness + 0.3, P.z0 - o + 0.3], 0xff2010, 4, 6);

  // Zones.
  b.zone('pavilion', 'indoor', [P.x0, P.floor - 0.2, P.z0], [P.x1, ceiling, P.z1]);
  b.zone('pool', 'pool', [POOL.x0, POOL.floor - 0.1, POOL.z0], [POOL.x1, POOL.water, POOL.z1]);
}
