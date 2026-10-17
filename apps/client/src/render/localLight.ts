import { type PointLight, Vector3 } from 'three/webgpu';
import { type AimedLight, CONE_SOFTNESS } from './stableClusteredLighting.ts';

const at = new Vector3();
const d = new Vector3();

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Light from lamps (point lights, with their cones and range) falling at `p`, in the units of
 * the sun's irradiance. The exposure adapts to it the way it adapts to daylight, and unlit
 * effects (rotor spray) use it to pick up the lamps around them.
 */
export function lampLightAt(lights: readonly PointLight[], p: Vector3): number {
  let e = 0;
  for (const l of lights) {
    if (l.intensity <= 0) continue;
    at.setFromMatrixPosition(l.matrixWorld);
    d.subVectors(p, at);
    const d2 = d.lengthSq();
    const r2 = l.distance * l.distance;
    if (l.distance > 0 && d2 >= r2) continue;
    let k = 1;
    const u = l.userData as AimedLight;
    if (u.aim && u.cone !== undefined) {
      k = smooth(u.cone, u.cone + CONE_SOFTNESS, d.dot(u.aim) / Math.sqrt(d2 || 1));
      if (k <= 0) continue;
    }
    // three's range window: (1 - (d/r)^4)^2.
    const window = l.distance > 0 ? (1 - (d2 / r2) ** 2) ** 2 : 1;
    const lum = 0.2126 * l.color.r + 0.7152 * l.color.g + 0.0722 * l.color.b;
    e += (l.intensity * lum * k * window) / Math.max(d2, 1);
  }
  return e;
}
