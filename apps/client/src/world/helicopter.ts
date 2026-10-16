import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  PointLight,
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
  sin,
  smoothstep,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DIMS, type HeliPose } from '@ocean-home/shared';
import { U } from '../state.ts';
import { tubeGeometry } from './structure.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A light twin helicopter built from lathes, boxes and tubes, driven by the shared
// pose function. It also owns the rotor wash: uniforms the ocean reads (foam rings and
// flattening) and a spray of particles over the deck when it is close to the pad.

const H = DIMS.HELI;

function fuselageMaterial() {
  const m = new MeshStandardNodeMaterial({ roughness: 0.28, metalness: 0.15 });
  const y = positionLocal.y;
  const z = positionLocal.z;
  // Navy cheat line, grey belly and dark cabin side windows, all in the body's own frame.
  const stripe = smoothstep(0.03, 0.0, y.sub(1.08).abs().sub(0.07));
  const belly = smoothstep(0.75, 0.55, y);
  const windows = smoothstep(1.52, 1.58, y).mul(smoothstep(2.12, 2.06, y)).mul(smoothstep(-1.35, -1.25, z)).mul(smoothstep(0.75, 0.65, z));
  const base = mix(mix(color(0xf2f3f1), color(0x1f3550), stripe), color(0x6c737a), belly);
  m.colorNode = mix(base, color(0x1a2328), windows);
  m.roughnessNode = mix(float(0.3), float(0.06), windows);
  return m;
}

function bladeMaterial() {
  return new MeshStandardNodeMaterial({ color: 0x1b1c1e, roughness: 0.5, metalness: 0.2 });
}

/** Translucent disc that stands in for blades too fast to see. */
function discMaterial(opacity: any) {
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
  const r = positionLocal.xz.length().div(H.rotorRadius);
  const bands = sin(r.mul(40)).mul(0.15).add(0.85);
  m.colorNode = color(0x2a2c2e);
  m.opacityNode = opacity.mul(smoothstep(1.0, 0.92, r)).mul(smoothstep(0.08, 0.2, r)).mul(bands).mul(0.32);
  return m;
}

function emissive(hex: number, strength: any) {
  const m = new MeshStandardNodeMaterial({ color: 0x111111, roughness: 0.4 });
  m.emissiveNode = color(hex).mul(strength);
  return m;
}

/** Spray kicked up from the deck: camera-facing quads flowing outward along the surface. */
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

  const center = uniform(new Vector3(H.pad[0], H.pad[1], H.pad[2]));
  const strength = uniform(0);
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  m.fog = true;
  const life: any = Fn(() => {
    const sd = attribute('aSeed', 'vec4') as any;
    return fract(U.time.mul(sd.w.mul(0.5).add(0.45)).add(sd.x));
  })();
  m.positionNode = Fn(() => {
    const sd = attribute('aSeed', 'vec4') as any;
    const c = attribute('aCorner', 'vec2') as any;
    const t: any = life;
    const ang: any = sd.y.mul(Math.PI * 2).add(t.mul(0.6));
    const r: any = float(1.5).add(t.mul(t.mul(-6).add(18)));
    const hop: any = sin(t.mul(Math.PI)).mul(sd.z.mul(1.2).add(0.2));
    const base: any = (center as any).add(vec3(ang.cos().mul(r), hop.add(0.1), ang.sin().mul(r)));
    const size = t.mul(2.2).add(0.5);
    // Billboard facing the camera.
    const toCam = normalize(cameraPosition.sub(base));
    const right = normalize(cross(vec3(0, 1, 0), toCam));
    const up = cross(toCam, right);
    return base.add(right.mul(c.x.mul(size))).add(up.mul(c.y.mul(size)));
  })();
  const c = attribute('aCorner', 'vec2') as any;
  const soft = smoothstep(1, 0.2, c.length());
  const n = mx_noise_float(vec3(c.mul(1.7), life.mul(3))).mul(0.5).add(0.5);
  m.colorNode = mix(color(0xb9c2c6), color(0xeef2f3), n);
  m.opacityNode = soft.mul(n.mul(0.6).add(0.4)).mul(life.oneMinus()).mul(smoothstep(0, 0.1, life)).mul(strength).mul(0.35);
  const mesh = new Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 15;
  mesh.name = 'rotor-wash';
  return { mesh, center, strength };
}

export class Helicopter {
  readonly group = new Group();
  readonly spray = deckSpray(900);
  private readonly body = new Group();
  private readonly mainRotor = new Group();
  private readonly tailRotor = new Group();
  private readonly blades = new Group();
  private readonly tailBlades = new Group();
  private readonly discOpacity = uniform(0);
  private readonly tailDiscOpacity = uniform(0);
  private readonly beacon = uniform(0);
  private readonly beaconLight = new PointLight(0xff2a14, 0, 40, 2);
  private readonly landingLight = new PointLight(0xfff2dc, 0, 60, 1.6);
  private rotorAngle = 0;
  private tailAngle = 0;
  private time = 0;
  /** Latest pose, for audio and debugging. */
  pose: HeliPose | null = null;

  constructor() {
    this.group.name = 'helicopter';
    this.build();
    this.group.add(this.body);
    this.group.visible = false;
  }

  private build() {
    const paint = fuselageMaterial();
    const glass = new MeshPhysicalNodeMaterial({ color: new Color(0x223038), roughness: 0.05, metalness: 0.1, clearcoat: 1 });
    const dark = new MeshStandardNodeMaterial({ color: 0x2a2d31, roughness: 0.6, metalness: 0.3 });
    const skidMat = new MeshStandardNodeMaterial({ color: 0x8d9194, roughness: 0.4, metalness: 0.7 });

    // Fuselage: a lathe along the length (local z, nose at -z), narrowed sideways.
    const stations: Array<[number, number]> = [
      [-3.45, 0.0],
      [-3.38, 0.28],
      [-3.15, 0.52],
      [-2.75, 0.74],
      [-2.15, 0.9],
      [-1.3, 0.98],
      [0.5, 0.98],
      [1.35, 0.86],
      [2.0, 0.58],
      [2.45, 0.32],
      [2.6, 0.0],
    ];
    const lathe = (pts: Array<[number, number]>, phiStart = 0, phiLength = Math.PI * 2, grow = 1) => {
      const g = new LatheGeometry(pts.map(([z, r]) => new Vector2(r * grow, z)), 40, phiStart, phiLength);
      g.rotateX(Math.PI / 2); // lathe axis y -> z
      g.scale(0.8, 1.0, 1);
      g.translate(0, 1.35, 0);
      return g;
    };
    const fusMesh = new Mesh(lathe(stations), paint);
    // Wrap-around windscreen: the upper front of the same shape, slightly proud of it.
    const front = stations.filter(([z]) => z <= -1.2);
    const canopy = lathe(front, Math.PI * 0.62, Math.PI * 0.76, 1.012);
    const canopyMesh = new Mesh(canopy, glass);
    // Engine deck and mast.
    const engine = new BoxGeometry(1.0, 0.55, 2.6);
    engine.translate(0, 2.55, 0.5);
    const tail = tubeGeometry([0, 1.6, 2.2], [0, 1.95, 7.6], 0.26, 16);
    const tailTip = tubeGeometry([0, 1.95, 7.6], [0, 2.0, 7.9], 0.16, 12);
    const fin = new BoxGeometry(0.08, 1.35, 0.7);
    fin.rotateX(-0.35);
    fin.translate(0, 2.6, 7.75);
    const stab = new BoxGeometry(2.2, 0.06, 0.45);
    stab.translate(0, 1.9, 6.6);
    this.body.add(fusMesh, canopyMesh);
    for (const g of [engine, tail, tailTip, fin, stab]) {
      const mesh = new Mesh(g, paint);
      this.body.add(mesh);
    }
    const mast = new CylinderGeometry(0.1, 0.13, 0.5, 12);
    mast.translate(0, H.mastHeight - 0.25, 0);
    this.body.add(new Mesh(mast, dark));

    // Skids: two rails on curved cross tubes.
    const skids: BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      skids.push(tubeGeometry([s * 1.15, 0.05, -2.0], [s * 1.15, 0.05, 1.9], 0.05, 10));
      skids.push(tubeGeometry([s * 1.15, 0.05, -2.0], [s * 1.1, 0.25, -2.45], 0.05, 10));
      for (const z of [-1.1, 0.9]) {
        skids.push(tubeGeometry([s * 1.15, 0.05, z], [s * 0.85, 0.7, z], 0.045, 8));
        skids.push(tubeGeometry([s * 0.85, 0.7, z], [0, 0.82, z], 0.045, 8));
      }
    }
    this.body.add(new Mesh(mergeGeometries(skids, false)!, skidMat));

    // Main rotor: hub + four blades, plus a blur disc.
    const hub = new CylinderGeometry(0.28, 0.32, 0.25, 16);
    hub.translate(0, H.mastHeight + 0.05, 0);
    this.mainRotor.add(new Mesh(hub, dark));
    const bladeMat = bladeMaterial();
    for (let i = 0; i < H.blades; i++) {
      const b = new BoxGeometry(H.rotorRadius - 0.3, 0.05, 0.32);
      b.translate((H.rotorRadius - 0.3) / 2 + 0.3, 0, 0);
      const blade = new Mesh(b, bladeMat);
      blade.rotation.y = (i / H.blades) * Math.PI * 2;
      blade.position.y = H.mastHeight + 0.08;
      this.blades.add(blade);
    }
    this.mainRotor.add(this.blades);
    const disc = new CircleGeometry(H.rotorRadius, 64);
    disc.rotateX(-Math.PI / 2);
    disc.translate(0, H.mastHeight + 0.08, 0);
    const discMesh = new Mesh(disc, discMaterial(this.discOpacity));
    discMesh.renderOrder = 16;
    this.mainRotor.add(discMesh);
    this.body.add(this.mainRotor);

    // Tail rotor on the left of the fin.
    this.tailRotor.position.set(-0.18, 2.35, 7.75);
    for (let i = 0; i < 2; i++) {
      const b = new BoxGeometry(0.03, 1.5, 0.16);
      const blade = new Mesh(b, bladeMat);
      blade.rotation.x = (i / 2) * Math.PI;
      this.tailBlades.add(blade);
    }
    this.tailRotor.add(this.tailBlades);
    const tdisc = new CircleGeometry(0.76, 32);
    tdisc.rotateY(Math.PI / 2);
    const tdiscMesh = new Mesh(tdisc, discMaterial(this.tailDiscOpacity));
    this.tailRotor.add(tdiscMesh);
    this.body.add(this.tailRotor);

    // Lights: anti-collision beacon, navigation lights.
    const beacon = new SphereGeometry(0.09, 10, 8);
    beacon.translate(0, 2.88, 1.6);
    this.body.add(new Mesh(beacon, emissive(0xff2a14, this.beacon.mul(40))));
    const navGlow = U.nightLights.mul(12).add(1.5);
    const red = new SphereGeometry(0.06, 8, 6);
    red.translate(-1.0, 1.3, -0.6);
    const green = new SphereGeometry(0.06, 8, 6);
    green.translate(1.0, 1.3, -0.6);
    this.body.add(new Mesh(red, emissive(0xff2010, navGlow)), new Mesh(green, emissive(0x20ff40, navGlow)));
    this.beaconLight.position.set(0, 2.9, 1.6);
    this.landingLight.position.set(0, -1.5, -2.5);
    this.body.add(this.beaconLight, this.landingLight);

    this.body.traverse((o) => {
      if ((o as Mesh).isMesh && o !== discMesh && o !== tdiscMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }

  update(pose: HeliPose, dt: number) {
    this.pose = pose;
    this.time += dt;
    this.group.visible = pose.visible;
    if (!pose.visible) {
      U.washSea.value = 0;
      this.spray.strength.value = 0;
      this.beaconLight.intensity = 0;
      this.landingLight.intensity = 0;
      return;
    }
    const [x, y, z] = pose.position;
    this.group.position.set(x, y, z);
    this.group.rotation.set(pose.pitch, pose.yaw, pose.roll, 'YXZ');

    // Rotors: blades blur into a disc as they speed up; at rest they droop a little.
    const rpm = pose.rotor;
    this.rotorAngle += rpm * H.rotorHz * Math.PI * 2 * dt;
    this.tailAngle += rpm * H.tailRotorHz * Math.PI * 2 * dt;
    this.blades.rotation.y = -this.rotorAngle;
    this.tailBlades.rotation.x = this.tailAngle;
    const blur = Math.min(1, Math.max(0, (rpm - 0.25) / 0.45));
    this.discOpacity.value = blur;
    this.tailDiscOpacity.value = blur;
    this.blades.visible = blur < 0.98;
    for (const b of this.blades.children) b.rotation.z = (1 - rpm) * -0.04;
    for (const b of this.blades.children) (b as Mesh).visible = blur < 0.98;

    // Beacon flashes whenever the engines run.
    const flash = rpm > 0.05 && this.time % 1.1 < 0.12 ? 1 : 0;
    this.beacon.value = flash;
    this.beaconLight.intensity = flash * (2 + 30 * U.nightLights.value);
    // Landing light on the final approach at night.
    const low = pose.altitude < 120 && rpm > 0.5 && pose.altitude > 0.5;
    this.landingLight.intensity = low ? 120 * U.nightLights.value : 0;

    // Rotor wash: spray on the deck when close to the pad, foam and flattening on the sea.
    const abovePad = Math.hypot(x - H.pad[0], z - H.pad[2]) < 14 ? y - H.pad[1] : Infinity;
    const deck = rpm * rpm * Math.max(0, Math.min(1, 1 - abovePad / 14));
    this.spray.center.value.set(x, H.pad[1], z);
    this.spray.strength.value = deck;
    U.washCenter.value.set(x, z);
    U.washSea.value = rpm * rpm * Math.max(0, Math.min(1, (70 - y) / 50));
  }
}

