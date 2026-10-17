import {
  BoxGeometry,
  type BufferGeometry,
  CircleGeometry,
  Group,
  Mesh,
  PointLight,
  SphereGeometry,
  Vector3,
} from 'three/webgpu';
import { uniform } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Layout, LightDef } from '@ocean-home/shared';
import type { AimedLight } from '../render/stableClusteredLighting.ts';
import { U } from '../state.ts';
import type { MaterialSet } from './materials/index.ts';
import { emissiveMaterial } from './props.ts';

export interface NightLights {
  group: Group;
  update(time: number): void;
}

/** Point lights (clustered) and their emissive fixtures, switched on at dusk. */
export function buildLights(layout: Layout, materials: MaterialSet): NightLights {
  const group = new Group();
  const lights: Array<{ def: LightDef; light: PointLight }> = [];
  const blink = uniform(0);
  const red = emissiveMaterial(0xff2a14, 30, blink);
  const pool = emissiveMaterial(0x9fe8ff, 25);
  const fixtures = new Map<string, { mat: typeof red; geos: BufferGeometry[] }>();
  const addFixture = (key: string, mat: typeof red, g: BufferGeometry) => {
    const f = fixtures.get(key) ?? { mat, geos: [] };
    f.geos.push(g);
    fixtures.set(key, f);
  };

  for (const def of layout.lights) {
    const [x, y, z] = def.position;
    if (def.casts) {
      const l = new PointLight(def.color, 0, def.distance, 2);
      l.position.set(x, y, z);
      l.castShadow = false;
      if (def.aim && def.cone !== undefined) Object.assign(l.userData, { aim: new Vector3(...def.aim), cone: def.cone } satisfies AimedLight);
      group.add(l);
      lights.push({ def, light: l });
    }
    switch (def.kind) {
      case 'downlight': {
        const g = new CircleGeometry(0.09, 16);
        g.rotateX(Math.PI / 2);
        g.translate(x, y - 0.001, z);
        addFixture('lamp', materials.lamp as typeof red, g);
        break;
      }
      case 'bulkhead': {
        const g = new BoxGeometry(0.28, 0.1, 0.16);
        g.translate(x, y, z);
        addFixture('lamp', materials.lamp as typeof red, g);
        break;
      }
      case 'obstruction': {
        const g = new SphereGeometry(0.12, 12, 8);
        g.translate(x, y, z);
        addFixture('red', red, g);
        break;
      }
      case 'poolLight': {
        const g = new CircleGeometry(0.12, 16);
        g.translate(x, y, z + 0.29);
        addFixture('pool', pool, g);
        break;
      }
      default:
        break;
    }
  }
  for (const [, f] of fixtures) {
    const mesh = new Mesh(mergeGeometries(f.geos, false)!, f.mat);
    group.add(mesh);
  }

  return {
    group,
    update(time: number) {
      const night = U.nightLights.value;
      const on = Math.sin(time * Math.PI) > 0.2 ? 1 : 0.05;
      blink.value = night * on + (1 - night) * 0.25 * on;
      for (const { def, light } of lights) {
        let k = night;
        if (def.kind === 'obstruction') k = blink.value;
        if (def.kind === 'helipadEdge') k = 0.15 + 0.85 * night;
        // Intensity only, never visibility: the light set is part of every lit material's
        // shader key, so hiding a light rebuilds the scene's shaders (multi-second freezes).
        light.intensity = def.intensity * k;
      }
    },
  };
}
