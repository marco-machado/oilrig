import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardNodeMaterial,
  SphereGeometry,
  type Material,
} from 'three/webgpu';
import {
  attribute,
  color,
  float,
  mix,
  positionLocal,
  sin,
  smoothstep,
  uv,
  vec3,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { type Layout, type PropDef, mulberry32 } from '@oilrig/shared';
import { U } from '../state.ts';
import type { MaterialSet } from './materials/index.ts';
import { boxGeometry, tubeGeometry } from './structure.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

function grassMaterial() {
  const m = new MeshStandardNodeMaterial();
  m.side = DoubleSide;
  const sway = attribute('aSway', 'vec2') as any; // (height factor², phase)
  const tint = attribute('aTint', 'float') as any;
  const gust = sin(U.time.mul(0.7).add(sway.y.mul(0.3))).mul(0.5).add(0.5);
  const strength = U.windSpeed.mul(0.018).add(0.02);
  const wave = sin(U.time.mul(2.4).add(sway.y)).mul(0.35).add(0.65).add(gust.mul(0.4));
  const off = vec3(U.windDir.x, 0, U.windDir.y).mul(sway.x.mul(strength).mul(wave));
  m.positionNode = positionLocal.add(off).sub(vec3(0, sway.x.mul(strength).mul(0.35), 0));
  const h = uv().y;
  const base = mix(color(0x3b4a1c), color(0x6f7a2e), tint);
  const tip = mix(color(0xc9b76a), color(0xa8b55a), tint);
  m.colorNode = mix(base, tip, smoothstep(0.1, 1.0, h)).mul(float(1).sub(U.wetness.mul(0.25)));
  m.roughnessNode = float(0.75).sub(U.wetness.mul(0.35));
  m.metalnessNode = float(0);
  return m;
}

function grassBed(p: PropDef, density: number, seed: number): BufferGeometry {
  const [sx, , sz] = p.size ?? [1, 0, 1];
  const count = Math.round(sx * sz * density);
  const rand = mulberry32(seed);
  const verts = 5;
  const pos = new Float32Array(count * verts * 3);
  const nor = new Float32Array(count * verts * 3);
  const uvs = new Float32Array(count * verts * 2);
  const sway = new Float32Array(count * verts * 2);
  const tint = new Float32Array(count * verts);
  const idx: number[] = [];
  for (let i = 0; i < count; i++) {
    const bx = p.position[0] + (rand() - 0.5) * sx;
    const bz = p.position[2] + (rand() - 0.5) * sz;
    const by = p.position[1];
    const h = 0.35 + rand() * 0.45;
    const w = 0.008 + rand() * 0.008;
    const yaw = rand() * Math.PI * 2;
    const lean = rand() * 0.35;
    const lx = Math.cos(yaw);
    const lz = Math.sin(yaw);
    const px = -lz;
    const pz = lx;
    const phase = rand() * Math.PI * 2;
    const t = rand();
    const shape: Array<[number, number]> = [
      [-w, 0],
      [w, 0],
      [-w * 0.6, 0.5],
      [w * 0.6, 0.5],
      [0, 1],
    ];
    shape.forEach(([s, f], k) => {
      const o = (i * verts + k) * 3;
      const bend = lean * f * f * h;
      pos[o] = bx + px * s + lx * bend;
      pos[o + 1] = by + f * h;
      pos[o + 2] = bz + pz * s + lz * bend;
      nor[o] = lx * 0.5;
      nor[o + 1] = 0.85;
      nor[o + 2] = lz * 0.5;
      const u = (i * verts + k) * 2;
      uvs[u] = s > 0 ? 1 : 0;
      uvs[u + 1] = f;
      sway[u] = f * f * h;
      sway[u + 1] = phase;
      tint[i * verts + k] = t;
    });
    const b = i * verts;
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2, b + 2, b + 3, b + 4);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setAttribute('uv', new BufferAttribute(uvs, 2));
  g.setAttribute('aSway', new BufferAttribute(sway, 2));
  g.setAttribute('aTint', new BufferAttribute(tint, 1));
  g.setIndex(idx);
  return g;
}

function windsock(): { group: Group; sock: Mesh } {
  const group = new Group();
  const geo = new CylinderGeometry(0.32, 0.12, 1.8, 20, 12, true);
  geo.rotateZ(Math.PI / 2);
  geo.translate(0.9, 0, 0);
  const m = new MeshStandardNodeMaterial();
  m.side = DoubleSide;
  const x = positionLocal.x.div(1.8);
  const stripe = sin(x.mul(Math.PI * 5)).greaterThan(0);
  m.colorNode = mix(color(0xf2f0ea), color(0xff5a14), stripe.select(float(1), float(0)));
  m.roughnessNode = float(0.8);
  const flutter = sin(U.time.mul(9).sub(x.mul(9))).mul(x).mul(0.05).mul(U.windSpeed.div(10).add(0.2));
  m.positionNode = positionLocal.add(vec3(0, flutter, flutter.mul(0.6)));
  const sock = new Mesh(geo, m);
  sock.castShadow = true;
  group.add(sock);
  const ring = new Mesh(new CylinderGeometry(0.34, 0.34, 0.05, 20, 1, true).rotateZ(Math.PI / 2), m);
  group.add(ring);
  return { group, sock };
}

function emissiveMaterial(hex: number, strength: number, gate: any = U.nightLights) {
  const m = new MeshStandardNodeMaterial({ color: new Color(0x111111), roughness: 0.4 });
  m.emissiveNode = color(hex).mul(gate.mul(strength));
  return m;
}

export interface Props {
  group: Group;
  update(dt: number): void;
}

export function buildProps(layout: Layout, materials: MaterialSet, grassDensity: number): Props {
  const group = new Group();
  const bins = new Map<Material, BufferGeometry[]>();
  const add = (m: Material, g: BufferGeometry) => {
    const list = bins.get(m) ?? [];
    list.push(g);
    bins.set(m, list);
  };
  const grassGeos: BufferGeometry[] = [];
  const helipadGreen = emissiveMaterial(0x2bff5c, 14, U.nightLights.mul(0.85).add(0.15));
  let windsockGroup: Group | null = null;

  layout.props.forEach((p, i) => {
    const [x, y, z] = p.position;
    switch (p.kind) {
      case 'grass': {
        grassGeos.push(grassBed(p, grassDensity, 1000 + i));
        const [sx, , sz] = p.size ?? [1, 0, 1];
        add(materials.soil, boxGeometry([x, y - 0.02, z], [sx, 0.04, sz]));
        break;
      }
      case 'windsock': {
        const w = windsock();
        w.group.position.set(x, y, z);
        windsockGroup = w.group;
        group.add(w.group);
        break;
      }
      case 'ladder': {
        const [w, h] = p.size ?? [0.6, 3, 0];
        for (const s of [-1, 1]) add(materials.steelGrey, tubeGeometry([x + (s * w) / 2, y, z], [x + (s * w) / 2, y - h, z], 0.025, 8));
        for (let ry = y - 0.3; ry > y - h; ry -= 0.3) add(materials.steelGrey, tubeGeometry([x - w / 2, ry, z], [x + w / 2, ry, z], 0.016, 6));
        break;
      }
      case 'fender': {
        add(materials.rubber, tubeGeometry([x, y - 0.9, z], [x, y + 0.9, z], 0.26, 16));
        break;
      }
      case 'bollard': {
        add(materials.mullion, tubeGeometry([x, y, z], [x, y + 0.7, z], 0.07, 12));
        add(materials.lamp, tubeGeometry([x, y + 0.62, z], [x, y + 0.72, z], 0.075, 12));
        add(materials.mullion, tubeGeometry([x, y + 0.72, z], [x, y + 0.76, z], 0.09, 12));
        break;
      }
      case 'helipadLight': {
        const g = new SphereGeometry(0.08, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
        g.translate(x, y, z);
        add(helipadGreen, g);
        break;
      }
      case 'flood': {
        add(materials.steelGrey, tubeGeometry([x, y, z], [x, y + 0.55, z], 0.04, 8));
        const g = new BoxGeometry(0.34, 0.26, 0.14);
        g.rotateY(p.rotationY ?? 0);
        g.translate(x, y + 0.65, z);
        add(materials.lamp, g);
        break;
      }
    }
  });

  for (const [m, list] of bins) {
    const merged = mergeGeometries(list, false);
    if (!merged) continue;
    const mesh = new Mesh(merged, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (grassGeos.length) {
    const grass = new Mesh(mergeGeometries(grassGeos, false)!, grassMaterial());
    grass.receiveShadow = true;
    grass.castShadow = false;
    grass.name = 'grass';
    group.add(grass);
  }

  return {
    group,
    update() {
      if (!windsockGroup) return;
      const wd = U.windDir.value;
      const speed = U.windSpeed.value;
      const yaw = Math.atan2(-wd.y, wd.x);
      const droop = (1 - Math.min(1, speed / 14)) * 1.25;
      windsockGroup.rotation.set(0, yaw, -droop, 'YXZ');
    },
  };
}

export { emissiveMaterial };
