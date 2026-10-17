import {
  BoxGeometry,
  BufferAttribute,
  Color,
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  PointLight,
  Shape,
  Sphere,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three/webgpu';
import {
  Fn,
  attribute,
  cameraPosition,
  color,
  cross,
  float,
  fract,
  mix,
  mx_noise_float,
  normalize,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  uniform,
  vec3,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DIMS, type DronePose, type Vec3 } from '@ocean-home/shared';
import type { AimedLight } from '../render/stableClusteredLighting.ts';
import { U } from '../state.ts';
import { tubeGeometry } from './structure.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

// The platform's passenger drone: a pearl-white composite pod with a wrap-around canopy,
// four seats inside, and four ducted rotors on carbon arms. Built in its body frame
// (x right, y up from the skids, nose towards -z) and driven by a DronePose. It also owns
// the rotor wash: uniforms the ocean reads (flattening under it) and a spray of particles
// over whatever deck it hovers above.

const D = DIMS.DRONE;
const STROBE_AIM = new Vector3(0, -1, 0);
const LANDING_AIM = new Vector3(0, -1, -0.5).normalize();

/** Pod profile along z (nose at -z): [z, radius]. */
const STATIONS: Array<[number, number]> = [
  [-2.0, 0.0],
  [-1.93, 0.3],
  [-1.75, 0.58],
  [-1.42, 0.82],
  [-0.9, 0.97],
  [-0.1, 1.02],
  [0.75, 0.99],
  [1.35, 0.88],
  [1.8, 0.64],
  [2.06, 0.34],
  [2.15, 0.0],
];
const POD_Y = 1.32;
const POD_SQUASH: [number, number] = [0.98, 0.84];

function lathe(points: Array<[number, number]>, phiStart = 0, phiLength = Math.PI * 2, grow = 1) {
  const g = new LatheGeometry(points.map(([z, r]) => new Vector2(r * grow, z)), 48, phiStart, phiLength);
  g.rotateX(Math.PI / 2); // lathe axis y -> z; phi = 0 points down, phi = π up
  g.scale(POD_SQUASH[0], POD_SQUASH[1], 1);
  g.translate(0, POD_Y, 0);
  return g;
}

function bodyMaterial() {
  // Double-sided: seen from the seats, the inside of the pod is the same shell.
  const m = new MeshPhysicalNodeMaterial({ roughness: 0.22, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08, side: DoubleSide });
  const y = positionLocal.y;
  // Pearl white with a graphite belly and a thin cyan accent line.
  const belly = smoothstep(0.86, 0.72, y);
  const accent = smoothstep(0.025, 0.0, y.sub(0.93).abs());
  m.colorNode = mix(mix(color(0xf2f3f0), color(0x2b2e33), belly), color(0x28d7f0), accent);
  // A faint glow: night exposure runs up to 6×, and more turned the line across the nose into
  // a cyan glare in the pilot's view.
  m.emissiveNode = color(0x28d7f0).mul(accent.mul(0.12));
  return m;
}

function canopyMaterial() {
  // Dark tint, like the other clear glass: a pale one lit up in the sun and veiled the pilot's view.
  const m = new MeshPhysicalNodeMaterial({
    color: 0x1a2423,
    roughness: 0.04,
    metalness: 0,
    transparent: true,
    opacity: 0.18,
    side: DoubleSide,
    depthWrite: false,
  });
  return m;
}

function carbonMaterial() {
  const m = new MeshStandardNodeMaterial({ roughness: 0.42, metalness: 0.35 });
  const weave = smoothstep(0.4, 0.6, fract(positionLocal.x.add(positionLocal.z).mul(70)));
  m.colorNode = mix(color(0x16181b), color(0x1c1f23), weave);
  return m;
}

/** Translucent disc that stands in for propeller blades too fast to see. */
function discMaterial(opacity: any) {
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
  const r = positionLocal.xz.length().div(D.ductRadius);
  const bands = sin(r.mul(30)).mul(0.12).add(0.88);
  // Unlit, so it takes the light of the sky around it: dark at night, not a grey glow.
  m.colorNode = color(0x26282b).mul(U.ambient);
  m.opacityNode = opacity.mul(smoothstep(1.0, 0.9, r)).mul(smoothstep(0.1, 0.2, r)).mul(bands).mul(0.42);
  return m;
}

function emissive(hex: number, strength: any) {
  const m = new MeshStandardNodeMaterial({ color: 0x111111, roughness: 0.4 });
  m.emissiveNode = color(hex).mul(strength);
  return m;
}

/** Spray kicked up from a deck: camera-facing quads flowing outward along the surface. */
function deckSpray(count: number) {
  const seeds = new Float32Array(count * 4 * 4);
  const corners = new Float32Array(count * 4 * 2);
  const idx = new Uint32Array(count * 6);
  const cs = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  for (let i = 0; i < count; i++) {
    const s = [Math.random(), Math.random(), Math.random(), Math.random()];
    for (let k = 0; k < 4; k++) {
      seeds.set(s, (i * 4 + k) * 4);
      corners.set(cs[k], (i * 4 + k) * 2);
    }
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(count * 4 * 3), 3));
  g.setAttribute('aSeed', new BufferAttribute(seeds, 4));
  g.setAttribute('aCorner', new BufferAttribute(corners, 2));
  g.setIndex(new BufferAttribute(idx, 1));
  g.boundingSphere = new Sphere(new Vector3(), 1e5);

  const center = uniform(new Vector3(D.pad[0], D.pad[1], D.pad[2]));
  const strength = uniform(0);
  /** Light on the spray: sky, sun and the lamps around it (unlit, it would glow white at night). */
  const light = uniform(new Color(1, 1, 1));
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  m.fog = true;
  const life: any = Fn(() => {
    const sd = attribute('aSeed', 'vec4') as any;
    return fract(U.time.mul(sd.w.mul(0.6).add(0.55)).add(sd.x));
  })();
  m.positionNode = Fn(() => {
    const sd = attribute('aSeed', 'vec4') as any;
    const c = attribute('aCorner', 'vec2') as any;
    const t: any = life;
    const ang: any = sd.y.mul(Math.PI * 2).add(t.mul(0.5));
    const r: any = float(1.2).add(t.mul(t.mul(-5).add(14)));
    const hop: any = sin(t.mul(Math.PI)).mul(sd.z.mul(0.9).add(0.15));
    const base: any = (center as any).add(vec3(ang.cos().mul(r), hop.add(0.08), ang.sin().mul(r)));
    const size = t.mul(1.8).add(0.4);
    const toCam = normalize(cameraPosition.sub(base));
    const right = normalize(cross(vec3(0, 1, 0), toCam));
    const up = cross(toCam, right);
    return base.add(right.mul(c.x.mul(size))).add(up.mul(c.y.mul(size)));
  })();
  const c = attribute('aCorner', 'vec2') as any;
  const soft = smoothstep(1, 0.2, c.length());
  const n = mx_noise_float(vec3(c.mul(1.7), life.mul(3))).mul(0.5).add(0.5);
  // Fine mist: it scatters back only part of the light falling on it.
  m.colorNode = mix(color(0xb9c2c6), color(0xeef2f3), n).mul(light).mul(0.45);
  // Puffs fade out close to the camera, so none sweep through the cockpit as a hard-edged veil.
  const near = smoothstep(2.0, 4.5, positionWorld.sub(cameraPosition).length());
  m.opacityNode = soft.mul(n.mul(0.6).add(0.4)).mul(life.oneMinus()).mul(smoothstep(0, 0.1, life)).mul(strength).mul(near).mul(0.2);
  const mesh = new Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 15;
  mesh.name = 'rotor-wash';
  return { mesh, center, strength, light };
}

export class Drone {
  readonly group = new Group();
  readonly spray = deckSpray(700);
  private readonly body = new Group();
  private readonly props: Group[] = [];
  private readonly discOpacity = uniform(0);
  private readonly strobe = uniform(0);
  private readonly strobeLight = new PointLight(0xffffff, 0, 30, 2);
  private readonly landingLight = new PointLight(0xfff2dc, 0, 40, 2);
  private readonly cabinLight = new PointLight(0x9fe8ff, 0, 4, 2);
  private readonly screens = uniform(0);
  private angle = 0;
  private time = 0;
  /** Lamplight around the spray (lampLightAt), set by the caller each frame. */
  sprayLamplight = 0;
  /** Latest pose, for audio and debugging. */
  pose: DronePose | null = null;

  constructor() {
    this.group.name = 'drone';
    this.build();
    this.group.add(this.body);
    this.group.visible = false;
  }

  private build() {
    const paint = bodyMaterial();
    const carbon = carbonMaterial();
    const dark = new MeshStandardNodeMaterial({ color: 0x1d1f22, roughness: 0.55, metalness: 0.4 });
    const seatMat = new MeshStandardNodeMaterial({ color: 0x3a3f46, roughness: 0.75 });
    const steel = new MeshStandardNodeMaterial({ color: 0x9ea3a7, roughness: 0.3, metalness: 0.85 });

    // Pod: opaque tail cone, lower body and roof; glass all round the cabin between them.
    // φ = 0 is the belly, π the top. The nose is a glass bubble over a belly keel; the
    // cabin has a roof strip and windows down both sides.
    const tail = STATIONS.filter(([z]) => z >= 0.75);
    const mid = STATIONS.filter(([z]) => z >= -0.9 && z <= 0.75);
    const nose = STATIONS.filter(([z]) => z <= -0.9);
    const keel = lathe(nose, Math.PI * 1.78, Math.PI * 0.44);
    const lower = lathe(mid, Math.PI * 1.4, Math.PI * 1.2);
    const roof = lathe(mid, Math.PI * 0.88, Math.PI * 0.24);
    const canopy = mergeGeometries(
      [lathe(nose, Math.PI * 0.22, Math.PI * 1.56, 1.004), lathe(mid, Math.PI * 0.6, Math.PI * 0.28, 1.004), lathe(mid, Math.PI * 1.12, Math.PI * 0.28, 1.004)],
      false,
    )!;
    this.body.add(new Mesh(mergeGeometries([lathe(tail), keel, lower, roof], false)!, paint));
    const glass = new Mesh(canopy, canopyMaterial());
    glass.renderOrder = 12;
    this.body.add(glass);
    // Slim mounts on the roof that the arms grow from.
    // Pod radius at a station, for seating things on its surface.
    const radiusAt = (z: number) => {
      for (let i = 1; i < STATIONS.length; i++) {
        const [z0, r0] = STATIONS[i - 1];
        const [z1, r1] = STATIONS[i];
        if (z <= z1) return r0 + ((r1 - r0) * (z - z0)) / (z1 - z0);
      }
      return 0;
    };
    const roofY = (z: number) => POD_Y + POD_SQUASH[1] * radiusAt(z) + 0.03;
    // Half-width of the pod's inside at height y and station z (0 below the belly).
    const halfWidthAt = (y: number, z: number) => {
      const r = radiusAt(z);
      const u = (y - POD_Y) / (POD_SQUASH[1] * r);
      return r > 0 && Math.abs(u) < 1 ? POD_SQUASH[0] * r * Math.sqrt(1 - u * u) : 0;
    };
    const shoulders = new BoxGeometry(1.3, 0.07, 0.24);
    const shoulderF = shoulders.clone().translate(0, roofY(-1.0), -1.0);
    const shoulderB = shoulders.translate(0, roofY(1.15), 1.15);
    // Canopy frame: a hoop between the seat rows.
    const hoop: BufferGeometry[] = [];
    for (let k = 0; k <= 12; k++) {
      const a0 = Math.PI * (0.6 + (0.8 * k) / 12);
      const a1 = Math.PI * (0.6 + (0.8 * (k + 1)) / 12);
      const p = (a: number): Vec3 => [Math.sin(a) * 1.0 * POD_SQUASH[0], POD_Y - Math.cos(a) * 1.0 * POD_SQUASH[1], 0.1];
      if (k < 12) hoop.push(tubeGeometry(p(a0), p(a1), 0.035, 8));
    }
    this.body.add(new Mesh(mergeGeometries([shoulderF, shoulderB, ...hoop], false)!, carbon));

    // Arms and ducts with stators, motors and propellers.
    const arms: BufferGeometry[] = [];
    const ducts: BufferGeometry[] = [];
    const R = D.ductRadius;
    const ductProfile: Array<[number, number]> = [
      [R + 0.02, -0.17],
      [R + 0.09, -0.1],
      [R + 0.11, 0.05],
      [R + 0.07, 0.17],
      [R + 0.0, 0.19],
      [R - 0.03, 0.12],
      [R - 0.02, -0.17],
    ];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const cx = sx * D.armX;
        const cz = sz * D.armZ;
        const cy = D.ductY;
        const az = sz < 0 ? -1.0 : 1.15;
        arms.push(tubeGeometry([sx * 0.6, roofY(az), az], [cx - sx * (R + 0.06) * 0.72, cy + 0.02, cz - sz * (R + 0.06) * 0.69], 0.07, 12));
        const duct = new LatheGeometry(ductProfile.map(([r, y]) => new Vector2(r, y)), 56);
        duct.translate(cx, cy, cz);
        ducts.push(duct);
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2 + 0.4;
          arms.push(tubeGeometry([cx + Math.cos(a) * 0.15, cy - 0.08, cz + Math.sin(a) * 0.15], [cx + Math.cos(a) * (R - 0.02), cy - 0.08, cz + Math.sin(a) * (R - 0.02)], 0.022, 6));
        }
        const motor = new CylinderGeometry(0.15, 0.17, 0.3, 20);
        motor.translate(cx, cy - 0.04, cz);
        arms.push(motor);
        // Propeller: three slightly twisted blades and a spinner, spun as a group.
        const prop = new Group();
        prop.position.set(cx, cy + 0.07, cz);
        const blades: BufferGeometry[] = [];
        for (let k = 0; k < D.blades; k++) {
          const b = new BoxGeometry(R - 0.2, 0.018, 0.17);
          b.rotateX(sx * sz * 0.22);
          b.translate((R - 0.2) / 2 + 0.14, 0, 0);
          b.rotateY((k / D.blades) * Math.PI * 2);
          blades.push(b);
        }
        const spinner = new SphereGeometry(0.11, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2);
        blades.push(spinner);
        const bladeMesh = new Mesh(mergeGeometries(blades, false)!, dark);
        bladeMesh.castShadow = true;
        prop.add(bladeMesh);
        const disc = new CircleGeometry(R - 0.04, 48);
        disc.rotateX(-Math.PI / 2);
        const discMesh = new Mesh(disc, discMaterial(this.discOpacity));
        discMesh.renderOrder = 16;
        discMesh.castShadow = false;
        prop.add(discMesh);
        prop.userData.dir = sx * sz; // diagonal pairs counter-rotate
        prop.userData.blades = bladeMesh;
        this.props.push(prop);
        this.body.add(prop);
      }
    }
    this.body.add(new Mesh(mergeGeometries(arms, false)!, carbon));
    const ductMesh = new Mesh(mergeGeometries(ducts, false)!, paint);
    this.body.add(ductMesh);

    // Landing gear: two skids on short struts.
    const gear: BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      gear.push(tubeGeometry([s * 0.82, 0.05, -1.35], [s * 0.82, 0.05, 1.45], 0.045, 10));
      gear.push(tubeGeometry([s * 0.82, 0.05, -1.35], [s * 0.8, 0.18, -1.6], 0.045, 10));
      for (const z of [-0.8, 0.9]) gear.push(tubeGeometry([s * 0.82, 0.05, z], [s * 0.5, 0.62, z], 0.04, 8));
    }
    this.body.add(new Mesh(mergeGeometries(gear, false)!, steel));

    // Cabin: floor, four seats, a dashboard with screens and a side stick, all inside the belly.
    const FLOOR = 0.645;
    // The floor (0.05 thick) is cut to the belly's curve 1.5 cm below its underside, so it clears
    // the shell all round, even where the belly is nearly flat.
    const edge: Vector2[] = [];
    for (let z = -1.4; z <= 1.5; z += 0.05) {
      const w = halfWidthAt(FLOOR - 0.065, z);
      if (w > 0.1) edge.push(new Vector2(w, z));
    }
    const floor = new ExtrudeGeometry(new Shape([...edge, ...edge.map((p) => new Vector2(-p.x, p.y)).reverse()]), { depth: 0.05, bevelEnabled: false });
    floor.rotateX(Math.PI / 2).translate(0, FLOOR, 0);
    this.body.add(new Mesh(floor, seatMat));
    const cabin: BufferGeometry[] = [];
    for (const [x, y, z] of D.seats) {
      const cushion = new BoxGeometry(0.52, 0.12, 0.5);
      cushion.translate(x, y - 0.06, z);
      // Reclined: the top leans back, towards the tail.
      const back = new BoxGeometry(0.52, 0.7, 0.1);
      back.rotateX(0.18);
      back.translate(x, y + 0.32, z + 0.28);
      // The base stands on the floor, its outer side clear of the belly's curve.
      const inner = Math.abs(x) - 0.2;
      const outer = Math.min(Math.abs(x) + 0.2, Math.min(halfWidthAt(FLOOR, z - 0.2), halfWidthAt(FLOOR, z + 0.2)) - 0.015);
      const base = new BoxGeometry(outer - inner, y - 0.03 - FLOOR, 0.4);
      base.translate((Math.sign(x) * (inner + outer)) / 2, (y - 0.03 + FLOOR) / 2, z);
      cabin.push(cushion, back, base);
    }
    this.body.add(new Mesh(mergeGeometries(cabin, false)!, seatMat));
    // Low console ahead of the front seats: the view over it is the point of the cabin.
    const dash = new BoxGeometry(1.25, 0.16, 0.3);
    dash.rotateX(0.3);
    dash.translate(0, 0.98, -1.18);
    const pedestal = new BoxGeometry(0.34, 0.92 - FLOOR, 0.22);
    pedestal.translate(0, (0.92 + FLOOR) / 2, -1.16);
    this.body.add(new Mesh(mergeGeometries([dash, pedestal], false)!, dark));
    const screen = new BoxGeometry(0.8, 0.1, 0.01);
    screen.rotateX(-1.0);
    screen.translate(0, 1.07, -1.1);
    // Dimmed at night, when the exposure would turn them into a glare across the dashboard.
    this.body.add(new Mesh(screen, emissive(0x5fe0ff, this.screens.mul(mix(float(2.2), float(0.3), U.nightLights)))));
    const stick = tubeGeometry([-0.78, 0.98, -0.4], [-0.78, 1.18, -0.42], 0.02, 8);
    this.body.add(new Mesh(stick, dark));

    // Lights: red/green on the front ducts, white on the rear, a strobe under the belly.
    const navGlow = U.nightLights.mul(12).add(1.5);
    const nav = (hex: number, x: number, z: number) => {
      const g = new SphereGeometry(0.06, 8, 6);
      g.translate(x, D.ductY, z);
      this.body.add(new Mesh(g, emissive(hex, navGlow)));
    };
    nav(0xff2010, -(D.armX + D.ductRadius + 0.11), -D.armZ);
    nav(0x20ff40, D.armX + D.ductRadius + 0.11, -D.armZ);
    nav(0xffffff, -(D.armX + D.ductRadius + 0.11), D.armZ);
    nav(0xffffff, D.armX + D.ductRadius + 0.11, D.armZ);
    const strobe = new SphereGeometry(0.07, 10, 8);
    strobe.translate(0, 0.42, 0.2);
    this.body.add(new Mesh(strobe, emissive(0xffffff, this.strobe.mul(60))));
    // The strobe and the landing light are aimed down from the belly, so they light the deck
    // and the sea, not the drone itself or the cabin above them.
    this.strobeLight.position.set(0, 0.35, 0.2);
    this.landingLight.position.set(0, 0.6, -1.5);
    Object.assign(this.strobeLight.userData, { aim: new Vector3(0, -1, 0), cone: 0.1 } satisfies AimedLight);
    Object.assign(this.landingLight.userData, { aim: new Vector3(0, -1, -0.5).normalize(), cone: 0.72 } satisfies AimedLight);
    this.cabinLight.position.set(0, 1.9, 0.1);
    this.body.add(this.strobeLight, this.landingLight, this.cabinLight);

    this.body.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh && mesh !== glass && mesh.renderOrder < 16) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }

  /**
   * Places the drone. `ground` is the height of whatever solid surface lies under it (null
   * over open water); `inside` hides the canopy reflections' worst case: the seated view.
   */
  update(pose: DronePose, dt: number, ground: number | null, occupied: boolean) {
    this.pose = pose;
    this.time += dt;
    this.group.visible = pose.visible;
    if (!pose.visible) {
      U.washSea.value = 0;
      U.droneCabin.value.w = 0;
      this.spray.strength.value = 0;
      this.strobeLight.intensity = 0;
      this.landingLight.intensity = 0;
      this.cabinLight.intensity = 0;
      return;
    }
    const [x, y, z] = pose.position;
    this.group.position.set(x, y, z);
    this.group.rotation.set(pose.pitch, pose.yaw, pose.roll, 'YXZ');
    this.group.updateMatrixWorld();
    for (const [l, local] of [
      [this.strobeLight, STROBE_AIM],
      [this.landingLight, LANDING_AIM],
    ] as const) {
      (l.userData as AimedLight).aim!.copy(local).transformDirection(this.group.matrixWorld);
    }
    U.droneCabin.value.set(x, y + POD_Y, z, 1.25);

    // Propellers: blades blur into discs as they speed up.
    const rpm = Math.max(0, pose.rotor);
    this.angle += rpm * D.rotorHz * Math.PI * 2 * dt;
    const blur = Math.min(1, Math.max(0, (rpm - 0.12) / 0.3));
    this.discOpacity.value = blur;
    for (const p of this.props) {
      p.rotation.y = this.angle * p.userData.dir;
      (p.userData.blades as Mesh).visible = blur < 0.97;
    }
    const powered = rpm > 0.02 || occupied;
    this.screens.value += ((powered ? 1 : 0) - this.screens.value) * Math.min(1, dt * 3);
    // Dim: night exposure runs up to 6×, and anything brighter blows the white shell out into a haze.
    this.cabinLight.intensity = occupied ? 0.3 : 0;

    // Strobe flashes whenever the motors run; the landing light near the ground at night.
    const flash = rpm > 0.05 && this.time % 1.0 < 0.08 ? 1 : 0;
    this.strobe.value = flash;
    this.strobeLight.intensity = flash * (2 + 25 * U.nightLights.value);
    const height = ground === null ? y : y - ground;
    const low = height < 60 && rpm > 0.5 && height > 0.4;
    this.landingLight.intensity = low ? 30 * U.nightLights.value : 0;

    // Rotor wash: spray on a deck below, flattening on the sea.
    // Idling on the pad (rotor 0.4) moves no air worth seeing; the spray builds towards lift-off.
    const thrust = Math.max(0, Math.min(1, (rpm - 0.45) / 0.4));
    const deck = ground !== null && ground > 0.5 ? thrust * thrust * Math.max(0, Math.min(1, 1 - height / 10)) : 0;
    this.spray.center.value.set(x, ground ?? 0, z);
    this.spray.strength.value = deck;
    const lamps = this.sprayLamplight / Math.PI;
    this.spray.light.value.copy(U.ambient.value).addScalar(lamps);
    U.washCenter.value.set(x, z);
    U.washSea.value = ground === null || ground < 0.5 ? rpm * rpm * Math.max(0, Math.min(1, (24 - y) / 18)) : 0;
  }
}
