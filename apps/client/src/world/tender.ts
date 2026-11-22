import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  Quaternion,
  TubeGeometry,
  Vector3,
  type WebGPURenderer,
} from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DIMS, type VesselDef } from '@oilrig/shared';
import type { MaterialSet } from './materials/index.ts';
import type { Ocean } from '../env/ocean/ocean.ts';
import { WaveSampler } from '../env/ocean/waveSampler.ts';
import { tubeGeometry } from './structure.ts';

// A rigid-inflatable tender moored at the boat landing. Its heave, pitch and roll follow
// the ocean heights read back from the GPU at five points around the hull.

type V = [number, number, number];

/** Hull half-section at station s (0 = transom, 1 = stem), freeboard F: [halfBeam, keelY, chineY, sheerY]. */
function section(s: number, B: number, F: number): [number, number, number, number] {
  const bowStart = 0.62;
  const u = Math.max(0, (s - bowStart) / (1 - bowStart));
  const half = (B / 2) * Math.sqrt(Math.max(0, 1 - u * u * u));
  const keel = -0.38 + 0.62 * u * u;
  const sheer = F + 0.25 * u * u;
  const chine = keel + 0.22 + 0.15 * u;
  return [half, keel, Math.min(chine, sheer - 0.05), sheer];
}

/** Height of the cockpit floor at station s. */
function deckY(s: number, B: number, F: number) {
  return Math.min(section(s, B, F)[3], F + 0.07) - 0.12;
}

function hullGeometry(L: number, B: number, F: number): BufferGeometry {
  const N = 24;
  const verts: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const z = L / 2 - s * L; // transom at +z, stem at -z
    const [b, k, c, sh] = section(s, B, F);
    // port sheer, port chine, keel, starboard chine, starboard sheer
    verts.push(-b, sh, z, -b * 0.82, c, z, 0, k, z, b * 0.82, c, z, b, sh, z);
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < 4; j++) {
      const a = i * 5 + j;
      const b = (i + 1) * 5 + j;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  // Transom.
  const t0 = verts.length / 3;
  const [b0, k0, c0, s0] = section(0, B, F);
  verts.push(-b0, s0, L / 2, -b0 * 0.82, c0, L / 2, 0, k0, L / 2, b0 * 0.82, c0, L / 2, b0, s0, L / 2);
  idx.push(t0, t0 + 1, t0 + 2, t0, t0 + 2, t0 + 3, t0, t0 + 3, t0 + 4);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
  g.setIndex(idx);
  const ni = g.toNonIndexed();
  ni.computeVertexNormals();
  ni.setAttribute('uv', new BufferAttribute(new Float32Array(ni.getAttribute('position').count * 2), 2));
  return ni;
}

function deckGeometry(L: number, B: number, F: number): BufferGeometry {
  const N = 20;
  const verts: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const s = (i / N) * 0.9;
    const z = L / 2 - s * L;
    const [b] = section(s, B, F);
    const y = deckY(s, B, F);
    verts.push(-b * 0.92, y, z, b * 0.92, y, z);
  }
  for (let i = 0; i < N; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.setAttribute('uv', new BufferAttribute(new Float32Array((N + 1) * 2 * 2), 2));
  return g;
}

/** The inflatable collar: a tube following the sheer round the bow. */
function collarGeometry(L: number, B: number, F: number): BufferGeometry {
  const pts: Vector3[] = [];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const s = (i / N) * 0.985;
    const [b, , , sh] = section(s, B, F);
    pts.push(new Vector3(-b - 0.05, sh + 0.05, L / 2 + 0.15 - s * (L + 0.1)));
  }
  for (let i = N; i >= 0; i--) {
    const s = (i / N) * 0.985;
    const [b, , , sh] = section(s, B, F);
    pts.push(new Vector3(b + 0.05, sh + 0.05, L / 2 + 0.15 - s * (L + 0.1)));
  }
  return new TubeGeometry(new CatmullRomCurve3(pts, false, 'centripetal'), 120, 0.24, 14, false);
}

/** The boat itself (hull, deck, collar, console, outboard) in its own frame: bow at -z, waterline at y = 0. */
export function buildTenderHull(def: VesselDef, materials: MaterialSet): Group {
  const [L, B, F] = def.size;
  const hull = new Group();
  const white = new MeshPhysicalNodeMaterial({ color: 0xf4f5f2, roughness: 0.25, clearcoat: 0.6 });
  const tube = new MeshStandardNodeMaterial({ color: 0x3b4148, roughness: 0.75 });
  const dark = new MeshStandardNodeMaterial({ color: 0x1d1f22, roughness: 0.45, metalness: 0.2 });
  const glass = new MeshPhysicalNodeMaterial({ color: 0x9fb4bd, roughness: 0.05, transmission: 0.6, transparent: true, opacity: 0.5, side: DoubleSide });
  const add = (g: BufferGeometry, m: Material) => {
    const mesh = new Mesh(g, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    hull.add(mesh);
    return mesh;
  };
  add(hullGeometry(L, B, F), white);
  add(deckGeometry(L, B, F), materials.teak);
  add(collarGeometry(L, B, F), tube);
  // Centre console with windscreen, a bench seat and the outboard; console and bench stand on the floor.
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const geo = new BoxGeometry(w, h, d);
    geo.translate(x, y + h / 2, z);
    return geo;
  };
  const floorAt = (z: number) => deckY((L / 2 - z) / L, B, F);
  const consoleY = floorAt(0.1);
  add(mergeGeometries([box(0.75, 0.92, 0.65, 0, consoleY, 0.1), box(0.9, 0.42, 0.5, 0, floorAt(1.05), 1.05)], false)!, white);
  add(box(0.72, 0.32, 0.03, 0, consoleY + 0.9, -0.18), glass);
  add(mergeGeometries([box(0.42, 0.55, 0.42, 0, 0.35, L / 2 + 0.2), box(0.22, 0.6, 0.22, 0, -0.25, L / 2 + 0.22)], false)!, dark);
  add(tubeGeometry([0.25, consoleY + 0.92, 0.12], [-0.25, consoleY + 0.92, 0.12], 0.018, 8), materials.steelGrey);
  return hull;
}

interface Spring {
  x: number;
  v: number;
}
const spring = (s: Spring, target: number, k: number, damping: number, dt: number) => {
  const a = k * (target - s.x) - damping * s.v;
  s.v += a * dt;
  s.x += s.v * dt;
};

export class Tender {
  readonly group = new Group();
  readonly sampler: WaveSampler;
  private readonly hull: Group;
  private readonly def: VesselDef;
  private readonly heave: Spring = { x: 0, v: 0 };
  private readonly pitch: Spring = { x: 0, v: 0 };
  private readonly roll: Spring = { x: 0, v: 0 };
  private readonly surgeX: Spring = { x: 0, v: 0 };
  private readonly surgeZ: Spring = { x: 0, v: 0 };
  private readonly ropes: InstancedMesh;
  private readonly cleats: V[];
  private readonly bollards: V[];
  private time = 0;
  /** Latest sampled surface heights at bow, stern, port, starboard, centre (for tests and debugging). */
  readonly heights = new Float32Array(5);

  constructor(renderer: WebGPURenderer, ocean: Ocean, def: VesselDef, materials: MaterialSet) {
    this.def = def;
    const [L, B, F] = def.size;
    this.sampler = new WaveSampler(renderer, ocean.sim.cascades, 5);
    this.hull = buildTenderHull(def, materials);
    this.hull.rotation.order = 'YXZ';
    this.group.add(this.hull);
    this.group.position.set(def.position[0], 0, def.position[2]);
    this.group.rotation.y = def.rotationY;
    this.group.name = 'tender';

    // Mooring lines from bow and stern cleats, just inboard of the tube, to the landing edge.
    this.cleats = [
      [-(B / 2 - 0.47), F + 0.2, -L / 2 + 0.5],
      [B / 2 - 0.4, F + 0.2, L / 2 - 0.4],
    ];
    const edgeZ = DIMS.LANDING.z1;
    this.bollards = [
      [def.position[0] - L / 2 - 0.6, DIMS.LANDING.top + 0.15, edgeZ],
      [def.position[0] + L / 2 + 0.4, DIMS.LANDING.top + 0.15, edgeZ],
    ];
    const seg = new CylinderGeometry(0.018, 0.018, 1, 6, 1);
    seg.translate(0, 0.5, 0);
    seg.setAttribute('color', new BufferAttribute(new Float32Array(seg.getAttribute('position').count * 3).fill(0.75), 3));
    this.ropes = new InstancedMesh(seg, materials.fabric, 24);
    this.ropes.frustumCulled = false;
    this.ropes.castShadow = true;
  }

  /** Mooring lines live in world space next to the boat. */
  get lines() {
    return this.ropes;
  }

  private worldOf(local: V): Vector3 {
    return this.hull.localToWorld(new Vector3(...local));
  }

  update(dt: number) {
    this.time += dt;
    const [L, B] = this.def.size;
    // Sample around the hull's current footprint (in world space).
    const c = Math.cos(this.def.rotationY);
    const s = Math.sin(this.def.rotationY);
    const ox = this.def.position[0] + this.surgeX.x;
    const oz = this.def.position[2] + this.surgeZ.x;
    const at = (lx: number, lz: number): [number, number] => [ox + lx * c + lz * s, oz - lx * s + lz * c];
    this.sampler.setPoints([at(0, -L * 0.42), at(0, L * 0.42), at(-B * 0.45, 0), at(B * 0.45, 0), at(0, 0)]);
    this.sampler.update();
    const r = this.sampler.result;
    for (let i = 0; i < 5; i++) this.heights[i] = r[i * 3];
    if (this.sampler.readbacks > 0) {
      const [bow, stern, port, stb, mid] = this.heights;
      const meanH = (bow + stern + port + stb + 2 * mid) / 6;
      spring(this.heave, meanH, 9, 3.2, dt);
      // Nose up when the water under the bow is higher (rotation.x positive lifts the -z bow).
      // A hull spans several metres, so it follows the long swell more than the chop.
      spring(this.pitch, 0.7 * Math.atan2(bow - stern, L * 0.84), 7, 3.0, dt);
      // Rolls towards the lower side: rotation.z positive lifts +x (starboard).
      spring(this.roll, 0.6 * Math.atan2(stb - port, B * 0.9), 10, 2.6, dt);
      const clamp = (v: number) => Math.max(-0.6, Math.min(0.6, v));
      spring(this.surgeX, clamp(r[12 + 1] * 0.6), 1.2, 1.4, dt);
      spring(this.surgeZ, clamp(r[12 + 2] * 0.6), 1.2, 1.4, dt);
    }
    this.group.position.set(ox, this.heave.x, oz);
    this.hull.rotation.set(this.pitch.x, 0, this.roll.x + 0.012 * Math.sin(this.time * 0.7));
    this.hull.rotation.y = 0.03 * Math.sin(this.time * 0.13) + 0.02 * Math.sin(this.time * 0.31);
    this.group.updateMatrixWorld(true);
    this.updateRopes();
  }

  private updateRopes() {
    const m = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const per = 12;
    let k = 0;
    this.cleats.forEach((cl, i) => {
      const a = this.worldOf(cl);
      const b = new Vector3(...this.bollards[i]);
      const span = a.distanceTo(b);
      const sag = Math.max(0.05, 0.25 * span * 0.15);
      const pt = (t: number) => new Vector3().lerpVectors(a, b, t).add(new Vector3(0, -sag * 4 * t * (1 - t), 0));
      for (let j = 0; j < per; j++) {
        const p0 = pt(j / per);
        const p1 = pt((j + 1) / per);
        const d = p1.clone().sub(p0);
        const len = d.length();
        q.setFromUnitVectors(up, d.normalize());
        m.compose(p0, q, new Vector3(1, len, 1));
        this.ropes.setMatrixAt(k++, m);
      }
    });
    this.ropes.count = k;
    this.ropes.instanceMatrix.needsUpdate = true;
  }

  /** For tests: the boat's heave/pitch/roll and how often the GPU heights arrived. */
  get state() {
    return {
      heave: this.heave.x,
      pitch: this.pitch.x,
      roll: this.roll.x,
      readbacks: this.sampler.readbacks,
      heights: [...this.heights],
    };
  }
}
