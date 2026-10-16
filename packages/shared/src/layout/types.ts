export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

export type MaterialId =
  | 'steelYellow'
  | 'steelDark'
  | 'steelGrey'
  | 'grating'
  | 'net'
  | 'teak'
  | 'concrete'
  | 'plaster'
  | 'mullion'
  | 'glass'
  | 'glassFrosted'
  | 'helideck'
  | 'rubber'
  | 'poolTile'
  | 'corten'
  | 'soil'
  | 'lamp'
  | 'fabric'
  | 'oak'
  | 'stone';

/** Footstep / interaction class of a walkable surface. */
export type Surface = 'metal' | 'grating' | 'wood' | 'stone' | 'tile' | 'hollow' | 'soft';

interface ElementBase {
  id: string;
  /** Semantic kind, e.g. "leg", "brace", "deck", "glass-wall". Used by v2 perception. */
  kind: string;
  material: MaterialId;
  /** Whether the element produces a physics collider. */
  collide: boolean;
  /** Whether the element is drawn. Hull colliders are usually invisible. */
  render: boolean;
  surface?: Surface;
  /** Semantic object (e.g. a furniture id) this element belongs to, when it is part of one. */
  object?: string;
}

export interface TubeElement extends ElementBase {
  type: 'tube';
  a: Vec3;
  b: Vec3;
  radius: number;
}

export interface BoxElement extends ElementBase {
  type: 'box';
  center: Vec3;
  size: Vec3;
  rotation?: Quat;
}

/** I-beam along a→b (centre line), web vertical. */
export interface BeamElement extends ElementBase {
  type: 'ibeam';
  a: Vec3;
  b: Vec3;
  depth: number;
  width: number;
}

/** Straight stair flight; `bottom`/`top` are centre points on the walking line. */
export interface StairElement extends ElementBase {
  type: 'stair';
  bottom: Vec3;
  top: Vec3;
  width: number;
  risers: number;
}

/** Handrail along a polyline at walking-surface height. */
export interface RailElement extends ElementBase {
  type: 'rail';
  points: Vec3[];
  height: number;
}

/** Convex hull collider (no render). */
export interface HullElement extends ElementBase {
  type: 'hull';
  points: Vec3[];
}

export type Element =
  | TubeElement
  | BoxElement
  | BeamElement
  | StairElement
  | RailElement
  | HullElement;

export interface DoorDef {
  id: string;
  name: string;
  /** Closed panel box (centre, size). */
  center: Vec3;
  size: Vec3;
  /** Offset applied to the panel when fully open. */
  openOffset: Vec3;
}

export interface ZoneDef {
  id: string;
  kind: 'indoor' | 'pool' | 'helipad';
  min: Vec3;
  max: Vec3;
}

export type LightKind =
  | 'downlight'
  | 'deckLamp'
  | 'bulkhead'
  | 'flood'
  | 'helipadEdge'
  | 'obstruction'
  | 'poolLight';

export interface LightDef {
  id: string;
  kind: LightKind;
  position: Vec3;
  color: number;
  /** Luminous intensity in candela-like renderer units. */
  intensity: number;
  distance: number;
  /** Whether a real point light is created (otherwise only the emissive fixture). */
  casts: boolean;
}

export interface PlaceDef {
  id: string;
  name: string;
  /** Standing position (feet). */
  position: Vec3;
}

export type PropKind = 'grass' | 'windsock' | 'ladder' | 'chain' | 'fender' | 'bollard' | 'helipadLight' | 'flood';

/** Client-only procedural decoration with no physics. */
export interface PropDef {
  id: string;
  kind: PropKind;
  position: Vec3;
  /** Kind-specific size, e.g. the planter bed extent for grass. */
  size?: Vec3;
  rotationY?: number;
}

export type FurnitureKind =
  | 'sofa'
  | 'coffee-table'
  | 'rug'
  | 'dining-table'
  | 'dining-chair'
  | 'kitchen-island'
  | 'kitchen-counter'
  | 'bar-stool'
  | 'bed'
  | 'nightstand'
  | 'bathtub'
  | 'outdoor-sofa'
  | 'firepit'
  | 'sun-lounger'
  | 'hammock-net';

/**
 * A piece of furniture. `position` is the centre of the footprint at floor level; `size` is
 * width (local x), height and depth (local z). The front faces local +z, turned by
 * `rotationY` (counter-clockwise seen from above, like every yaw in the layout).
 */
export interface FurnitureDef {
  id: string;
  kind: FurnitureKind;
  name: string;
  position: Vec3;
  size: Vec3;
  rotationY: number;
}

/** Something that floats or flies and is drawn by the client (no static collider). */
export interface VesselDef {
  id: string;
  kind: 'boat';
  name: string;
  /** Mooring position at sea level. */
  position: Vec3;
  /** Hull length, beam, freeboard. */
  size: Vec3;
  rotationY: number;
}

export interface Layout {
  elements: Element[];
  props: PropDef[];
  furniture: FurnitureDef[];
  vessels: VesselDef[];
  doors: DoorDef[];
  zones: ZoneDef[];
  lights: LightDef[];
  places: PlaceDef[];
  spawn: { position: Vec3; yaw: number };
  respawn: { position: Vec3; yaw: number };
}

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}
