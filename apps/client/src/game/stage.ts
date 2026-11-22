import RAPIER from '@dimforge/rapier3d-compat';
import { NeutralToneMapping, PerspectiveCamera, type PointLight, Scene, Vector3, WebGPURenderer } from 'three/webgpu';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { SunLightNode } from 'three/addons/lights/SunLightNode.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { buildStaticWorld, getLayout } from '@oilrig/shared';
import { debugParams } from '../debug.ts';
import { Atmosphere } from '../env/atmosphere.ts';
import { SoundEngine } from '../env/audio.ts';
import { Ocean } from '../env/ocean/ocean.ts';
import { createPoolWater, createRain } from '../env/rain.ts';
import { hideLoading, setLoading } from '../loading.ts';
import { Avatars } from '../net/avatars.ts';
import { Profiler, gpuTimingWanted } from '../perf.ts';
import { Controls } from '../player/controls.ts';
import { DynamicResolution } from '../render/dynamicResolution.ts';
import { lampLightAt } from '../render/localLight.ts';
import { QUALITY, loadQualityName } from '../render/quality.ts';
import { StableClusteredLighting } from '../render/stableClusteredLighting.ts';
import { loadSettings } from '../ui/ui.ts';
import { Doors } from '../world/doors.ts';
import { Drone } from '../world/drone.ts';
import { ElevatorView } from '../world/elevator.ts';
import { buildFurniture } from '../world/furniture.ts';
import { InteriorLight } from '../world/interiorLight.ts';
import { buildLights } from '../world/lights.ts';
import { createMaterials } from '../world/materials/index.ts';
import { buildProps } from '../world/props.ts';
import { buildStructure } from '../world/structure.ts';
import { Tender } from '../world/tender.ts';

/** Sample offsets (m) around a point, for lamplight estimates. */
export const RING: Array<[number, number]> = [
  [2.5, 0],
  [-2.5, 0],
  [0, 2.5],
  [0, -2.5],
];

/** Everything that is built once and then only updated: the renderer, the scene and what stands in it. */
export type Stage = NonNullable<Awaited<ReturnType<typeof buildStage>>>;

/** Starts physics and WebGPU and builds the world; null (with a message in `app`) when WebGPU will not start. */
export async function buildStage(app: HTMLElement) {
  const dbg = debugParams();
  const settings = loadSettings(dbg.quality ?? loadQualityName());
  const off = dbg.off;
  const base = QUALITY[dbg.quality ?? settings.quality];
  // ?off= switches features off to measure their cost (see the performance overlay).
  const q = { ...base, ao: base.ao && !off.has('ao'), bloom: base.bloom && !off.has('bloom'), traa: base.traa && !off.has('traa'), ssr: base.ssr && !off.has('ssr') };
  const prof = new Profiler(gpuTimingWanted());

  await setLoading('Starting physics…', 0.12);
  await RAPIER.init();
  await setLoading('Building the platform…', 0.25);
  const layout = getLayout();
  const sw = buildStaticWorld(RAPIER, layout);

  await setLoading('Starting WebGPU…', 0.35);
  const renderer = new WebGPURenderer({ antialias: false, powerPreference: 'high-performance', trackTimestamp: prof.gpuEnabled });
  await renderer.init();
  if (!(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend) {
    hideLoading();
    app.innerHTML = `<div class="fatal">WebGPU could not be initialised on this device.</div>`;
    return null;
  }
  SunLight.registerNode(SunLightNode);
  renderer.lighting = new StableClusteredLighting();
  renderer.toneMapping = NeutralToneMapping;
  renderer.shadowMap.enabled = !off.has('shadows');
  // Never more than 2 device pixels per CSS pixel: Ultra's supersampling on a Retina screen
  // would otherwise render 9× the pixels of the window.
  const basePixelRatio = Math.min(2, Math.min(window.devicePixelRatio, 2) * q.pixelRatio);
  renderer.setPixelRatio(basePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  app.appendChild(renderer.domElement);
  prof.attach(renderer, q.name);
  // Fixed-camera captures and ?fixedres measure at the preset's full resolution.
  const fixedRes = !!dbg.camera || new URLSearchParams(location.search).has('fixedres');
  const dynRes = new DynamicResolution(renderer, basePixelRatio, settings.autoResolution && !fixedRes);

  const labels = new CSS2DRenderer();
  labels.setSize(window.innerWidth, window.innerHeight);
  Object.assign(labels.domElement.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '5' });
  document.body.appendChild(labels.domElement);

  const scene = new Scene();
  prof.watchLights(scene);
  const camera = new PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.1, 30000);
  scene.add(camera);

  await setLoading('Generating the world…', 0.45);
  // World.
  const materials = createMaterials();
  const structure = buildStructure(layout, materials);
  scene.add(structure);
  const props = buildProps(layout, materials, off.has('grass') ? 0 : q.grassDensity);
  scene.add(props.group);
  const lights = buildLights(layout, materials);
  scene.add(lights.group);
  const doors = new Doors(layout, materials, sw);
  scene.add(doors.group);
  const furniture = buildFurniture(layout, materials);
  scene.add(furniture.group);
  const lift = new ElevatorView(materials);
  scene.add(lift.group);
  const poolWater = createPoolWater();
  scene.add(poolWater);
  const atmosphere = new Atmosphere(renderer, scene, { shadowMapSize: q.shadowMapSize, shadowDistance: q.shadowDistance });
  const ocean = new Ocean(renderer, { N: q.oceanN, rings: q.oceanRings, sectors: q.oceanSectors });
  if (!off.has('ocean')) scene.add(ocean.mesh);
  const rain = createRain(q.rainDrops);
  if (!off.has('rain')) scene.add(rain.mesh);
  const avatars = new Avatars();
  scene.add(avatars.group);
  const drone = new Drone();
  scene.add(drone.group, drone.spray.mesh);
  const tender = new Tender(renderer, ocean, layout.vessels[0], materials);
  scene.add(tender.group, tender.lines);
  // Every lamp in the world, for the exposure's adaptation to lamplight.
  const lamps: PointLight[] = [];
  scene.traverse((o) => {
    if ((o as PointLight).isPointLight) lamps.push(o as PointLight);
  });
  const lampProbe = new Vector3();
  /**
   * Lamplight on the floor around the camera (what the eye sees lit, not what shines into it),
   * on a ring as well as underfoot so walking under one lamp does not pump the exposure.
   */
  const lampsAround = (p: Vector3) => {
    let e = 0;
    for (const [dx, dz] of [[0, 0], ...RING]) e += lampLightAt(lamps, lampProbe.set(p.x + dx, p.y - 1.5, p.z + dz));
    return e / (RING.length + 1);
  };
  // Hidden while probes bake: anything transmissive or refractive (it would need its own
  // framebuffer copies at probe resolution) plus dynamic clutter.
  const transmissive = structure.children.filter((o) => /glass/i.test(o.name));
  const interior = new InteriorLight(renderer, scene, [
    ocean.mesh,
    rain.mesh,
    avatars.group,
    props.group,
    poolWater,
    doors.group,
    lift.group,
    drone.group,
    drone.spray.mesh,
    tender.group,
    tender.lines,
    ...furniture.dynamic,
    ...transmissive,
  ]);
  const sound = new SoundEngine();
  sound.setVolume(settings.volume);
  atmosphere.onLightning = (d) => sound.thunder(d);
  doors.onMove = (def) => sound.playAt('door-slide.mp3', def.center, 0.7, 3);

  // Player.
  const controls = new Controls(renderer.domElement);
  controls.settings.sensitivity = settings.sensitivity;
  controls.settings.invertY = settings.invertY;

  return {
    dbg,
    settings,
    off,
    q,
    prof,
    layout,
    sw,
    renderer,
    fixedRes,
    dynRes,
    labels,
    scene,
    camera,
    props,
    lights,
    doors,
    furniture,
    lift,
    atmosphere,
    ocean,
    rain,
    avatars,
    drone,
    tender,
    lamps,
    lampsAround,
    interior,
    sound,
    controls,
  };
}
