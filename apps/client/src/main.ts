import RAPIER from '@dimforge/rapier3d-compat';
import { NeutralToneMapping, PerspectiveCamera, Scene, Timer, Vector3, WebGPURenderer } from 'three/webgpu';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { SunLightNode } from 'three/addons/lights/SunLightNode.js';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import {
  type ClockConfig,
  DEFAULT_EPOCH,
  HeliScheduler,
  type HeliState,
  PLAYER,
  WORLD,
  WeatherModel,
  type WeatherState,
  buildStaticWorld,
  celestialAt,
  gameTime,
  getLayout,
  heliPose,
  makeClock,
} from '@ocean-home/shared';
import { Atmosphere } from './env/atmosphere.ts';
import { SoundEngine } from './env/audio.ts';
import { Ocean } from './env/ocean/ocean.ts';
import { createPoolWater, createRain } from './env/rain.ts';
import { Avatars } from './net/avatars.ts';
import { NetClient } from './net/client.ts';
import { Controls } from './player/controls.ts';
import { Player } from './player/player.ts';
import { createPipeline } from './render/pipeline.ts';
import { QUALITY, loadQualityName, saveQualityName } from './render/quality.ts';
import { U } from './state.ts';
import { UI, loadSettings } from './ui/ui.ts';
import { Doors } from './world/doors.ts';
import { buildFurniture } from './world/furniture.ts';
import { Helicopter } from './world/helicopter.ts';
import { Tender } from './world/tender.ts';
import { InteriorLight } from './world/interiorLight.ts';
import { buildLights } from './world/lights.ts';
import { createMaterials } from './world/materials/index.ts';
import { buildProps } from './world/props.ts';
import { buildStructure } from './world/structure.ts';
import { debugParams } from './debug.ts';

const DEFAULT_SEED = 1337;

async function boot() {
  const app = document.getElementById('app')!;
  if (!('gpu' in navigator)) {
    app.innerHTML = `<div class="fatal">Ocean Home needs WebGPU.<br/>Use a current Chrome or Edge, or Safari 26+.</div>`;
    return;
  }
  const dbg = debugParams();
  const settings = loadSettings(dbg.quality ?? loadQualityName());
  const q = QUALITY[dbg.quality ?? settings.quality];

  await RAPIER.init();
  const layout = getLayout();
  const sw = buildStaticWorld(RAPIER, layout);

  const renderer = new WebGPURenderer({ antialias: false, powerPreference: 'high-performance' });
  await renderer.init();
  if (!(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend) {
    app.innerHTML = `<div class="fatal">WebGPU could not be initialised on this device.</div>`;
    return;
  }
  renderer.library.addLight(SunLightNode, SunLight);
  renderer.lighting = new ClusteredLighting();
  renderer.toneMapping = NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * q.pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  app.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.setSize(window.innerWidth, window.innerHeight);
  Object.assign(labels.domElement.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '5' });
  document.body.appendChild(labels.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.1, 30000);
  scene.add(camera);

  // World.
  const materials = createMaterials();
  const structure = buildStructure(layout, materials);
  scene.add(structure);
  const props = buildProps(layout, materials, q.grassDensity);
  scene.add(props.group);
  const lights = buildLights(layout, materials);
  scene.add(lights.group);
  const doors = new Doors(layout, materials, sw);
  scene.add(doors.group);
  const furniture = buildFurniture(layout, materials);
  scene.add(furniture.group);
  const poolWater = createPoolWater();
  scene.add(poolWater);
  const atmosphere = new Atmosphere(renderer, scene, { shadowMapSize: q.shadowMapSize, shadowDistance: q.shadowDistance });
  const ocean = new Ocean(renderer, { N: q.oceanN, rings: q.oceanRings, sectors: q.oceanSectors });
  scene.add(ocean.mesh);
  const rain = createRain(q.rainDrops);
  scene.add(rain.mesh);
  const avatars = new Avatars();
  scene.add(avatars.group);
  const heli = new Helicopter();
  scene.add(heli.group, heli.spray.mesh);
  const tender = new Tender(renderer, ocean, layout.vessels[0], materials);
  scene.add(tender.group, tender.lines);
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
    heli.group,
    heli.spray.mesh,
    tender.group,
    tender.lines,
    ...furniture.dynamic,
    ...transmissive,
  ]);
  const sunDir = new Vector3();
  const listenerFwd = new Vector3();
  const listenerUp = new Vector3();
  const sound = new SoundEngine();
  sound.setVolume(settings.volume);
  atmosphere.onLightning = (d) => sound.thunder(d);

  // Player.
  const controls = new Controls(renderer.domElement);
  controls.settings.sensitivity = settings.sensitivity;
  controls.settings.invertY = settings.invertY;

  // Shared world state (server-driven when online).
  let clock: ClockConfig = makeClock({ realTime: false, dayLengthMinutes: 120 });
  const localWeather = new WeatherModel(DEFAULT_SEED, DEFAULT_EPOCH);
  let serverWeather: WeatherState | null = null;
  let online = false;
  let joined = false;
  let selfId = '';
  let lastPose = 0;
  let poseSeq = 0;
  let respawnTimer = 0;
  const playerList = new Map<string, { id: string; name: string; color: string; kind?: 'human' | 'agent' }>();
  // The helicopter: the server's schedule when online, a local one offline (or a fixed
  // phase from the URL for captures).
  const localHeli = new HeliScheduler({ intervalMs: 8 * 60_000, stayMs: 2 * 60_000, firstArrivalMs: 20_000, seed: 3 }, Date.now());
  let heliState: HeliState = dbg.heli ? dbg.heli(Date.now()) : localHeli.state;
  let parkedYaw: number | null = null;
  const heliNews: Record<string, string> = {
    approach: 'A helicopter is approaching.',
    hold: 'The helicopter is holding off: please clear the helipad.',
    landed: 'The helicopter has landed on the helipad.',
    depart: 'The helicopter is lifting off.',
  };
  const setHeli = (next: HeliState, announce: boolean) => {
    if (announce && next.phase !== heliState.phase && heliNews[next.phase]) ui.addChat({ system: heliNews[next.phase] });
    heliState = next;
  };

  const ui = new UI(
    {
      onJoin(name, password) {
        sound.start();
        if (dbg.offline) {
          enterWorld();
          return;
        }
        net.connect(name, password);
      },
      onResume() {
        ui.hideOverlay();
        controls.lock();
      },
      onChat(text) {
        if (online) net.send({ type: 'chat', text });
        else ui.addChat({ id: 'local', from: 'local', name: 'You', text, t: Date.now() });
      },
      onSettings(s, qualityChanged) {
        camera.fov = s.fov;
        camera.updateProjectionMatrix();
        controls.settings.sensitivity = s.sensitivity;
        controls.settings.invertY = s.invertY;
        sound.setVolume(s.volume);
        if (qualityChanged) {
          saveQualityName(s.quality);
          location.reload();
        }
      },
    },
    settings,
    dbg.name,
  );

  const player = new Player(sw, layout, camera, controls, {
    onFootstep: (surface, run) => sound.footstep(surface, run),
    onLand: (surface, speed) => sound.footstep(surface, true, Math.min(2, speed / 4)),
    onInteract: (id) => {
      const open = !doors.isOpen(id);
      if (online) net.send({ type: 'door', id, open });
      else doors.setOpen(id, open);
    },
    onFellInSea: () => {
      ui.setFade(true);
      player.frozen = true;
      respawnTimer = 0.8;
    },
  });

  function enterWorld() {
    joined = true;
    ui.joined = true;
    controls.enabled = true;
    ui.hideOverlay();
    controls.lock();
  }

  const net = new NetClient({
    onWelcome(w) {
      online = true;
      selfId = w.you.id;
      avatars.selfId = selfId;
      avatars.clear();
      clock = w.clock;
      serverWeather = w.weather as WeatherState;
      playerList.clear();
      for (const p of w.players) {
        playerList.set(p.id, p);
        avatars.add(p);
      }
      for (const [id, open] of Object.entries(w.doors)) doors.setOpen(id, open);
      if (w.heli && !dbg.heli) setHeli(w.heli as HeliState, false);
      if (!joined) {
        player.teleport(w.pose.p, w.pose.yaw);
        for (const c of w.chat) ui.addChat(c);
        ui.addChat({ system: `Welcome aboard, ${w.you.name}.` });
        enterWorld();
      } else {
        ui.addChat({ system: 'Reconnected.' });
      }
      ui.setPlayers([...playerList.values()], true);
    },
    onMessage(m) {
      switch (m.type) {
        case 'snapshot':
          avatars.snapshot(m.t, m.players);
          break;
        case 'join':
          playerList.set(m.player.id, m.player);
          avatars.add(m.player);
          ui.addChat({ system: `${m.player.name} came aboard.` });
          ui.setPlayers([...playerList.values()], true);
          break;
        case 'leave': {
          const p = playerList.get(m.id);
          playerList.delete(m.id);
          avatars.remove(m.id);
          if (p) ui.addChat({ system: `${p.name} left.` });
          ui.setPlayers([...playerList.values()], true);
          break;
        }
        case 'env':
          serverWeather = m.weather as WeatherState;
          break;
        case 'chat':
          ui.addChat(m.entry);
          if (m.entry.from !== selfId) avatars.say(m.entry.from, m.entry.text);
          break;
        case 'door':
          doors.setOpen(m.id, m.open);
          break;
        case 'heli':
          if (!dbg.heli) setHeli(m.state as HeliState, true);
          break;
        case 'correct':
          player.teleport(m.p);
          break;
        default:
          break;
      }
    },
    onClose(reason, willRetry) {
      online = false;
      ui.setPlayers([], false);
      if (!joined) ui.joinFailed(willRetry ? reason : reason);
      else ui.addChat({ system: reason });
    },
  });

  controls.onPointerLockChange = (locked) => {
    if (!locked && joined && !ui.chatOpen) ui.showPause();
  };
  renderer.domElement.addEventListener('click', () => {
    if (joined && !ui.overlayVisible) controls.lock();
  });
  document.addEventListener('keydown', (e) => {
    if (!joined || ui.overlayVisible) return;
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'KeyT' || e.code === 'Enter') {
      e.preventDefault();
      ui.openChat();
      controls.unlock();
    }
    if (e.code === 'Tab') {
      e.preventDefault();
      ui.togglePlayers(true);
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'Tab') ui.togglePlayers(false);
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labels.setSize(window.innerWidth, window.innerHeight);
  });

  const pipeline = createPipeline(renderer, scene, camera, q);
  const timer = new Timer();
  timer.connect(document);
  let simTime = 0;
  let introAngle = 0.6;
  const stats = { frames: 0, gpuReady: false };
  (window as unknown as Record<string, unknown>).__oceanHome = { stats, camera, player, renderer, doors, layout, avatars, U, heli, tender, furniture, sw, heliState: () => heliState };
  ui.showJoin();
  if (dbg.camera) ui.hideOverlay();

  renderer.setAnimationLoop(() => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    simTime += dt;
    U.time.value = simTime;

    const realNow = online ? net.serverNow() : Date.now();
    let gms = gameTime(clock, realNow);
    if (dbg.hour !== undefined) {
      const day = dbg.date ?? Math.floor(gms / 86400000) * 86400000;
      gms = day + ((dbg.hour - WORLD.longitude / 15 + 24) % 24) * 3600000 + simTime * 1000 * dbg.timeScale;
    }
    const base = serverWeather ?? localWeather.sample(gms);
    const weather: WeatherState = dbg.weather ? { ...base, ...dbg.weather } : base;
    const celestial = celestialAt(gms);

    if (dbg.camera) {
      camera.position.set(dbg.camera.position[0], dbg.camera.position[1], dbg.camera.position[2]);
      camera.lookAt(dbg.camera.target[0], dbg.camera.target[1], dbg.camera.target[2]);
    } else if (!joined) {
      introAngle += dt * 0.03;
      camera.position.set(6 + Math.cos(introAngle) * 105, 34, Math.sin(introAngle) * 105);
      camera.lookAt(6, 14, 0);
    } else {
      player.update(dt);
      if (respawnTimer > 0) {
        respawnTimer -= dt;
        if (respawnTimer <= 0) {
          player.teleport(layout.respawn.position, layout.respawn.yaw);
          if (online) net.send({ type: 'respawn' });
          player.frozen = false;
          ui.setFade(false);
        }
      }
      const door = player.focusDoor;
      ui.setPrompt(door ? `E · ${doors.isOpen(door) ? 'Close' : 'Open'} ${layout.doors.find((d) => d.id === door)?.name.toLowerCase()}` : null);
      if (online && realNow - lastPose >= net.poseIntervalMs) {
        lastPose = realNow;
        const s = player.motor.state;
        net.send({
          type: 'pose',
          seq: poseSeq++,
          p: [...s.position],
          v: [...s.velocity],
          yaw: controls.yaw,
          pitch: controls.pitch,
          grounded: s.grounded,
        });
      }
    }

    // Helicopter: pose from the shared schedule, solid on the pad for local prediction too.
    if (!online && !dbg.heli) {
      localHeli.update(realNow);
      setHeli(localHeli.state, joined);
    }
    const hp = heliPose(heliState, dbg.heli ? heliState.t0 + (dbg.heliT ?? 0) * 1000 + simTime * 1000 : realNow);
    const parked = heliState.phase === 'landed' ? heliState.padYaw : null;
    if (parked !== parkedYaw) {
      parkedYaw = parked;
      sw.setHelicopter(parked);
    }
    heli.update(hp, dt);
    sound.helicopter(hp);
    camera.getWorldDirection(listenerFwd);
    listenerUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    sound.setListener(camera.position, listenerFwd, listenerUp);

    atmosphere.update(dt, camera.position, celestial, weather);
    interior.update(sunDir.set(...celestial.sunDirection), weather.cloudCover);
    ocean.update(simTime, dt, camera.position, weather.windSpeed, weather.windDirection);
    tender.update(dt);
    furniture.update(simTime);
    props.update(dt);
    lights.update(simTime);
    doors.update(dt);
    rain.update();
    avatars.update(online ? net.serverNow() : Date.now(), dt);
    sound.update(dt, {
      heightAboveSea: camera.position.y - PLAYER.eyeHeight,
      windSpeed: weather.windSpeed,
      waveHeight: weather.waveHeight,
      rain: weather.rain,
      indoors: joined && player.indoors,
    });
    ui.setClock(celestial.localHour);
    ui.setWeather(weather);

    pipeline.render();
    labels.render(scene, camera);
    stats.frames++;
  });
}

boot().catch((err) => {
  console.error(err);
  const app = document.getElementById('app');
  if (app) app.innerHTML = `<div class="fatal">Failed to start: ${String(err?.message ?? err)}</div>`;
});
