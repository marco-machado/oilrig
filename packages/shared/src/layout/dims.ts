import type { Rect } from './types.ts';

// All key dimensions in one place. Proportions follow the reference image,
// with the main deck enlarged to 60 x 40 m.

export const DECK = { x0: -30, x1: 30, z0: -20, z1: 20, top: 20, thickness: 0.1 } as const;
export const GIRDER = { depth: 1.0, width: 0.5 } as const;
export const LEGS: ReadonlyArray<readonly [number, number]> = [
  [-21, -13],
  [21, -13],
  [-21, 13],
  [21, 13],
];
export const LEG_RADIUS = 1.25;
export const LEG_TOP = 18.9;
export const PILE_TOP = -21;
export const JACKET_LEVELS = [-2, -14, -27] as const;
export const SECONDARY_COLUMN_INSET = 3.5;

export const LOWER = {
  top: 16,
  outer: { x0: -26, x1: 26, z0: -19, z1: 18 } as Rect,
  inner: { x0: -23, x1: 23, z0: -14.8, z1: 15 } as Rect,
} as const;

export const PAVILION = {
  x0: -24,
  x1: 8,
  z0: -12,
  z1: 2,
  floor: 20.12,
  height: 3.2,
  roofThickness: 0.4,
  overhang: 2,
} as const;

export const POOL = { x0: 10, x1: 20, z0: -10, z1: -6, water: 19.95, floor: 18.6 } as const;
export const TERRACE = { x0: -28, x1: 27, z0: -14.5, z1: 16, top: 20.05 } as const;

export const NORTH_STAIR = {
  xTop: 2.2,
  xBottom: -3.2,
  z0: -18.9,
  z1: -17.7,
  opening: { x0: -3.5, x1: 2.2, z0: -18.9, z1: -17.7 } as Rect,
} as const;

export const HELIPAD = { x0: 32, x1: 52, z0: -10, z1: 10, top: 20, net: 1.5 } as const;
export const BRIDGE = { x0: 30, x1: 32, z0: -3, z1: 3 } as const;

export const TOWER = {
  x0: -20,
  landing: 1.2,
  run: 3.51,
  laneA: [18.1, 19.3] as const,
  laneB: [19.4, 20.6] as const,
  top: 16,
  bottom: 3,
  flights: 5,
} as const;
export const TOWER_X1 = TOWER.x0 + TOWER.landing * 2 + TOWER.run;

export const LANDING = { x0: -22, x1: -10, z0: 18, z1: 23, top: 3 } as const;
export const SWIM = {
  x0: -7.5,
  x1: -2.5,
  z0: 19.5,
  z1: 22.5,
  top: 1.2,
  ladderX: [-5.6, -4.4] as const,
  stair: { xTop: -10, xBottom: -7.5, z0: 20.4, z1: 21.6 },
} as const;

export const RAIL_HEIGHT = 1.1;
/**
 * Colliding rails block this far above the handrail, so a jump plus an auto-step can't clear
 * them. The client draws the band as a glass strip with a slim cap.
 */
export const RAIL_GUARD = 0.3;

/**
 * The platform's passenger drone: a four-seat electric quadcopter with ducted rotors.
 * Body frame: x right, y up from the skids, z towards the tail (nose at -z).
 */
export const DRONE = {
  pad: [42, 20, 0] as const,
  /**
   * Duct (rotor) centres in the body frame: (±armX, ductY, ±armZ). Nothing on the ducts hangs
   * below 2.61 (the motors), clear of the top of a jump (1.80 + 0.76): people walk and jump under them.
   */
  armX: 2.9,
  armZ: 2.7,
  ductY: 2.8,
  ductRadius: 1.15,
  blades: 3,
  /** Propeller revolutions per second at hover rpm. */
  rotorHz: 26,
  /** Nobody may stand this close to the pad centre while it lands. */
  clearRadius: 7,
  /** Seats in the body frame (cushion top): pilot front left, then front right, rear left, rear right. */
  seats: [
    [-0.47, 0.95, -0.42],
    [0.47, 0.95, -0.42],
    [-0.47, 0.95, 0.62],
    [0.47, 0.95, 0.62],
  ] as ReadonlyArray<readonly [number, number, number]>,
  /** Eye height above the seat cushion. */
  seatedEye: 0.78,
  /** Flight envelope (pilot input). */
  maxSpeed: 24,
  maxClimb: 6,
  maxDescent: 4.5,
  maxYawRate: 1.4,
  /** Lowest the skids may go over open water. */
  minSeaAltitude: 1.5,
  maxAltitude: 600,
} as const;

/**
 * Panoramic glass elevator on the south side, from the boat landing up to the main deck.
 * The shaft stands on the landing; its door faces north at both stops.
 */
export const ELEVATOR = {
  x0: -13.4,
  x1: -11.2,
  z0: 20.4,
  z1: 22.4,
  /** Floor height of each stop: the boat landing, the main deck. */
  stops: [3, 20] as const,
  stopNames: ['Boat landing', 'Main deck'] as const,
  door: { x0: -13.0, x1: -11.6, height: 2.2 },
  head: 23.1,
  speed: 2.0,
  accel: 0.8,
  doorMs: 1600,
  /** Doors stay open at least this long after arriving. */
  dwellMs: 3000,
} as const;

/**
 * The tender moored along the south edge of the boat landing, its tube against the fenders.
 * Beam is the hull's; the inflatable tube adds 0.29 a side (2.38 overall). Freeboard is the
 * height of the hull side amidships, under the tube (whose top is 0.29 higher).
 */
export const TENDER = { x: -15.5, z: 24.8, length: 5.6, beam: 1.8, freeboard: 0.55 } as const;
