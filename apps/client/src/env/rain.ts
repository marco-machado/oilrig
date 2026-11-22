import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
  PlaneGeometry,
  Sphere,
  Vector3,
} from 'three/webgpu';
import {
  Fn,
  attribute,
  cameraPosition,
  cross,
  float,
  fract,
  mx_noise_float,
  normalize,
  select,
  smoothstep,
  transformNormalToView,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import { DIMS } from '@oilrig/shared';
import { U } from '../state.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

const BOX = new Vector3(44, 26, 44);
/** The drone's fuselage bounds in its body frame: centre and half-extents. */
const HULL = DIMS.DRONE.body;
const HULL_MID = new Vector3(0, (HULL.roof + HULL.belly) / 2, (HULL.nose + HULL.tail) / 2);
const HULL_HALF = new Vector3(HULL.halfWidth, (HULL.roof - HULL.belly) / 2, (HULL.tail - HULL.nose) / 2);

/** Shader-only rain: drops wrap inside a box around the camera; roofs stop them. */
export function createRain(count: number) {
  const corners = [
    [-1, 0],
    [1, 0],
    [1, 1],
    [-1, 1],
  ];
  const seed = new Float32Array(count * 4 * 4);
  const corner = new Float32Array(count * 4 * 2);
  const pos = new Float32Array(count * 4 * 3);
  const idx = new Uint32Array(count * 6);
  for (let i = 0; i < count; i++) {
    const s = [Math.random(), Math.random(), Math.random(), Math.random()];
    for (let k = 0; k < 4; k++) {
      seed.set(s, (i * 4 + k) * 4);
      corner.set(corners[k], (i * 4 + k) * 2);
    }
    const b = i * 4;
    idx.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new BufferAttribute(seed, 4));
  g.setAttribute('aCorner', new BufferAttribute(corner, 2));
  g.setIndex(new BufferAttribute(idx, 1));
  g.boundingSphere = new Sphere(new Vector3(), 1e6);

  const active = uniform(0);
  const m = new MeshBasicNodeMaterial();
  m.transparent = true;
  m.depthWrite = false;
  m.blending = AdditiveBlending;
  m.fog = false;
  const box = vec3(BOX.x, BOX.y, BOX.z);
  const fall = float(9.5);
  const hullMid = vec3(HULL_MID.x, HULL_MID.y, HULL_MID.z);
  const hullHalf = vec3(HULL_HALF.x, HULL_HALF.y, HULL_HALF.z);
  // Inside the drone: a superellipsoid (exponent 4) round the fuselage's bounds, in its body
  // frame. It holds the whole shell, nose and tail tips included.
  const inDrone = (q: any) => {
    const b = U.droneCabin.mul(vec4(q, 1)).xyz.sub(hullMid).div(hullHalf);
    const b2 = b.mul(b);
    return b2.x.mul(b2.x).add(b2.y.mul(b2.y)).add(b2.z.mul(b2.z)).lessThan(1);
  };

  m.positionNode = Fn(() => {
    const sd = attribute('aSeed', 'vec4') as any;
    const c = attribute('aCorner', 'vec2') as any;
    const wind = vec3(U.windDir.x, 0, U.windDir.y).mul(U.windSpeed.mul(0.55));
    const vel = vec3(wind.x, fall.negate(), wind.z);
    const travel = vel.mul(U.time.mul(sd.w.mul(0.3).add(0.85)));
    const local = fract(sd.xyz.add(travel.div(box))).sub(0.5).mul(box);
    const base = cameraPosition.sub(fract(cameraPosition.div(box)).mul(box)).add(box.mul(0.5));
    let p: any = base.add(local);
    // Re-centre on the camera along each axis.
    p = p.add(select(p.sub(cameraPosition).x.greaterThan(box.x.mul(0.5)), vec3(box.x.negate(), 0, 0), vec3(0)));
    p = p.add(select(p.sub(cameraPosition).x.lessThan(box.x.mul(-0.5)), vec3(box.x, 0, 0), vec3(0)));
    p = p.add(select(p.sub(cameraPosition).z.greaterThan(box.z.mul(0.5)), vec3(0, 0, box.z.negate()), vec3(0)));
    p = p.add(select(p.sub(cameraPosition).z.lessThan(box.z.mul(-0.5)), vec3(0, 0, box.z), vec3(0)));
    p = p.add(select(p.sub(cameraPosition).y.greaterThan(box.y.mul(0.5)), vec3(0, box.y.negate(), 0), vec3(0)));
    p = p.add(select(p.sub(cameraPosition).y.lessThan(box.y.mul(-0.5)), vec3(0, box.y, 0), vec3(0)));
    const dir = normalize(vel);
    const len = float(0.55).add(sd.w.mul(0.4));
    // Sheltered: under the pavilion roof, the main deck or the helideck; inside the drone (either
    // end of the streak, so none reaches in through the glass); or below sea level.
    const P = DIMS.PAVILION;
    const inRect = (x0: number, x1: number, z0: number, z1: number, yTop: number) =>
      p.x.greaterThan(x0).and(p.x.lessThan(x1)).and(p.z.greaterThan(z0)).and(p.z.lessThan(z1)).and(p.y.lessThan(yTop));
    const sheltered = inRect(P.x0 - P.overhang, P.x1 + P.overhang, P.z0 - P.overhang, P.z1 + P.overhang, P.floor + P.height)
      .or(inRect(DIMS.DECK.x0, DIMS.DECK.x1, DIMS.DECK.z0, DIMS.DECK.z1, DIMS.DECK.top - 0.1))
      .or(inRect(DIMS.HELIPAD.x0, DIMS.HELIPAD.x1, DIMS.HELIPAD.z0, DIMS.HELIPAD.z1, DIMS.HELIPAD.top - 0.25))
      .or(inRect(DIMS.ELEVATOR.x0, DIMS.ELEVATOR.x1, DIMS.ELEVATOR.z0, DIMS.ELEVATOR.z1, DIMS.ELEVATOR.head))
      .or(inDrone(p))
      .or(inDrone(p.add(dir.mul(len))))
      .or(p.y.lessThan(0.0));
    const visible = select(sheltered, float(0), active.mul(smoothstep(sd.w, sd.w.add(0.05), U.rain)));
    const toCam = normalize(cameraPosition.sub(p));
    const side = normalize(cross(dir, toCam));
    return p.add(side.mul(c.x.mul(0.006).mul(visible))).add(dir.mul(c.y.mul(len).mul(visible)));
  })();
  m.colorNode = Fn(() => vec3(U.fogColor).mul(0.9).add(vec3(0.6, 0.65, 0.75).mul(U.lightning.mul(40))))();
  m.opacityNode = float(0.14);
  const mesh = new Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 20;
  return {
    mesh,
    update() {
      active.value = U.rain.value > 0.02 ? 1 : 0;
      mesh.visible = active.value > 0;
    },
  };
}

/** Plunge pool water: transmissive surface with animated ripples. */
export function createPoolWater() {
  const P = DIMS.POOL;
  const geo = new PlaneGeometry(P.x1 - P.x0, P.z1 - P.z0, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const m = new MeshPhysicalNodeMaterial({
    color: new Color(0xe6fbff),
    metalness: 0,
    roughness: 0.03,
    transmission: 1,
    ior: 1.333,
    thickness: 1.2,
    attenuationColor: new Color(0x5fc7d6),
    attenuationDistance: 2.5,
  });
  const n = Fn(() => {
    const pos = attribute('position', 'vec3') as any;
    const p = vec3(pos.x, U.time.mul(0.4), pos.z);
    const e = 0.08;
    const h = (q: any) => mx_noise_float(q.mul(vec3(1.6, 1, 1.6))).add(mx_noise_float(q.mul(vec3(4.1, 1.7, 4.1))).mul(0.35));
    const hx = h(p.add(vec3(e, 0, 0))).sub(h(p));
    const hz = h(p.add(vec3(0, 0, e))).sub(h(p));
    const amp = float(0.35).add(U.rain.mul(1.5)).add(U.windSpeed.mul(0.02));
    return transformNormalToView(normalize(vec3(hx.mul(amp).negate(), float(1), hz.mul(amp).negate())));
  })();
  m.normalNode = n;
  const mesh = new Mesh(geo, m);
  mesh.position.set((P.x0 + P.x1) / 2, P.water, (P.z0 + P.z1) / 2);
  mesh.receiveShadow = true;
  return mesh;
}
