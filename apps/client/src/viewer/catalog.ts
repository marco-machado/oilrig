import { Box3, BoxGeometry, Group, Mesh, MeshStandardNodeMaterial, type Object3D } from 'three/webgpu';
import {
  DIMS,
  type DoorDef,
  type DronePose,
  type Element,
  type ElevatorPose,
  type FurnitureDef,
  type FurnitureKind,
  type Layout,
  type LightDef,
  type LightKind,
  NET,
  PLAYER,
  type PlayerInfo,
  type PropDef,
  type PropKind,
  type Vec3,
  getLayout,
} from '@ocean-home/shared';
import { Avatars } from '../net/avatars.ts';
import { QUALITY, type QualityName } from '../render/quality.ts';
import { U } from '../state.ts';
import { Doors } from '../world/doors.ts';
import { Drone } from '../world/drone.ts';
import { ElevatorView } from '../world/elevator.ts';
import { buildFurniture } from '../world/furniture.ts';
import { buildLights } from '../world/lights.ts';
import type { MaterialSet } from '../world/materials/index.ts';
import { buildProps } from '../world/props.ts';
import { buildStructure } from '../world/structure.ts';
import { buildTenderHull } from '../world/tender.ts';

// Every object the client builds, made with the game's own builders and moved to the
// origin: footprint centred on (0, 0), floor at y = 0. Furniture, props, doors and light
// fixtures come from the shared layout, so a new instance or size shows up here by itself.

export const CATEGORIES = ['Vehicles', 'People', 'Furniture', 'Fittings', 'Props', 'Light fixtures'] as const;
export type Category = (typeof CATEGORIES)[number];

/** A setter may ask the viewer to measure and frame the object again (its size changed). */
type Setter<T> = (v: T) => void | 'reframe';

export type Control =
  | { type: 'range'; label: string; min: number; max: number; step: number; value: number; format?: (v: number) => string; set: Setter<number> }
  | { type: 'toggle'; label: string; value: boolean; set: Setter<boolean> }
  | { type: 'select'; label: string; options: Array<[string, string]>; value: string; set: Setter<string> }
  | { type: 'color'; label: string; value: string; set: Setter<string> }
  | { type: 'text'; label: string; value: string; action: string; set: Setter<string> };

export interface Built {
  root: Group;
  controls: Control[];
  update?(dt: number, time: number): void;
}

export interface Entry {
  id: string;
  name: string;
  category: Category;
  about: string;
  /** Where the builder lives. */
  source: string;
  /** Instance ids in the layout, or a sentence when the game makes them at run time. */
  inWorld: string[] | string;
  /** Camera framing: a point to look at, a minimum radius, and the side to look from. */
  view?: { target?: Vec3; radius?: number; dir?: Vec3 };
  build(materials: MaterialSet): Built;
}

const layout = getLayout();

const EMPTY: Layout = {
  elements: [],
  props: [],
  furniture: [],
  vessels: [],
  doors: [],
  zones: [],
  lights: [],
  places: [],
  spawn: { position: [0, 0, 0], yaw: 0 },
  respawn: { position: [0, 0, 0], yaw: 0 },
};
const only = (part: Partial<Layout>): Layout => ({ ...EMPTY, ...part });
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const metres = (v: number) => `${+v.toFixed(2)} m`;

function disposeGeometry(o: Object3D) {
  o.traverse((c) => (c as Mesh).geometry?.dispose());
}

/** The distinct sizes among instances, with the ids that share each. */
function variants<T extends { id: string }>(defs: T[], key: (d: T) => string) {
  const out = new Map<string, T[]>();
  for (const d of defs) out.set(key(d), [...(out.get(key(d)) ?? []), d]);
  return [...out.values()];
}

/** Swaps the content of a root group when a variant is picked. */
function swapper<T>(root: Group, make: (v: T) => Object3D) {
  let current: Object3D | null = null;
  return (v: T) => {
    if (current) {
      root.remove(current);
      disposeGeometry(current);
    }
    current = make(v);
    root.add(current);
  };
}

// ---------------------------------------------------------------- vehicles

const drone: Entry = {
  id: 'drone',
  name: 'Passenger drone',
  category: 'Vehicles',
  about:
    'Four-seat electric quadcopter: pearl-white pod with a wrap-around canopy, ducted rotors on carbon arms, skids, a cabin with a dashboard and side stick, and navigation lights and a strobe.',
  source: 'apps/client/src/world/drone.ts',
  inWorld: 'One, based on the helipad. Anyone can fly it; now and then it flies off on its own.',
  view: { dir: [-1, 0.55, -1.25] },
  build() {
    const d = new Drone();
    const root = new Group();
    root.add(d.group);
    const state = { rotor: 0, height: 0, occupied: false };
    const pose = (): DronePose => ({
      visible: true,
      position: [0, state.height, 0],
      velocity: [0, 0, 0],
      yaw: 0,
      pitch: 0,
      roll: 0,
      rotor: state.rotor,
      altitude: state.height,
    });
    return {
      root,
      update: (dt) => d.update(pose(), dt, 0, state.occupied),
      controls: [
        {
          type: 'range',
          label: 'Rotor speed',
          min: 0,
          max: 1,
          step: 0.01,
          value: 0,
          format: (v) => (v === 0 ? 'parked' : `${Math.round(v * 100)}% of hover`),
          set: (v) => void (state.rotor = v),
        },
        { type: 'range', label: 'Height', min: 0, max: 4, step: 0.05, value: 0, format: metres, set: (v) => void (state.height = v) },
        { type: 'toggle', label: 'Someone aboard (screens, cabin light)', value: false, set: (v) => void (state.occupied = v) },
      ],
    };
  },
};

const tender: Entry = {
  id: 'tender',
  name: 'Tender',
  category: 'Vehicles',
  about:
    'Rigid-inflatable boat: white hull with a grey collar, a teak deck, a centre console with a windscreen, a bench and an outboard. In the game it rides the ocean waves at the boat landing, on mooring lines.',
  source: 'apps/client/src/world/tender.ts',
  inWorld: layout.vessels.map((v) => v.id),
  view: { dir: [-1, 0.5, -1.2] },
  build(m) {
    const root = new Group();
    const hull = buildTenderHull(layout.vessels[0], m);
    // Waterline at y = 0 in the game: lift the keel onto the floor.
    hull.position.y = -new Box3().setFromObject(hull).min.y;
    root.add(hull);
    return { root, controls: [] };
  },
};

// ---------------------------------------------------------------- people

const avatar: Entry = {
  id: 'avatar',
  name: 'Avatar',
  category: 'People',
  about:
    'The figure everyone else sees you as: capsule body and limbs with a walk cycle, a name tag and a chat bubble. AI agents look the same, with an AI badge on the tag. Seated is the pose aboard the drone.',
  source: 'apps/client/src/net/avatars.ts',
  inWorld: 'One for each other person or AI agent aboard.',
  view: { dir: [-0.9, 0.35, -1.4], radius: 1.3 },
  build() {
    const root = new Group();
    const avatars = new Avatars();
    root.add(avatars.group);
    let info: PlayerInfo = { id: 'viewer', name: 'Robin', color: '#3a8fb7', kind: 'human' };
    avatars.add(info);
    const reset = (next: Partial<PlayerInfo>) => {
      avatars.remove(info.id);
      info = { ...info, ...next };
      avatars.add(info);
    };
    // A plain block to sit on, at seat height and only under the hips (the thighs slope down from there).
    const seat = new Mesh(new BoxGeometry(0.5, 0.45, 0.4).translate(0, 0.225, 0.05), new MeshStandardNodeMaterial({ color: 0x3a3f46, roughness: 0.75 }));
    seat.castShadow = seat.receiveShadow = true;
    seat.visible = false;
    root.add(seat);
    let pose = 'stand';
    const speeds: Record<string, number> = { stand: 0, walk: PLAYER.walkSpeed, run: PLAYER.runSpeed, seat: 0 };
    return {
      root,
      update(dt) {
        const now = performance.now();
        avatars.snapshot(now, [{ id: info.id, p: [0, 0, 0], yaw: 0, pitch: 0, speed: speeds[pose], grounded: true }]);
        const seated = pose === 'seat' ? new Map([[info.id, { position: [0, 0.45, 0] as Vec3, yaw: 0 }]]) : undefined;
        avatars.update(now + NET.interpolationDelayMs, dt, seated);
        seat.visible = pose === 'seat';
      },
      controls: [
        {
          type: 'select',
          label: 'Pose',
          options: [
            ['stand', 'Standing'],
            ['walk', 'Walking'],
            ['run', 'Running'],
            ['seat', 'Seated'],
          ],
          value: pose,
          set: (v) => void (pose = v),
        },
        {
          type: 'select',
          label: 'Who',
          options: [
            ['human', 'Person'],
            ['agent', 'AI agent'],
          ],
          value: 'human',
          set: (v) => reset({ kind: v as PlayerInfo['kind'] }),
        },
        { type: 'text', label: 'Name', value: info.name, action: 'Set', set: (v) => reset({ name: v.trim() || 'Someone' }) },
        { type: 'color', label: 'Shirt', value: info.color, set: (v) => reset({ color: v }) },
        { type: 'text', label: 'Chat bubble', value: 'Hello from the deck!', action: 'Say', set: (v) => avatars.say(info.id, v) },
      ],
    };
  },
};

// ---------------------------------------------------------------- furniture

const FURNITURE: Record<FurnitureKind, { name: string; about: string }> = {
  'outdoor-sofa': { name: 'Outdoor sofa', about: 'Teak frame with slatted arms and a backboard, and loose seat and back cushions (one pair per 85 cm or so of width).' },
  firepit: { name: 'Firepit', about: 'Travertine drum with a steel rim, glowing embers and flames. It lights the lounge at night.' },
  'sun-lounger': { name: 'Sun lounger', about: 'Teak slats on a low frame, with a thin cushion and a raised backrest at the head.' },
  'hammock-net': { name: 'Hammock net', about: 'Knotted rope net slung between steel posts and spreader bars, sagging towards the middle.' },
};

function furnitureEntry(kind: FurnitureKind): Entry {
  const defs = layout.furniture.filter((f) => f.kind === kind);
  const sizes = variants(defs, (f) => f.size.join('×'));
  return {
    id: kind,
    name: FURNITURE[kind].name,
    category: 'Furniture',
    about: FURNITURE[kind].about,
    source: 'apps/client/src/world/furniture.ts',
    inWorld: defs.map((f) => f.id),
    build(m) {
      const root = new Group();
      let fire: ((t: number) => void) | null = null;
      const show = swapper<FurnitureDef>(root, (f) => {
        const built = buildFurniture(only({ furniture: [{ ...f, position: [0, 0, 0], rotationY: 0 }] }), m);
        fire = built.update;
        return built.group;
      });
      show(sizes[0][0]);
      return {
        root,
        update: (_dt, t) => fire?.(t),
        controls:
          sizes.length > 1
            ? [
                {
                  type: 'select',
                  label: 'Size',
                  options: sizes.map((s, i) => [String(i), `${+s[0].size[0].toFixed(2)} × ${+s[0].size[2].toFixed(2)} m (${s.map((f) => f.id).join(', ')})`]),
                  value: '0',
                  set: (v) => {
                    show(sizes[Number(v)][0]);
                    return 'reframe';
                  },
                },
              ]
            : [],
      };
    },
  };
}

// ---------------------------------------------------------------- fittings

const doors: Entry = (() => {
  const sizes = variants(layout.doors, (d) => d.size.join('×'));
  return {
    id: 'door',
    name: 'Sliding glass door',
    category: 'Fittings',
    about:
      'Glass panel in a bronze frame with etched safety bands and long pull handles, a lit header, a steel sill and a mat outside. It slides open along the facade; the frame warms up when you look at it.',
    source: 'apps/client/src/world/doors.ts',
    inWorld: layout.doors.map((d) => d.id),
    build(m) {
      const root = new Group();
      let view: Doors | null = null;
      let def: DoorDef | null = null;
      const state = { open: false, focus: false };
      const show = swapper<DoorDef>(root, (d) => {
        // The floor inside the doorway sits 7 cm above the deck outside (where the mat lies).
        def = { ...d, center: [0, d.size[1] / 2 + 0.02 + 0.07, 0] };
        view = new Doors(only({ doors: [def] }), m, { setDoorOpen() {} });
        view.setOpen(def.id, state.open);
        return view.group;
      });
      show(sizes[0][0]);
      return {
        root,
        update(dt) {
          view?.setFocus(state.focus ? def!.id : null);
          view?.update(dt);
        },
        controls: [
          {
            type: 'toggle',
            label: 'Open',
            value: false,
            set: (v) => {
              state.open = v;
              view?.setOpen(def!.id, v);
            },
          },
          { type: 'toggle', label: 'Looked at (frame glows)', value: false, set: (v) => void (state.focus = v) },
          ...(sizes.length > 1
            ? [
                {
                  type: 'select' as const,
                  label: 'Size',
                  options: sizes.map((s, i): [string, string] => [String(i), `${+Math.max(s[0].size[0], s[0].size[2]).toFixed(2)} × ${+s[0].size[1].toFixed(2)} m (${s.map((d) => d.name).join(', ')})`]),
                  value: '0',
                  set: (v: string) => {
                    show(sizes[Number(v)][0]);
                    return 'reframe' as const;
                  },
                },
              ]
            : []),
        ],
      };
    },
  };
})();

const elevator: Entry = {
  id: 'elevator',
  name: 'Elevator car',
  category: 'Fittings',
  about:
    'The glass elevator’s moving parts: a car with a stone floor, bronze frame and handrails, a ceiling lamp and a button panel, plus the two-leaf landing doors and the call button at the stop. The shaft is part of the platform structure.',
  source: 'apps/client/src/world/elevator.ts',
  inWorld: `One, from the boat landing (${DIMS.ELEVATOR.stops[0]} m) to the main deck (${DIMS.ELEVATOR.stops[1]} m).`,
  view: { dir: [0.8, 0.45, -1.3] },
  build(m) {
    const E = DIMS.ELEVATOR;
    const lift = new ElevatorView(m);
    const root = new Group();
    const shift = new Group();
    // The car's floor slab hangs below its floor level: stand it on the ground.
    shift.position.set(-(E.x0 + E.x1) / 2, -E.stops[0] + 0.12, -(E.z0 + E.z1) / 2);
    shift.add(lift.group);
    root.add(shift);
    const state = { doors: 0, calling: false, travel: false };
    const pose = (): ElevatorPose => ({
      y: E.stops[0],
      vy: 0,
      doors: state.travel ? 0 : state.doors,
      phase: state.travel ? 'travel' : state.doors >= 1 ? 'open' : 'opening',
      stop: state.travel ? null : 0,
      openSince: 0,
    });
    lift.update(pose(), null);
    // Show the lower stop only: hide the doors and button of the deck stop, 17 m up.
    root.updateMatrixWorld(true);
    for (const c of lift.group.children) if (new Box3().setFromObject(c).min.y > 10) c.visible = false;
    return {
      root,
      update: () => lift.update(pose(), state.calling ? 0 : null),
      controls: [
        { type: 'range', label: 'Doors', min: 0, max: 1, step: 0.01, value: 0, format: (v) => (v === 0 ? 'closed' : v === 1 ? 'open' : `${Math.round(v * 100)}%`), set: (v) => void (state.doors = v) },
        { type: 'toggle', label: 'Called (button lit)', value: false, set: (v) => void (state.calling = v) },
        { type: 'toggle', label: 'Travelling (car panel lit)', value: false, set: (v) => void (state.travel = v) },
      ],
    };
  },
};

// ---------------------------------------------------------------- props

interface PropInfo {
  name: string;
  about: string;
  /** Height of the prop's anchor in the viewer, so it stands on (or hangs to) the floor. */
  y: (p: PropDef) => number;
  /** The real light that goes with it in the layout (the nearest of this kind). */
  light?: LightKind;
  /** Kind of the layout elements that hold it up. */
  mount?: string;
}

const PROPS: Record<PropKind, PropInfo> = {
  grass: { name: 'Planter grass', about: 'Ornamental grass in the terrace planters, on a bed of soil. The blades sway with the wind.', y: () => 0.04 },
  windsock: {
    name: 'Windsock',
    about: 'Striped sock on a pole at the helipad corner. It turns with the wind and lifts as it strengthens; a red obstruction light blinks on top.',
    y: () => 4.4,
    light: 'obstruction',
    mount: 'windsock-pole',
  },
  ladder: { name: 'Swim ladder', about: 'Steel ladder hanging off the swim platform into the sea.', y: (p) => p.size?.[1] ?? 3 },
  chain: { name: 'Safety chain', about: 'Sagging chain across the ladder opening of the swim platform, hung 0.9 m above the deck as in the game.', y: () => 0.9 },
  fender: { name: 'Fender', about: 'Rubber fender along the edge of the boat landing.', y: () => 0.9 },
  bollard: { name: 'Bollard lamp', about: 'Low lamp posts along the terrace paths. The band under the cap glows at night and lights the deck around it.', y: () => 0, light: 'deckLamp' },
  helipadLight: { name: 'Helipad edge light', about: 'Green dome lights round the helipad: dim by day, bright at night. A few real lights spill green on the deck.', y: () => 0, light: 'helipadEdge' },
  flood: { name: 'Floodlight', about: 'Lamp head on a short post at the helipad corners, aimed across the deck.', y: () => 0, light: 'flood' },
};

function propEntry(kind: PropKind): Entry {
  const info = PROPS[kind];
  const defs = layout.props.filter((p) => p.kind === kind);
  const first = defs[0];
  return {
    id: `prop-${kind}`,
    name: info.name,
    category: 'Props',
    about: info.about,
    source: ['apps/client/src/world/props.ts', ...(info.light ? ['lights.ts'] : []), ...(info.mount ? ['structure.ts'] : [])].join(', '),
    inWorld: defs.map((p) => p.id),
    view: kind === 'helipadLight' ? { radius: 0.8 } : undefined,
    build(m) {
      const root = new Group();
      const anchor: Vec3 = [first.position[0], first.position[1] - info.y(first), first.position[2]];
      const local = (v: Vec3) => sub(v, anchor);
      let density: QualityName = 'high';
      let animate: ((dt: number) => void) | null = null;
      const show = swapper<QualityName>(root, (q) => {
        const built = buildProps(only({ props: [{ ...first, position: local(first.position) }] }), m, QUALITY[q].grassDensity);
        animate = built.update;
        return built.group;
      });
      show(density);
      let lights: ReturnType<typeof buildLights> | null = null;
      if (info.light) {
        const near = layout.lights.filter((l) => l.kind === info.light).sort((a, b) => dist(a.position, first.position) - dist(b.position, first.position))[0];
        if (near) {
          lights = buildLights(only({ lights: [{ ...near, position: local(near.position) }] }), m);
          root.add(lights.group);
        }
      }
      if (info.mount) {
        const mount = layout.elements.filter((e) => e.kind === info.mount).map((e) => moveElement(e, local));
        root.add(buildStructure(only({ elements: mount }), m));
      }
      const wind: Control = { type: 'range', label: 'Wind', min: 0, max: 20, step: 0.5, value: U.windSpeed.value, format: (v) => `${v} m/s`, set: (v) => void (U.windSpeed.value = v) };
      return {
        root,
        update(dt, t) {
          lights?.update(t);
          animate?.(dt);
        },
        controls:
          kind === 'grass'
            ? [
                wind,
                {
                  type: 'select',
                  label: 'Density (quality)',
                  options: (Object.keys(QUALITY) as QualityName[]).map((q) => [q, `${QUALITY[q].name} · ${QUALITY[q].grassDensity} blades/m²`]),
                  value: density,
                  set: (v) => {
                    density = v as QualityName;
                    show(density);
                  },
                },
              ]
            : kind === 'windsock'
              ? [wind]
              : [],
      };
    },
  };
}

function moveElement(e: Element, f: (v: Vec3) => Vec3): Element {
  switch (e.type) {
    case 'tube':
    case 'ibeam':
      return { ...e, a: f(e.a), b: f(e.b) };
    case 'box':
      return { ...e, center: f(e.center) };
    case 'stair':
      return { ...e, bottom: f(e.bottom), top: f(e.top) };
    case 'rail':
    case 'hull':
      return { ...e, points: e.points.map(f) };
  }
}

// ---------------------------------------------------------------- light fixtures

const FIXTURES: Partial<Record<LightKind, { name: string; about: string; y: number; view: Entry['view'] }>> = {
  downlight: { name: 'Downlight', about: 'Recessed warm downlights in the pavilion ceiling, shown 2.6 m up. Switch to night to see the pool of light on the floor.', y: 2.6, view: { target: [0, 1.3, 0], radius: 1.8, dir: [1, 0.15, 1.2] } },
  bulkhead: { name: 'Bulkhead lamp', about: 'Box lamps under the main deck, in the stair tower and at the elevator, shown 2.3 m up.', y: 2.3, view: { target: [0, 1.5, 0], radius: 1.3, dir: [1, 0.1, 1.2] } },
  obstruction: { name: 'Obstruction light', about: 'Blinking red aircraft-warning lights on the pavilion roof and the windsock pole.', y: 0.12, view: { radius: 0.7 } },
  poolLight: { name: 'Pool light', about: 'Underwater lights set in the plunge pool wall, facing into the pool.', y: 0.6, view: { target: [0, 0.6, 0], radius: 0.9, dir: [0.4, 0.2, 1.2] } },
};

function fixtureEntry(kind: LightKind): Entry {
  const info = FIXTURES[kind]!;
  const defs = layout.lights.filter((l) => l.kind === kind);
  return {
    id: `light-${kind}`,
    name: info.name,
    category: 'Light fixtures',
    about: info.about,
    source: 'apps/client/src/world/lights.ts',
    inWorld: defs.map((l) => l.id),
    view: info.view,
    build(m) {
      // The pool light's disc sits 0.29 m in front of its position (on the wall).
      const def: LightDef = { ...defs[0], position: [0, info.y, kind === 'poolLight' ? -0.29 : 0] };
      const lights = buildLights(only({ lights: [def] }), m);
      const root = new Group();
      root.add(lights.group);
      return { root, update: (_dt, t) => lights.update(t), controls: [] };
    },
  };
}

// ---------------------------------------------------------------- the list

const kindsOf = <T extends string>(list: Array<{ kind: T }>) => [...new Set(list.map((d) => d.kind))];

export const CATALOG: Entry[] = [
  drone,
  tender,
  avatar,
  ...kindsOf(layout.furniture).map(furnitureEntry),
  doors,
  elevator,
  ...kindsOf(layout.props).map(propEntry),
  ...kindsOf(layout.lights)
    .filter((k) => FIXTURES[k])
    .map(fixtureEntry),
];
