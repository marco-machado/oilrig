import { type Camera, RenderPipeline, type Scene, type WebGPURenderer } from 'three/webgpu';
import {
  add,
  unpackRGBToNormal,
  packNormalToRGB,
  float,
  metalness,
  mrt,
  normalView,
  output,
  pass,
  roughness,
  sample,
  vec2,
  vec4,
  velocity,
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { lensflare } from 'three/addons/tsl/display/LensflareNode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { U } from '../state.ts';
import type { Quality } from './quality.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Scene pass with MRT (colour, normals, velocity) → GTAO → exposure → TRAA → bloom +
 * lens flare. Tone mapping and colour space conversion happen at the pipeline output.
 */
export function createPipeline(renderer: WebGPURenderer, scene: Scene, camera: Camera, q: Quality) {
  const pipeline = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  scenePass.setMRT(
    mrt({
      output,
      normal: packNormalToRGB(normalView),
      velocity,
      ...(q.ssr ? { metalrough: vec2(metalness, roughness) } : {}),
    }),
  );
  const color = scenePass.getTextureNode('output');
  const depth = scenePass.getTextureNode('depth');
  const normalTex = scenePass.getTextureNode('normal');
  const vel = scenePass.getTextureNode('velocity');

  const normal = sample((uv: any) => unpackRGBToNormal(normalTex.sample(uv)));
  let lit: any = color;
  if (q.ssr) {
    // Screen-space reflections (Ultra): the platform in the sea, wet teak, polished floors.
    const mr = scenePass.getTextureNode('metalrough');
    const reflections: any = ssr(color, depth, normal, {
      metalnessNode: mr.r,
      roughnessNode: mr.g,
      reflectNonMetals: true,
      camera,
    });
    lit = vec4(color.rgb.add(reflections.rgb.mul(0.6)), color.a);
  }
  if (q.ao) {
    const aoPass = ao(depth, normal, camera);
    aoPass.resolutionScale = q.aoScale;
    aoPass.radius.value = 0.6;
    aoPass.thickness.value = 1.0;
    const aoValue = aoPass.getTextureNode().r;
    lit = vec4(lit.rgb.mul(aoValue.mul(0.85).add(0.15)), color.a);
  }
  const exposed = vec4(lit.rgb.mul(U.exposure), float(1));
  let out: any = q.traa ? traa(exposed, depth, vel, camera) : exposed;
  if (q.bloom) {
    const b = bloom(out, 0.08, 0.4, 1.2);
    const flare: any = lensflare(b, { threshold: float(6), ghostAttenuationFactor: float(40), ghostSpacing: float(0.22) });
    out = add(out, b).add(flare.mul(0.08));
  }
  pipeline.outputNode = out;
  // The scene pass too, so its pipelines can be compiled before the first frame.
  return Object.assign(pipeline, { scenePass });
}
