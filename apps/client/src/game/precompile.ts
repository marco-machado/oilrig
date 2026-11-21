import { type Light, type Object3D, Vector3 } from 'three/webgpu';
import { celestialAt } from '@ocean-home/shared';
import type { createPipeline } from '../render/pipeline.ts';
import type { Game } from './game.ts';

/**
 * Compiles the pipelines of the first frames behind the loading screen, in the background and
 * in parallel. Built by the first frames instead, one at a time on the GPU's main thread, they
 * froze a cold start (shaders new to the GPU) for ~20 s. Needs three r187: r186 compiles one
 * object at a time and its post-processing pass rebuilds everything anyway.
 * See docs/startup-shader-compile.md.
 */
export async function precompile(g: Game, pipeline: ReturnType<typeof createPipeline>) {
  const { atmosphere, camera, dbg, interior, lights, off, renderer, scene } = g.stage;
  const now = Date.now();
  const gms = g.gameNow(now, 0);
  const celestial = celestialAt(gms);
  const weather = { ...g.localWeather.sample(gms, now), ...dbg.weather };
  // The environment map, sun and lamps as the first frame will have them.
  atmosphere.update(0, camera.position, celestial, weather);
  lights.update(0);
  // Everything, not only what the boot camera sees: the drone, for one, starts hidden.
  const saved: Array<[Object3D, boolean, boolean]> = [];
  scene.traverse((o) => {
    saved.push([o, o.frustumCulled, o.visible]);
    o.frustumCulled = false;
    if (!(o as Light).isLight) o.visible = true;
  });
  try {
    if (!off.has('probes')) {
      await interior.compileAsync();
      // Once baked, the grid takes part in every lit shader: bake its first probe now, so the
      // scene compiles against the grid the first frame sees.
      interior.update(new Vector3(...celestial.sunDirection), weather.cloudCover);
    }
    await pipeline.scenePass.compileAsync(renderer);
  } finally {
    for (const [o, culled, visible] of saved) {
      o.frustumCulled = culled;
      o.visible = visible;
    }
  }
}
