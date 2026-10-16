import type { LayoutBuilder } from './builder.ts';
import { LOWER, TENDER, TERRACE } from './dims.ts';

// Furniture for the terrace and the lower walkway (the pavilion is left empty). Positions
// keep the walking routes clear (doorways, the terrace crossings and the walkway lap); the
// walkability tests walk all of them with the furniture in place.

const DECK = TERRACE.top;
const NORTH = Math.PI; // front facing -z
const EAST = Math.PI / 2; // front facing +x
const WEST = -Math.PI / 2; // front facing -x

export function buildFurniture(b: LayoutBuilder) {
  // ---- Terrace: firepit lounge (three outdoor sofas) and sun loungers north of the pool.
  const fx = -9;
  const fz = 11.6;
  b.furniture.push({ id: 'firepit', kind: 'firepit', name: 'Firepit', position: [fx, DECK, fz], size: [1.3, 0.42, 1.3], rotationY: 0 });
  b.tube('firepit', [fx, DECK, fz], [fx, DECK + 0.42, fz], 0.65, 'steelGrey', { collide: true, render: false, surface: 'stone', object: 'firepit' });
  const lounge: Array<[string, string, number, number, number, number]> = [
    ['lounge-sofa-south', 'Lounge sofa (south)', fx, fz + 2.15, NORTH, 2.6],
    ['lounge-sofa-west', 'Lounge sofa (west)', fx - 2.75, fz, EAST, 2.2],
    ['lounge-sofa-east', 'Lounge sofa (east)', fx + 2.75, fz, WEST, 2.2],
  ];
  for (const [id, name, x, z, rot, w] of lounge) {
    b.addFurniture(
      { id, kind: 'outdoor-sofa', name, position: [x, DECK, z], size: [w, 0.75, 0.9], rotationY: rot },
      [
        [0, 0, w, 0.9, 0, 0.4],
        [0, -0.34, w, 0.22, 0.4, 0.75],
      ],
      'soft',
    );
  }
  [12, 15, 18].forEach((x, i) => {
    b.addFurniture(
      { id: `sun-lounger-${i + 1}`, kind: 'sun-lounger', name: `Sun lounger ${i + 1}`, position: [x, DECK, -11.6], size: [0.72, 0.38, 2.0], rotationY: 0 },
      [
        [0, 0.2, 0.72, 1.6, 0, 0.38],
        [0, -0.8, 0.72, 0.4, 0, 0.75],
      ],
      'soft',
    );
  });

  // ---- Lower walkway: two hammock nets slung between the hangers on the north side.
  const hz0 = LOWER.outer.z0 + 0.25;
  const hz1 = hz0 + 1.4;
  const top = LOWER.top + 0.42;
  for (const [id, name, x0, x1] of [
    ['hammock-west', 'Hammock net (west)', -19.5, -13.5],
    ['hammock-east', 'Hammock net (east)', 7, 13],
  ] as const) {
    b.addFurniture(
      { id, kind: 'hammock-net', name, position: [(x0 + x1) / 2, LOWER.top, (hz0 + hz1) / 2], size: [x1 - x0, 0.42, hz1 - hz0], rotationY: 0 },
      [[0, 0, x1 - x0, hz1 - hz0, 0, top - LOWER.top]],
      'soft',
    );
    // Someone lying on the net is higher than the walkway, so the outer guard is raised.
    b.wall('hammock-guard', [x0 - 0.5, LOWER.outer.z0], [x1 + 0.5, LOWER.outer.z0], LOWER.top, LOWER.top + 1.9);
  }

  // ---- The tender moored at the boat landing.
  b.vessel({
    id: 'tender',
    kind: 'boat',
    name: 'Tender',
    position: [TENDER.x, 0, TENDER.z],
    size: [TENDER.length, TENDER.beam, TENDER.freeboard],
    rotationY: EAST,
  });
}
