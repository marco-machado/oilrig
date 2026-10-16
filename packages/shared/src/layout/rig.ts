import { LayoutBuilder, rectsOverlap, subtractRects } from './builder.ts';
import {
  BRIDGE,
  DECK,
  ELEVATOR,
  GIRDER,
  HELIPAD,
  JACKET_LEVELS,
  LANDING,
  LEG_RADIUS,
  LEG_TOP,
  LEGS,
  LOWER,
  NORTH_STAIR,
  PILE_TOP,
  POOL,
  RAIL_HEIGHT,
  SECONDARY_COLUMN_INSET,
  SWIM,
  TERRACE,
  TOWER,
  TOWER_X1,
} from './dims.ts';
import type { Rect, Vec3 } from './types.ts';
import { WORLD } from '../config.ts';

const sign = (v: number) => (v < 0 ? -1 : 1);

/** Jacket: legs, piles, secondary columns and underwater bracing. */
function jacket(b: LayoutBuilder) {
  for (const [x, z] of LEGS) {
    b.tube('leg', [x, PILE_TOP, z], [x, LEG_TOP, z], LEG_RADIUS, 'steelYellow', { collide: true, surface: 'metal' });
    b.tube('pile-sleeve', [x, WORLD.seabed - 1, z], [x, PILE_TOP + 0.6, z], LEG_RADIUS + 0.25, 'steelDark');
    const sx = x - sign(x) * SECONDARY_COLUMN_INSET;
    b.tube('column', [sx, -27, z], [sx, LOWER.top - 0.45, z], 0.6, 'steelYellow', { collide: true });
    b.tube('pile-sleeve', [sx, WORLD.seabed - 1, z], [sx, -26.4, z], 0.78, 'steelDark');
  }
  const corner = (i: number, y: number): Vec3 => [LEGS[i][0], y, LEGS[i][1]];
  // faces: 0-1 north, 2-3 south, 0-2 west, 1-3 east
  const faces = [
    [0, 1],
    [2, 3],
    [0, 2],
    [1, 3],
  ] as const;
  for (const y of JACKET_LEVELS) {
    for (const [i, j] of faces) b.tube('horizontal-brace', corner(i, y), corner(j, y), 0.45);
  }
  // plan diagonals at the middle level
  b.tube('plan-brace', corner(0, -14), corner(3, -14), 0.35);
  b.tube('plan-brace', corner(1, -14), corner(2, -14), 0.35);
  // X bracing on every face between consecutive levels
  for (let l = 0; l < JACKET_LEVELS.length - 1; l++) {
    const yu = JACKET_LEVELS[l];
    const yl = JACKET_LEVELS[l + 1];
    for (const [i, j] of faces) {
      b.tube('x-brace', corner(i, yu), corner(j, yl), 0.4);
      b.tube('x-brace', corner(j, yu), corner(i, yl), 0.4);
    }
  }
  // Knee braces from the legs out to the deck edges (pass under the walkway).
  for (const [x, z] of LEGS) {
    b.tube('deck-strut', [x, 6, z], [sign(x) * (DECK.x1 - 0.2), LEG_TOP, z], 0.32);
    b.tube('deck-strut', [x, 6, z], [x, LEG_TOP, sign(z) * (DECK.z1 - 0.2)], 0.32);
  }
}

/** Lower beam-level walkway ring, its framing and the truss up to the main deck. */
function lowerLevel(b: LayoutBuilder) {
  const { outer, inner, top } = LOWER;
  const beamTop = top - 0.05;
  // Grating ring.
  b.slab('walkway', outer, [inner], top, 0.05, 'grating', { surface: 'grating' });
  // Leg-line beams (truss bottom chords).
  for (const z of [-13, 13]) b.beam('lower-beam', [-21, beamTop - 0.4, z], [21, beamTop - 0.4, z], 0.8, 0.4);
  for (const x of [-21, 21]) b.beam('lower-beam', [x, beamTop - 0.4, -13], [x, beamTop - 0.4, 13], 0.8, 0.4);
  // Ring edge beams.
  const edge = (r: Rect, d: number) => {
    const y = beamTop - d / 2;
    b.beam('walkway-edge', [r.x0, y, r.z0], [r.x1, y, r.z0], d, 0.25);
    b.beam('walkway-edge', [r.x0, y, r.z1], [r.x1, y, r.z1], d, 0.25);
    b.beam('walkway-edge', [r.x0, y, r.z0], [r.x0, y, r.z1], d, 0.25);
    b.beam('walkway-edge', [r.x1, y, r.z0], [r.x1, y, r.z1], d, 0.25);
  };
  edge(outer, 0.4);
  edge(inner, 0.4);
  // Outriggers across the walkway, tied back to the leg-line beams.
  for (let x = -24; x <= 24; x += 4) {
    b.beam('outrigger', [x, beamTop - 0.15, outer.z0], [x, beamTop - 0.15, -13], 0.3, 0.2);
    b.beam('outrigger', [x, beamTop - 0.15, 13], [x, beamTop - 0.15, outer.z1], 0.3, 0.2);
  }
  for (let z = -12; z <= 12; z += 4) {
    b.beam('outrigger', [outer.x0, beamTop - 0.15, z], [-21, beamTop - 0.15, z], 0.3, 0.2);
    b.beam('outrigger', [21, beamTop - 0.15, z], [outer.x1, beamTop - 0.15, z], 0.3, 0.2);
  }
  // Hangers from the main deck down to the walkway outer edge.
  const hang = (x: number, z: number) => b.tube('hanger', [x, beamTop - 0.4, z], [x, LEG_TOP, z], 0.14);
  for (let x = -26; x <= 26; x += 6.5) {
    hang(x, outer.z0);
    if (x < TOWER.x0 - 0.5 || x > TOWER_X1 + 0.5) hang(x, outer.z1);
  }
  for (let z = -12.5; z <= 12.5; z += 6.25) {
    hang(outer.x0, z);
    hang(outer.x1, z);
  }
  // Warren trusses between the lower beams and the deck girders on the leg lines.
  const yb = beamTop;
  const yt = LEG_TOP;
  const xs = [-21, -14, -7, 0, 7, 14, 21];
  for (const z of [-13, 13]) {
    xs.forEach((x, i) => {
      if (Math.abs(x) !== 21) b.tube('truss-post', [x, yb, z], [x, yt, z], 0.22);
      if (i < xs.length - 1) {
        const up = i % 2 === 0;
        b.tube('truss-diagonal', [x, up ? yb : yt, z], [xs[i + 1], up ? yt : yb, z], 0.2);
      }
    });
  }
  const zs = [-13, -6.5, 0, 6.5, 13];
  for (const x of [-21, 21]) {
    zs.forEach((z, i) => {
      if (Math.abs(z) !== 13) b.tube('truss-post', [x, yb, z], [x, yt, z], 0.22);
      if (i < zs.length - 1) {
        const up = i % 2 === 0;
        b.tube('truss-diagonal', [x, up ? yb : yt, z], [x, up ? yt : yb, zs[i + 1]], 0.2);
      }
    });
  }
  // Rails: outer ring with a gap at the stair tower, and the inner ring.
  const y = top;
  b.rail('walkway-rail', [
    [TOWER.x0 + TOWER.landing, y, outer.z1],
    [outer.x1, y, outer.z1],
    [outer.x1, y, outer.z0],
    [outer.x0, y, outer.z0],
    [outer.x0, y, outer.z1],
    [TOWER.x0, y, outer.z1],
  ]);
  b.rail('walkway-rail', [
    [inner.x0, y, inner.z0],
    [inner.x1, y, inner.z0],
    [inner.x1, y, inner.z1],
    [inner.x0, y, inner.z1],
    [inner.x0, y, inner.z0],
  ]);
  // Bulkhead lamps under the main deck along the ring.
  for (let x = -22; x <= 22; x += 11) {
    b.light('bulkhead', [x, LEG_TOP - 0.2, (outer.z0 + inner.z0) / 2], 0xffedd0, 14, 10);
    b.light('bulkhead', [x, LEG_TOP - 0.2, (outer.z1 + inner.z1) / 2], 0xffedd0, 14, 10);
  }
  for (const z of [-8, 8]) {
    b.light('bulkhead', [(outer.x0 + inner.x0) / 2, LEG_TOP - 0.2, z], 0xffedd0, 14, 10);
    b.light('bulkhead', [(outer.x1 + inner.x1) / 2, LEG_TOP - 0.2, z], 0xffedd0, 14, 10);
  }
}

/** Main deck girders, beams and the uncovered grating around the terrace. */
function mainDeck(b: LayoutBuilder) {
  const deckRect: Rect = { x0: DECK.x0, x1: DECK.x1, z0: DECK.z0, z1: DECK.z1 };
  const terrace: Rect = { x0: TERRACE.x0, x1: TERRACE.x1, z0: TERRACE.z0, z1: TERRACE.z1 };
  b.slab('deck', deckRect, [terrace, NORTH_STAIR.opening], DECK.top, DECK.thickness, 'grating', { surface: 'grating' });

  const gy = DECK.top - DECK.thickness - GIRDER.depth / 2;
  for (const z of [-13, 13]) b.beam('girder', [DECK.x0, gy, z], [DECK.x1, gy, z], GIRDER.depth, GIRDER.width);
  for (const x of [-21, 21]) b.beam('girder', [x, gy, DECK.z0], [x, gy, DECK.z1], GIRDER.depth, GIRDER.width);
  const ey = DECK.top - DECK.thickness - 0.3;
  b.beam('edge-beam', [DECK.x0, ey, DECK.z0], [DECK.x1, ey, DECK.z0], 0.6, 0.3);
  b.beam('edge-beam', [DECK.x0, ey, DECK.z1], [DECK.x1, ey, DECK.z1], 0.6, 0.3);
  b.beam('edge-beam', [DECK.x0, ey, DECK.z0], [DECK.x0, ey, DECK.z1], 0.6, 0.3);
  b.beam('edge-beam', [DECK.x1, ey, DECK.z0], [DECK.x1, ey, DECK.z1], 0.6, 0.3);
  // Secondary beams run north-south and stop short of the deck openings.
  const holes: Rect[] = [
    NORTH_STAIR.opening,
    { x0: POOL.x0 - 0.3, x1: POOL.x1 + 0.3, z0: POOL.z0 - 0.3, z1: POOL.z1 + 0.3 },
  ];
  for (let x = DECK.x0 + 3; x < DECK.x1; x += 3) {
    if (Math.abs(Math.abs(x) - 21) < 0.5) continue;
    const strip: Rect = { x0: x - 0.15, x1: x + 0.15, z0: DECK.z0, z1: DECK.z1 };
    const blocking = holes.filter((h) => rectsOverlap(strip, h));
    for (const seg of subtractRects(strip, blocking)) {
      b.beam('deck-beam', [x, ey, seg.z0], [x, ey, seg.z1], 0.6, 0.25);
    }
  }
  // Perimeter rail with openings on the east edge for the helipad bridge and on the south
  // edge for the elevator.
  const y = DECK.top;
  const door = ELEVATOR.door;
  b.rail('deck-rail', [
    [DECK.x1, y, BRIDGE.z1],
    [DECK.x1, y, DECK.z1],
    [door.x1, y, DECK.z1],
  ]);
  b.rail('deck-rail', [
    [door.x0, y, DECK.z1],
    [DECK.x0, y, DECK.z1],
    [DECK.x0, y, DECK.z0],
    [DECK.x1, y, DECK.z0],
    [DECK.x1, y, BRIDGE.z0],
  ]);
}

/** Stair from the main deck down to the north walkway. */
function northStair(b: LayoutBuilder) {
  const zc = (NORTH_STAIR.z0 + NORTH_STAIR.z1) / 2;
  const w = NORTH_STAIR.z1 - NORTH_STAIR.z0;
  b.stair('stair', [NORTH_STAIR.xBottom, LOWER.top, zc], [NORTH_STAIR.xTop, DECK.top, zc], w, 21);
  const { x0, x1, z0, z1 } = NORTH_STAIR.opening;
  // Solid side walls cover both the stair sides and the deck-opening guards.
  b.wall('stair-wall', [x0, z1], [x1, z1], LOWER.top, DECK.top + 1.25);
  b.wall('stair-wall', [x0, z0], [x1, z0], LOWER.top, DECK.top + 1.25);
  b.wall('stair-wall', [x0, z0], [x0, z1], DECK.top - 0.1, DECK.top + 1.25);
  // Visible rails: around the opening on the deck, and along both stair sides.
  b.rail('opening-rail', [[x1, DECK.top, z1], [x0, DECK.top, z1], [x0, DECK.top, z0], [x1, DECK.top, z0]], { collide: false });
  for (const z of [z0 + 0.05, z1 - 0.05]) {
    b.rail('stair-rail', [[NORTH_STAIR.xBottom, LOWER.top, z], [NORTH_STAIR.xTop, DECK.top, z]], { collide: false });
  }
}

/** Switchback stair tower from the walkway down to the boat landing. */
function stairTower(b: LayoutBuilder) {
  const { x0, landing, run, laneA, laneB, top, bottom, flights } = TOWER;
  const drop = (top - bottom) / flights;
  const xa = x0 + landing; // west end of the flights
  const xb = xa + run; // east end of the flights
  const zA = (laneA[0] + laneA[1]) / 2;
  const zB = (laneB[0] + laneB[1]) / 2;
  const width = laneA[1] - laneA[0];
  for (let i = 0; i < flights; i++) {
    const yTop = top - drop * i;
    const yBot = yTop - drop;
    if (i % 2 === 0) {
      b.stair('tower-stair', [xb, yBot, zA], [xa, yTop, zA], width, 14);
    } else {
      b.stair('tower-stair', [xa, yBot, zB], [xb, yTop, zB], width, 14);
    }
    // Landing at the far end of this flight (the last one is the boat landing).
    if (i < flights - 1) {
      const lx0 = i % 2 === 0 ? xb : x0;
      b.boxMinMax('tower-landing', [lx0, yBot - 0.1, laneA[0]], [lx0 + landing, yBot, laneB[1]], 'grating', {
        surface: 'grating',
      });
      b.light('bulkhead', [lx0 + landing / 2, yBot + 2.3, (laneA[0] + laneB[1]) / 2], 0xffedd0, 8, 6);
    }
  }
  // Top landing joins the walkway.
  b.boxMinMax('tower-landing', [x0, top - 0.1, LOWER.outer.z1 - 0.05], [xa, top, laneB[1]], 'grating', {
    surface: 'grating',
  });
  // Blocking walls. The base (below 5.4 m) is left open: the landing rails enclose it.
  const wb = bottom + 2.4;
  const wt = top + 1.3;
  b.wall('tower-wall', [x0, laneB[1]], [TOWER_X1, laneB[1]], wb, wt);
  b.wall('tower-wall', [x0, laneA[0]], [x0, laneB[1]], wb, wt);
  b.wall('tower-wall', [TOWER_X1, laneA[0]], [TOWER_X1, laneB[1]], wb, wt);
  b.wall('tower-wall', [xa, laneA[0]], [TOWER_X1, laneA[0]], wb, wt);
  b.wall('tower-wall', [x0, laneA[0]], [xa, laneA[0]], wb, top - 0.12);
  b.wall('tower-wall', [xa, (laneA[1] + laneB[0]) / 2], [xb, (laneA[1] + laneB[0]) / 2], wb, wt, 0.08);
  // Frame posts and visible rails.
  for (const x of [x0, xa, xb, TOWER_X1]) {
    for (const z of [laneA[0], laneB[1]]) b.tube('tower-post', [x, bottom, z], [x, top + 1.2, z], 0.1);
  }
  for (let i = 0; i < flights; i++) {
    const yTop = top - drop * i;
    const yBot = yTop - drop;
    const lane = i % 2 === 0 ? laneA : laneB;
    const [xs, xe] = i % 2 === 0 ? [xb, xa] : [xa, xb];
    for (const z of [lane[0] + 0.04, lane[1] - 0.04]) {
      b.rail('tower-rail', [[xs, yBot, z], [xe, yTop, z]], { collide: false });
    }
  }
  for (let i = 0; i <= flights; i++) {
    const y = top - drop * i;
    const atWest = i % 2 === 0;
    const lx = atWest ? x0 : TOWER_X1;
    if (i === flights) break;
    b.rail('tower-rail', [[lx, y, laneA[0] + (i === 0 ? 0 : 0.04)], [lx, y, laneB[1] - 0.04]], { collide: false });
    b.rail('tower-rail', [[atWest ? x0 : xb, y, laneB[1] - 0.04], [atWest ? xa : TOWER_X1, y, laneB[1] - 0.04]], {
      collide: false,
    });
  }
}

/** Boat landing, swim stair and swim platform at the waterline. */
function waterline(b: LayoutBuilder) {
  const L = LANDING;
  b.boxMinMax('boat-landing', [L.x0, L.top - 0.15, L.z0], [L.x1, L.top, L.z1], 'grating', { surface: 'grating' });
  b.beam('landing-beam', [L.x0, L.top - 0.45, L.z1], [L.x1, L.top - 0.45, L.z1], 0.6, 0.3);
  b.beam('landing-beam', [L.x0, L.top - 0.45, L.z0], [L.x1, L.top - 0.45, L.z0], 0.6, 0.3);
  const sz = SWIM.stair;
  b.rail('landing-rail', [
    [L.x1, L.top, sz.z0],
    [L.x1, L.top, L.z0],
    [L.x0, L.top, L.z0],
    [L.x0, L.top, L.z1],
    [L.x1, L.top, L.z1],
    [L.x1, L.top, sz.z1],
  ]);
  // Support piles and ties back to the south-west leg.
  for (const [x, z] of [
    [L.x0 + 0.5, L.z1 - 0.5],
    [L.x1 - 0.5, L.z1 - 0.5],
    [L.x0 + 0.5, L.z0 + 0.5],
    [L.x1 - 0.5, L.z0 + 0.5],
  ] as const) {
    b.tube('landing-pile', [x, WORLD.seabed - 1, z], [x, L.top - 0.15, z], 0.45);
  }
  b.tube('landing-tie', [LEGS[2][0], L.top - 0.5, LEGS[2][1]], [L.x0 + 0.5, L.top - 0.5, L.z0 + 0.5], 0.3);
  b.tube('landing-tie', [LEGS[2][0], L.top - 0.5, LEGS[2][1]], [L.x1 - 0.5, L.top - 0.5, L.z0 + 0.5], 0.3);
  for (let x = L.x0 + 1; x <= L.x1 - 0.5; x += 2) b.prop('fender', [x, L.top - 2.1, L.z1 + 0.35]);
  b.light('flood', [L.x0 + 1, L.top + 3.2, L.z1 - 0.3], 0xfff4e0, 60, 18);
  b.light('flood', [L.x1 - 1, L.top + 3.2, L.z1 - 0.3], 0xfff4e0, 60, 18);

  // Swim stair down to the platform.
  const zc = (sz.z0 + sz.z1) / 2;
  b.stair('swim-stair', [sz.xBottom, SWIM.top, zc], [sz.xTop, L.top, zc], sz.z1 - sz.z0, 10);
  b.wall('swim-stair-wall', [sz.xTop, sz.z0], [sz.xBottom, sz.z0], SWIM.top, L.top + 1.25);
  b.wall('swim-stair-wall', [sz.xTop, sz.z1], [sz.xBottom, sz.z1], SWIM.top, L.top + 1.25);
  for (const z of [sz.z0 + 0.04, sz.z1 - 0.04]) {
    b.rail('swim-stair-rail', [[sz.xBottom, SWIM.top, z], [sz.xTop, L.top, z]], { collide: false });
  }

  const S = SWIM;
  b.boxMinMax('swim-platform', [S.x0, S.top - 0.2, S.z0], [S.x1, S.top, S.z1], 'teak', { surface: 'wood' });
  b.beam('swim-beam', [S.x0, S.top - 0.45, S.z0 + 0.3], [S.x1, S.top - 0.45, S.z0 + 0.3], 0.5, 0.25);
  b.beam('swim-beam', [S.x0, S.top - 0.45, S.z1 - 0.3], [S.x1, S.top - 0.45, S.z1 - 0.3], 0.5, 0.25);
  for (const [x, z] of [
    [S.x0 + 0.4, S.z1 - 0.4],
    [S.x1 - 0.4, S.z1 - 0.4],
    [S.x1 - 0.4, S.z0 + 0.4],
  ] as const) {
    b.tube('swim-pile', [x, WORLD.seabed - 1, z], [x, S.top - 0.2, z], 0.3);
  }
  b.rail('swim-rail', [
    [S.x0, S.top, sz.z0],
    [S.x0, S.top, S.z0],
    [S.x1, S.top, S.z0],
    [S.x1, S.top, S.z1],
    [S.ladderX[1], S.top, S.z1],
  ]);
  b.rail('swim-rail', [
    [S.ladderX[0], S.top, S.z1],
    [S.x0, S.top, S.z1],
    [S.x0, S.top, sz.z1],
  ]);
  // The ladder gap is closed by a chain (no diving in v1).
  b.wall('swim-chain', [S.ladderX[0], S.z1], [S.ladderX[1], S.z1], S.top, S.top + 1.3);
  b.prop('chain', [(S.ladderX[0] + S.ladderX[1]) / 2, S.top + 0.9, S.z1], {
    size: [S.ladderX[1] - S.ladderX[0], 0, 0],
  });
  b.prop('ladder', [(S.ladderX[0] + S.ladderX[1]) / 2, S.top, S.z1 + 0.15], { size: [0.6, 3.2, 0] });
  b.light('flood', [S.x1 - 0.3, S.top + 2.6, S.z0 + 0.3], 0xfff4e0, 25, 12);
}

/** Glass elevator shaft standing on the boat landing, reaching up past the main deck edge. */
function elevator(b: LayoutBuilder) {
  const E = ELEVATOR;
  const [low, high] = E.stops;
  const top = E.head - 0.35;
  const t = 0.03;
  const glass = (min: Vec3, max: Vec3) => b.boxMinMax('elevator-shaft', min, max, 'glassThin', { surface: 'metal' });
  glass([E.x0 - t, low, E.z0], [E.x0 + t, top, E.z1]);
  glass([E.x1 - t, low, E.z0], [E.x1 + t, top, E.z1]);
  glass([E.x0, low, E.z1 - t], [E.x1, top, E.z1 + t]);
  // North face: door openings at both stops.
  glass([E.x0, low, E.z0 - t], [E.door.x0, top, E.z0 + t]);
  glass([E.door.x1, low, E.z0 - t], [E.x1, top, E.z0 + t]);
  glass([E.door.x0, low + E.door.height, E.z0 - t], [E.door.x1, high, E.z0 + t]);
  glass([E.door.x0, high + E.door.height, E.z0 - t], [E.door.x1, top, E.z0 + t]);
  // Head with the machinery, corner posts and frame rings.
  b.boxMinMax('elevator-head', [E.x0 - 0.12, top, E.z0 - 0.12], [E.x1 + 0.12, E.head, E.z1 + 0.12], 'mullion', { surface: 'metal' });
  for (const x of [E.x0, E.x1]) for (const z of [E.z0, E.z1]) b.tube('elevator-post', [x, low - 0.15, z], [x, top, z], 0.075, 'mullion', { collide: true });
  const ring = (yy: number, h = 0.08) => {
    b.boxMinMax('elevator-frame', [E.x0 - 0.06, yy, E.z0 - 0.06], [E.x1 + 0.06, yy + h, E.z0 + 0.06], 'mullion', { collide: false });
    b.boxMinMax('elevator-frame', [E.x0 - 0.06, yy, E.z1 - 0.06], [E.x1 + 0.06, yy + h, E.z1 + 0.06], 'mullion', { collide: false });
    b.boxMinMax('elevator-frame', [E.x0 - 0.06, yy, E.z0], [E.x0 + 0.06, yy + h, E.z1], 'mullion', { collide: false });
    b.boxMinMax('elevator-frame', [E.x1 - 0.06, yy, E.z0], [E.x1 + 0.06, yy + h, E.z1], 'mullion', { collide: false });
  };
  for (let yy = low + E.door.height; yy < top - 0.5; yy += 2.9) ring(yy);
  ring(high + E.door.height);
  // Door surrounds at both stops.
  for (const sy of E.stops) {
    b.boxMinMax('elevator-frame', [E.door.x0 - 0.1, sy, E.z0 - 0.09], [E.door.x0, sy + E.door.height + 0.1, E.z0 + 0.05], 'mullion', { collide: false });
    b.boxMinMax('elevator-frame', [E.door.x1, sy, E.z0 - 0.09], [E.door.x1 + 0.1, sy + E.door.height + 0.1, E.z0 + 0.05], 'mullion', { collide: false });
    b.boxMinMax('elevator-frame', [E.door.x0 - 0.1, sy + E.door.height, E.z0 - 0.09], [E.door.x1 + 0.1, sy + E.door.height + 0.12, E.z0 + 0.05], 'mullion', { collide: false });
  }
  // Bridge from the deck edge to the top door, with guards at its sides.
  b.boxMinMax('elevator-bridge', [E.door.x0, high - 0.1, DECK.z1 - 0.15], [E.door.x1, high, E.z0], 'grating', { surface: 'grating' });
  for (const x of [E.door.x0, E.door.x1]) {
    b.wall('elevator-guard', [x, DECK.z1], [x, E.z0], high, high + 1.25);
    b.rail('elevator-rail', [[x, high, DECK.z1], [x, high, E.z0 - 0.05]], { collide: false });
  }
  // Brackets tying the shaft back to the deck edge beam.
  for (const x of [E.x0 + 0.1, E.x1 - 0.1]) b.beam('elevator-bracket', [x, high - 0.45, DECK.z1 - 0.2], [x, high - 0.45, E.z0], 0.3, 0.2, 'steelDark');
  b.light('bulkhead', [(E.door.x0 + E.door.x1) / 2, low + 2.6, E.z0 - 0.25], 0xffedd0, 8, 6);
}

/** Helideck on the east cantilever: deck, framing, nets, lights and windsock. */
function helipad(b: LayoutBuilder) {
  const H = HELIPAD;
  b.boxMinMax('helideck', [H.x0, H.top - 0.25, H.z0], [H.x1, H.top, H.z1], 'helideck', { surface: 'hollow' });
  b.boxMinMax('bridge', [BRIDGE.x0, DECK.top - 0.1, BRIDGE.z0], [BRIDGE.x1, DECK.top, BRIDGE.z1], 'grating', {
    surface: 'grating',
  });
  b.rail('bridge-rail', [[BRIDGE.x0, DECK.top, BRIDGE.z0], [BRIDGE.x1, DECK.top, BRIDGE.z0]]);
  b.rail('bridge-rail', [[BRIDGE.x0, DECK.top, BRIDGE.z1], [BRIDGE.x1, DECK.top, BRIDGE.z1]]);
  const by = H.top - 0.25 - 0.4;
  for (const z of [-10, -5, 0, 5, 10]) b.beam('helideck-beam', [21, by, z], [H.x1, by, z], 0.8, 0.35);
  for (let x = H.x0; x <= H.x1; x += 5) b.beam('helideck-beam', [x, by, H.z0], [x, by, H.z1], 0.8, 0.3);
  for (const [lx, lz] of LEGS.filter(([x]) => x > 0)) {
    const zt = sign(lz) * 9.5;
    b.tube('helideck-strut', [lx, 4, lz], [40, by - 0.3, zt], 0.35);
    b.tube('helideck-strut', [lx, 4, lz], [50, by - 0.3, zt], 0.3);
  }
  // Safety nets (walkable shelf) with an outer stop.
  const n = H.net;
  const ny = H.top - 0.08;
  const shelves: Rect[] = [
    { x0: H.x0, x1: H.x1, z0: H.z0 - n, z1: H.z0 },
    { x0: H.x0, x1: H.x1, z0: H.z1, z1: H.z1 + n },
    { x0: H.x1, x1: H.x1 + n, z0: H.z0 - n, z1: H.z1 + n },
    { x0: H.x0 - n, x1: H.x0, z0: H.z0 - n, z1: BRIDGE.z0 },
    { x0: H.x0 - n, x1: H.x0, z0: BRIDGE.z1, z1: H.z1 + n },
  ];
  for (const r of shelves) b.boxMinMax('safety-net', [r.x0, ny - 0.04, r.z0], [r.x1, ny, r.z1], 'net', { surface: 'grating' });
  const ox0 = H.x0 - n;
  const ox1 = H.x1 + n;
  const oz0 = H.z0 - n;
  const oz1 = H.z1 + n;
  b.wall('net-stop', [ox0, oz0], [ox1, oz0], ny, ny + 1.2);
  b.wall('net-stop', [ox0, oz1], [ox1, oz1], ny, ny + 1.2);
  b.wall('net-stop', [ox1, oz0], [ox1, oz1], ny, ny + 1.2);
  b.wall('net-stop', [ox0, oz0], [ox0, BRIDGE.z0], ny, ny + 1.2);
  b.wall('net-stop', [ox0, BRIDGE.z1], [ox0, oz1], ny, ny + 1.2);
  // Net frame tubes.
  b.tube('net-frame', [ox0, ny, oz0], [ox1, ny, oz0], 0.04, 'steelGrey');
  b.tube('net-frame', [ox0, ny, oz1], [ox1, ny, oz1], 0.04, 'steelGrey');
  b.tube('net-frame', [ox1, ny, oz0], [ox1, ny, oz1], 0.04, 'steelGrey');
  b.tube('net-frame', [ox0, ny, oz0], [ox0, ny, BRIDGE.z0], 0.04, 'steelGrey');
  b.tube('net-frame', [ox0, ny, BRIDGE.z1], [ox0, ny, oz1], 0.04, 'steelGrey');

  // Green perimeter lights (emissive) with a few real lights for spill.
  const edgeLights: Vec3[] = [];
  for (let x = H.x0; x <= H.x1 + 1e-6; x += 2.5) {
    edgeLights.push([x, H.top, H.z0 + 0.15], [x, H.top, H.z1 - 0.15]);
  }
  for (let z = H.z0 + 2.5; z <= H.z1 - 2.5 + 1e-6; z += 2.5) {
    edgeLights.push([H.x1 - 0.15, H.top, z]);
    if (z < BRIDGE.z0 - 0.5 || z > BRIDGE.z1 + 0.5) edgeLights.push([H.x0 + 0.15, H.top, z]);
  }
  for (const p of edgeLights) b.prop('helipadLight', p);
  for (const [x, z] of [
    [H.x0 + 0.5, H.z0 + 0.5],
    [H.x1 - 0.5, H.z0 + 0.5],
    [H.x0 + 0.5, H.z1 - 0.5],
    [H.x1 - 0.5, H.z1 - 0.5],
  ] as const) {
    b.light('helipadEdge', [x, H.top + 0.3, z], 0x30ff60, 6, 8);
  }
  for (const [x, z, rot] of [
    [ox0 + 0.3, oz0 + 0.3, Math.PI * 0.25],
    [ox1 - 0.3, oz0 + 0.3, Math.PI * 0.75],
    [ox1 - 0.3, oz1 - 0.3, Math.PI * 1.25],
    [ox0 + 0.3, oz1 - 0.3, Math.PI * 1.75],
  ] as const) {
    b.prop('flood', [x, ny, z], { rotationY: rot });
    b.light('flood', [x, ny + 0.6, z], 0xfff8ee, 120, 26);
  }
  // Windsock on the north-east corner, with an obstruction light on top.
  const ws: Vec3 = [ox1 - 0.2, ny, oz0 + 0.2];
  b.tube('windsock-pole', ws, [ws[0], ws[1] + 4.5, ws[2]], 0.06, 'steelGrey');
  b.prop('windsock', [ws[0], ws[1] + 4.4, ws[2]]);
  b.light('obstruction', [ws[0], ws[1] + 4.7, ws[2]], 0xff2010, 4, 6);
}

export function buildRig(b: LayoutBuilder) {
  jacket(b);
  lowerLevel(b);
  mainDeck(b);
  northStair(b);
  stairTower(b);
  waterline(b);
  elevator(b);
  helipad(b);
  void RAIL_HEIGHT;
}
