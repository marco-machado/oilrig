import { LayoutBuilder } from './builder.ts';
import { ELEVATOR, HELIPAD, LANDING, LOWER, NORTH_STAIR, PAVILION, POOL, SWIM, TERRACE, TOWER } from './dims.ts';
import { buildFurniture } from './furniture.ts';
import { buildHome } from './home.ts';
import { buildRig } from './rig.ts';
import type { Layout } from './types.ts';

export * from './types.ts';
export * as DIMS from './dims.ts';
export { subtractRects } from './builder.ts';

let cached: Layout | null = null;

/** Builds (once) the full world layout shared by client and server. */
export function getLayout(): Layout {
  if (cached) return cached;
  const b = new LayoutBuilder();
  buildRig(b);
  buildHome(b);
  buildFurniture(b);

  const floor = PAVILION.floor;
  b.place('terrace', 'Terrace', [-6, TERRACE.top, 7]);
  b.place('living-room', 'Living room', [-6, floor, -5]);
  b.place('kitchen', 'Kitchen', [3, floor, -6]);
  b.place('bedroom', 'Bedroom', [-15, floor, -9]);
  b.place('bath', 'Bath', [-21, floor, -9.5]);
  b.place('pool-deck', 'Pool deck', [15, TERRACE.top, -3]);
  b.place('pool', 'Plunge pool', [14, POOL.floor, -8]);
  b.place('helipad', 'Helipad', [(HELIPAD.x0 + HELIPAD.x1) / 2, HELIPAD.top, 0]);
  b.place('north-stair-top', 'North stair (deck)', [NORTH_STAIR.xTop + 1.5, 20, (NORTH_STAIR.z0 + NORTH_STAIR.z1) / 2]);
  b.place('walkway-north', 'Lower walkway, north', [-6, LOWER.top, -16.3]);
  b.place('walkway-east', 'Lower walkway, east', [24.5, LOWER.top, 0]);
  b.place('walkway-south', 'Lower walkway, south', [0, LOWER.top, 16.5]);
  b.place('walkway-west', 'Lower walkway, west', [-24.5, LOWER.top, 0]);
  b.place('tower-top', 'Stair tower, top', [TOWER.x0 + 0.6, LOWER.top, 17.2]);
  b.place('boat-landing', 'Boat landing', [-16, LANDING.top, 21.8]);
  b.place('swim-platform', 'Swim platform', [-5, SWIM.top, 21]);
  b.place('firepit', 'Firepit lounge', [-9, TERRACE.top, 9.4]);
  b.place('hammocks', 'Hammock nets', [-16.5, LOWER.top, -16.3]);
  const ex = (ELEVATOR.door.x0 + ELEVATOR.door.x1) / 2;
  b.place('elevator-deck', 'Elevator (main deck)', [ex, ELEVATOR.stops[1], 19.1]);
  b.place('elevator-landing', 'Elevator (boat landing)', [ex, ELEVATOR.stops[0], 19.3]);

  b.zone('helipad', 'helipad', [HELIPAD.x0, HELIPAD.top - 0.5, HELIPAD.z0], [HELIPAD.x1, HELIPAD.top + 4, HELIPAD.z1]);

  cached = {
    elements: b.elements,
    props: b.props,
    furniture: b.furniture,
    vessels: b.vessels,
    doors: b.doors,
    zones: b.zones,
    lights: b.lights,
    places: b.places,
    spawn: { position: [-6, TERRACE.top, 7], yaw: 0 },
    respawn: { position: [-16, LANDING.top, 21.8], yaw: 0 },
  };
  return cached;
}

export function findPlace(id: string) {
  const p = getLayout().places.find((q) => q.id === id);
  if (!p) throw new Error(`Unknown place ${id}`);
  return p;
}
