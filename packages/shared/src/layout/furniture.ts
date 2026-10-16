import type { LayoutBuilder } from './builder.ts';
import { LOWER, PAVILION, TENDER, TERRACE } from './dims.ts';

// Furniture for the pavilion, the terrace and the lower walkway. Positions keep the v1
// walking routes clear (doorways, the terrace crossings and the walkway lap); the
// walkability tests walk all of them with the furniture in place.

const FLOOR = PAVILION.floor;
const DECK = TERRACE.top;
const NORTH = Math.PI; // front facing -z
const EAST = Math.PI / 2; // front facing +x
const WEST = -Math.PI / 2; // front facing -x

export function buildFurniture(b: LayoutBuilder) {
  // ---- Living room: sofa facing the north glass, coffee table, rug.
  b.addFurniture(
    { id: 'living-sofa', kind: 'sofa', name: 'Living room sofa', position: [-8.5, FLOOR, -7.9], size: [3, 0.82, 0.95], rotationY: NORTH },
    [
      [0, 0, 3, 0.95, 0, 0.44],
      [0, -0.36, 3, 0.24, 0.44, 0.82],
    ],
    'soft',
  );
  b.addFurniture(
    { id: 'coffee-table', kind: 'coffee-table', name: 'Coffee table', position: [-8.5, FLOOR, -9.7], size: [1.3, 0.38, 0.65], rotationY: 0 },
    [[0, 0, 1.3, 0.65, 0, 0.38]],
  );
  b.addFurniture({ id: 'living-rug', kind: 'rug', name: 'Rug', position: [-8.5, FLOOR, -9.0], size: [3.8, 0.01, 2.8], rotationY: 0 }, []);

  // ---- Dining table with six chairs, between the living room and the kitchen.
  b.addFurniture(
    { id: 'dining-table', kind: 'dining-table', name: 'Dining table', position: [-1.6, FLOOR, -8.0], size: [2.2, 0.75, 1.0], rotationY: 0 },
    [[0, 0, 2.2, 1.0, 0, 0.75]],
  );
  let chair = 0;
  for (const [z, rot] of [
    [-8.82, 0],
    [-7.18, NORTH],
  ] as const) {
    for (const x of [-2.35, -1.6, -0.85]) {
      chair += 1;
      b.addFurniture(
        { id: `dining-chair-${chair}`, kind: 'dining-chair', name: `Dining chair ${chair}`, position: [x, FLOOR, z], size: [0.46, 0.86, 0.5], rotationY: rot },
        [
          [0, 0, 0.46, 0.5, 0, 0.46],
          [0, -0.22, 0.46, 0.06, 0.46, 0.86],
        ],
      );
    }
  }

  // ---- Kitchen: island with bar stools, and a back counter along the east glass.
  b.addFurniture(
    { id: 'kitchen-island', kind: 'kitchen-island', name: 'Kitchen island', position: [3.5, FLOOR, -9.1], size: [3, 0.92, 1.1], rotationY: 0 },
    [[0, 0, 3, 1.1, 0, 0.92]],
    'stone',
  );
  [2.5, 3.5, 4.5].forEach((x, i) => {
    b.addFurniture(
      { id: `bar-stool-${i + 1}`, kind: 'bar-stool', name: `Bar stool ${i + 1}`, position: [x, FLOOR, -8.05], size: [0.4, 0.75, 0.4], rotationY: NORTH },
      [[0, 0, 0.36, 0.36, 0, 0.75]],
    );
  });
  b.addFurniture(
    { id: 'kitchen-counter', kind: 'kitchen-counter', name: 'Kitchen counter', position: [7.6, FLOOR, -9.4], size: [4.6, 0.92, 0.65], rotationY: WEST },
    [[0, 0, 4.6, 0.65, 0, 0.92]],
    'stone',
  );

  // ---- Bedroom: bed with its head against the divider wall, two nightstands.
  b.addFurniture(
    { id: 'bed', kind: 'bed', name: 'Bed', position: [-13.18, FLOOR, -10.4], size: [1.8, 0.55, 2.15], rotationY: WEST },
    [
      [0, 0, 1.8, 2.15, 0, 0.55],
      [0, -1.03, 1.8, 0.08, 0.55, 1.05],
    ],
    'soft',
  );
  for (const [i, z] of [
    [1, -11.62],
    [2, -9.18],
  ] as const) {
    b.addFurniture(
      { id: `nightstand-${i}`, kind: 'nightstand', name: `Nightstand ${i}`, position: [-12.35, FLOOR, z], size: [0.45, 0.48, 0.4], rotationY: WEST },
      [[0, 0, 0.45, 0.4, 0, 0.48]],
    );
  }

  // ---- Bath: freestanding tub.
  b.addFurniture(
    { id: 'bathtub', kind: 'bathtub', name: 'Bathtub', position: [-22.6, FLOOR, -10.6], size: [0.82, 0.6, 1.7], rotationY: EAST },
    [[0, 0, 0.82, 1.7, 0, 0.6]],
    'stone',
  );

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
