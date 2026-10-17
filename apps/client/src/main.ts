import RAPIER from '@dimforge/rapier3d-compat';
import { NeutralToneMapping, PerspectiveCamera, type PointLight, Scene, Timer, Vector3, WebGPURenderer } from 'three/webgpu';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { SunLightNode } from 'three/addons/lights/SunLightNode.js';
import { StableClusteredLighting } from './render/stableClusteredLighting.ts';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import {
  type ClockConfig,
  DEFAULT_EPOCH,
  DIMS,
  type AutopilotStage,
  DroneAutopilot,
  DroneCrew,
  DroneFlight,
  type DronePose,
  DroneScheduler,
  type DroneState,
  ElevatorController,
  type ElevatorState,
  PLAYER,
  type Vec3,
  WORLD,
  WeatherControl,
  type WeatherMode,
  WeatherModel,
  type WeatherState,
  adjustClock,
  buildStaticWorld,
  carPanel,
  celestialAt,
  droneClearPath,
  dronePose,
  elevatorPanels,
  elevatorPose,
  gameTime,
  gateOpen,
  getLayout,
  inCar,
  inDoorway,
  makeClock,
  padOccupied,
  seatPosition,
} from '@ocean-home/shared';
import { Atmosphere } from './env/atmosphere.ts';
import { SoundEngine } from './env/audio.ts';
import { Ocean } from './env/ocean/ocean.ts';
import { createPoolWater, createRain } from './env/rain.ts';
import { Avatars } from './net/avatars.ts';
import { NetClient, probeServer } from './net/client.ts';
import { DronePoses } from './net/dronePoses.ts';
import { Controls } from './player/controls.ts';
import { type Interactable, Player } from './player/player.ts';
import { createPipeline } from './render/pipeline.ts';
import { QUALITY, loadQualityName, saveQualityName } from './render/quality.ts';
import { U } from './state.ts';
import { UI, loadSettings } from './ui/ui.ts';
import { Doors } from './world/doors.ts';
import { Drone } from './world/drone.ts';
import { ElevatorView } from './world/elevator.ts';
import { buildFurniture } from './world/furniture.ts';
import { Tender } from './world/tender.ts';
import { InteriorLight } from './world/interiorLight.ts';
import { buildLights } from './world/lights.ts';
import { createMaterials } from './world/materials/index.ts';
import { buildProps } from './world/props.ts';
import { buildStructure } from './world/structure.ts';
import { debugParams } from './debug.ts';
import { hideLoading, setLoading } from './loading.ts';
import { Profiler, gpuTimingWanted, setGpuTimingWanted } from './perf.ts';
import { DynamicResolution } from './render/dynamicResolution.ts';
import { lampLightAt } from './render/localLight.ts';
import { saveScreenshot } from './screenshot.ts';

const DEFAULT_SEED = 1337;
const LOCAL_ID = 'local';
const PILOT_DT = 1 / 120;
const AUTOPILOT_STAGE: Partial<Record<AutopilotStage, string>> = {
  climb: 'Climbing clear',
  cruise: 'Flying home',
  hold: 'Holding: helipad occupied',
  descend: 'Landing on the helipad',
};
const SEAT_NAMES = ['pilot', 'front passenger', 'rear left', 'rear right'];
/** Sample offsets (m) around a point, for lamplight estimates. */
const RING: Array<[number, number]> = [
  [2.5, 0],
  [-2.5, 0],
  [0, 2.5],
  [0, -2.5],
];

async function boot() {
  const app = document.getElementById('app')!;
  if (!('gpu' in navigator)) {
    hideLoading();
    app.innerHTML = `<div class="fatal">Ocean Home needs WebGPU.<br/>Use a current Chrome or Edge, or Safari 26+.</div>`;
    return;
  }
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
    return;
  }
  renderer.library.addLight(SunLightNode, SunLight);
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
  let renderedScale = dynRes.scale;

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
  const sunDir = new Vector3();
  const listenerFwd = new Vector3();
  const listenerUp = new Vector3();
  const sound = new SoundEngine();
  sound.setVolume(settings.volume);
  atmosphere.onLightning = (d) => sound.thunder(d);
  doors.onMove = (def) => sound.playAt('door-slide.mp3', def.center, 0.7, 3);

  // Player.
  const controls = new Controls(renderer.domElement);
  controls.settings.sensitivity = settings.sensitivity;
  controls.settings.invertY = settings.invertY;

  // ---------- shared world state (server-driven when online) ----------
  let clock: ClockConfig = makeClock({ realTime: false, dayLengthMinutes: 120 });
  const localWeather = new WeatherControl(new WeatherModel(DEFAULT_SEED, DEFAULT_EPOCH));
  let weatherMode: WeatherMode = 'auto';
  let envBy: string | undefined;
  let serverWeather: WeatherState | null = null;
  let shownWeather: WeatherState | null = null;
  let online = false;
  let joined = false;
  let selfId = LOCAL_ID;
  let lastPose = 0;
  let poseSeq = 0;
  let respawnTimer = 0;
  const playerList = new Map<string, { id: string; name: string; color: string; kind?: 'human' | 'agent' }>();
  const nameOf = (id: string | null) => (id === null ? null : id === selfId ? 'you' : (playerList.get(id)?.name ?? 'someone'));

  // The drone: the server's schedule and crew when online, local ones offline (or a fixed
  // phase from the URL for captures).
  const localCrew = new DroneCrew();
  const ground = (p: Vec3, max = 200): number | null => {
    const ray = new sw.R.Ray({ x: p[0], y: p[1] + 0.3, z: p[2] }, { x: 0, y: -1, z: 0 });
    const hit = sw.world.castRay(ray, max, true, undefined, undefined, undefined, undefined, (c) => {
      const i = sw.info.get(c.handle);
      return !!i && i.kind !== 'drone';
    });
    return hit ? p[1] + 0.3 - hit.timeOfImpact : null;
  };
  let player: Player;
  const localDrone = new DroneScheduler({ intervalMs: 3 * 60_000, stayMs: 10 * 60_000, firstArrivalMs: 20_000, seed: 3, startLanded: true }, Date.now(), {
    padOccupied: () => !player.seated && padOccupied([player.position]),
    aboard: () => localCrew.count > 0,
    clearPath: (a, b) => droneClearPath(sw, a, b),
  });
  let droneState: DroneState = dbg.drone ? dbg.drone(Date.now()) : localDrone.state;
  let crew: Array<string | null> = [...localCrew.seats];
  const dronePoses = new DronePoses();
  let flight: DroneFlight | null = null;
  /** Flying home on its own, with the pilot looking around freely (relative to the drone). */
  let autopilot: DroneAutopilot | null = null;
  let pilotAcc = 0;
  let mySeat: number | null = null;
  let parkedKey = '';
  const droneNews: Partial<Record<DroneState['phase'], string>> = {
    approach: 'The drone is on its way back.',
    hold: 'The drone is holding off: please clear the helipad.',
    depart: 'The drone is lifting off.',
    return: 'The drone is flying itself back to the helipad.',
  };
  const setDrone = (next: DroneState, nextCrew: Array<string | null>, announce: boolean) => {
    if (announce && next.phase !== droneState.phase) {
      if (next.phase === 'landed' && droneState.phase === 'descend') ui.addChat({ system: 'The drone has landed on the helipad.' });
      else if (next.phase === 'piloted') ui.addChat({ system: `${nameOf(nextCrew[0]) === 'you' ? 'You are' : `${nameOf(nextCrew[0])} is`} flying the drone.` });
      else if (droneNews[next.phase]) ui.addChat({ system: droneNews[next.phase]! });
    }
    if (next.phase !== 'piloted') dronePoses.clear();
    droneState = next;
    crew = nextCrew;
    syncSeat();
  };

  // The elevator.
  const localLift = new ElevatorController(Date.now(), { doorwayOccupied: (stop) => inDoorway(stop, player.position) });
  let liftState: ElevatorState = localLift.state;
  let carY = elevatorPose(liftState, Date.now()).y;
  let liftPhase = elevatorPose(liftState, Date.now()).phase;
  let calling: { stop: number; until: number } | null = null;

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
      onExploreOffline() {
        sound.start();
        net.disconnect();
        enterWorld();
        ui.addChat({ system: 'The server is offline: you are exploring on your own.' });
      },
      onResume() {
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
        dynRes.setEnabled(s.autoResolution && !fixedRes);
        if (qualityChanged) {
          saveQualityName(s.quality);
          location.reload();
        }
      },
      onEnv(change) {
        // A time set by hand replaces a time fixed in the URL.
        if (change.hour !== undefined || change.rate !== undefined) dbg.hour = undefined;
        if (online) {
          net.send({ type: 'setenv', ...change });
          return;
        }
        const now = Date.now();
        if (change.hour !== undefined || change.rate !== undefined) clock = adjustClock(clock, now, change);
        if (change.weather) {
          localWeather.set(change.weather, gameTime(clock, now), now);
          weatherMode = change.weather;
        }
      },
      onGpuTiming(on) {
        setGpuTimingWanted(on);
        location.reload();
      },
      onLogout() {
        logout();
      },
      sunElevationAt(hour) {
        const g = gameTime(clock, online ? net.serverNow() : Date.now());
        const day = Math.floor(g / 86_400_000) * 86_400_000;
        return celestialAt(day + ((hour - WORLD.longitude / 15 + 24) % 24) * 3_600_000).sunElevation;
      },
    },
    settings,
    dbg.name,
  );

  player = new Player(sw, layout, camera, controls, {
    onFootstep: (surface, run) => sound.footstep(surface, run),
    onLand: (surface, speed) => sound.footstep(surface, true, Math.min(2, speed / 4)),
    onInteract: (id) => interact(id),
    onFellInSea: () => {
      ui.setFade(true);
      player.frozen = true;
      respawnTimer = 0.8;
    },
  });

  // ---------- the drone: boarding, flying, climbing out ----------

  /** The drone as this browser should show it right now. */
  function currentDrone(now: number, renderT: number): DronePose & { grounded: boolean } {
    if (flight) return { ...flight.pose, grounded: flight.grounded };
    if (droneState.phase === 'piloted') {
      const live = dronePoses.sample(renderT);
      if (live) return live;
    }
    const t = dbg.drone ? droneState.t0 + (dbg.droneT ?? 0) * 1000 + simTime * 1000 : now;
    return { ...dronePose(droneState, t), grounded: droneState.phase === 'landed' || droneState.phase === 'piloted' };
  }

  function syncSeat() {
    const seat = crew.indexOf(selfId);
    const next = seat < 0 ? null : seat;
    if (next === mySeat) return;
    const pose = lastDrone;
    if (next !== null) {
      // Sit down: the pilot looks where the drone points; passengers look relative to it.
      player.seated = true;
      sound.setSeated(true);
      if (next === 0) {
        flight = new DroneFlight(sw, droneState.from, droneState.padYaw);
        pilotAcc = 0;
        controls.yaw = droneState.padYaw;
      } else {
        controls.yaw = 0;
      }
      controls.pitch = -0.08;
      ui.addChat({ system: next === 0 ? 'You take the pilot’s seat. Space to lift off.' : `You take the ${SEAT_NAMES[next]} seat.` });
    } else {
      // Stood up (climbed out, or the server let us go): look the way we were looking.
      if (mySeat !== null && (mySeat > 0 || autopilot) && pose) controls.yaw += pose.yaw;
      autopilot = null;
      player.seated = false;
      sound.setSeated(false);
      flight?.dispose();
      flight = null;
    }
    mySeat = next;
  }

  function board() {
    if (online) {
      net.send({ type: 'board' });
      return;
    }
    const seat = localCrew.board(LOCAL_ID);
    if (seat === 0) localDrone.takeControl(Date.now());
    setDrone(localDrone.state, [...localCrew.seats], false);
  }

  /** A free spot beside the drone with a floor under it, for climbing out. */
  function exitSpot(pose: DronePose): Vec3 | null {
    const seat = DIMS.DRONE.seats[mySeat ?? 0];
    const side = seat[0] < 0 ? -1 : 1;
    const cands: Array<[number, number]> = [
      [side * 1.9, seat[2]],
      [-side * 1.9, seat[2]],
      [0, 3.0],
      [0, -3.1],
      [side * 1.9, 1.6],
      [-side * 1.9, -1.6],
    ];
    const c = Math.cos(pose.yaw);
    const s = Math.sin(pose.yaw);
    const capsule = new sw.R.Capsule((PLAYER.height - 2 * PLAYER.radius) / 2, PLAYER.radius);
    for (const [x, z] of cands) {
      const wx = pose.position[0] + x * c + z * s;
      const wz = pose.position[2] - x * s + z * c;
      const g = ground([wx, pose.position[1] + 1.6, wz], 3.5);
      if (g === null || Math.abs(g - pose.position[1]) > 1.5) continue;
      const center = { x: wx, y: g + PLAYER.height / 2 + 0.06, z: wz };
      const blocked = sw.world.intersectionWithShape(center, { x: 0, y: 0, z: 0, w: 1 }, capsule, undefined, undefined, undefined, undefined, (col) => {
        const i = sw.info.get(col.handle);
        return !!i && i.kind !== 'drone';
      });
      if (!blocked) return [wx, g, wz];
    }
    return null;
  }

  function climbOut(pose: DronePose & { grounded: boolean }) {
    if (!pose.grounded) return;
    const spot = exitSpot(pose);
    if (!spot) {
      ui.addChat({ system: 'No room to climb out here.' });
      return;
    }
    const wasPilot = mySeat === 0;
    const yawNow = viewYaw(pose);
    if (online) net.send({ type: 'unboard', p: spot });
    // Leave locally straight away; the server agrees or corrects.
    const seats = crew.map((id) => (id === selfId ? null : id));
    if (!online) {
      localCrew.leave(LOCAL_ID);
      if (wasPilot) localDrone.release(Date.now(), pose.position, pose.yaw, true);
    }
    const next = online ? { ...droneState, ...(wasPilot ? { phase: 'landed' as const, from: pose.position, padYaw: pose.yaw, fromYaw: pose.yaw } : {}) } : localDrone.state;
    setDrone(next, seats, false);
    controls.yaw = yawNow;
    player.teleport(spot);
  }

  /** Where the seated player looks: the pilot steers with the view, everyone else looks around the cabin. */
  function viewYaw(pose: DronePose) {
    return mySeat === 0 && !autopilot ? controls.yaw : pose.yaw + controls.yaw;
  }

  /** H in the pilot's seat: fly home and land on the helipad, or hand the controls back. */
  function toggleAutopilot() {
    if (!flight) return;
    if (autopilot) {
      stopAutopilot('Autopilot off: you have the controls.');
      return;
    }
    const p = flight.pose;
    if (flight.grounded && Math.hypot(p.position[0] - DIMS.DRONE.pad[0], p.position[2] - DIMS.DRONE.pad[2]) < 2.5) {
      ui.addChat({ system: 'You are already on the helipad.' });
      return;
    }
    autopilot = new DroneAutopilot(p.position, (a, b) => droneClearPath(sw, a, b));
    // The view stops steering: keep looking the same way, now relative to the drone.
    controls.yaw -= flight.yaw;
    ui.addChat({ system: 'Autopilot on: flying home to the helipad.' });
  }

  function stopAutopilot(message: string | null) {
    if (!autopilot || !flight) return;
    autopilot = null;
    controls.yaw += flight.yaw;
    if (message) ui.addChat({ system: message });
  }

  function interact(id: string) {
    if (id.startsWith('door-')) {
      const open = !doors.isOpen(id);
      if (online) net.send({ type: 'door', id, open });
      else doors.setOpen(id, open);
      return;
    }
    if (id === 'drone') {
      board();
      return;
    }
    if (id.startsWith('lift-')) {
      const p = elevatorPose(liftState, online ? net.serverNow() : Date.now());
      const stop = id === 'lift-car' ? (p.stop === 1 ? 0 : 1) : Number(id.slice('lift-call-'.length));
      if (id === 'lift-car' && p.stop === null) return;
      calling = { stop, until: performance.now() + 25_000 };
      if (online) net.send({ type: 'elevator', stop });
      else localLift.call(stop, Date.now());
    }
  }

  /** Keeps the sign-in card's server state current until we are aboard. */
  let checkingServer = false;
  function startServerCheck() {
    if (dbg.offline) {
      ui.setServer('local');
      return;
    }
    if (checkingServer) return;
    checkingServer = true;
    const check = async () => {
      if (joined) {
        checkingServer = false;
        return;
      }
      const h = await probeServer();
      if (!joined) ui.setServer(h);
      window.setTimeout(check, h.online ? 10_000 : 4000);
    };
    void check();
  }

  /** Leaves the world: fade out, drop the connection and its session, back to sign in. */
  function logout() {
    ui.setFade(true);
    window.setTimeout(() => {
      net.disconnect();
      net.endSession();
      // Out of the drone: offline we hand it back to the local schedule; online the server
      // frees the seat when the socket closes.
      if (!online && mySeat !== null) {
        localCrew.leave(LOCAL_ID);
        if (mySeat === 0 && lastDrone) localDrone.release(Date.now(), lastDrone.position, lastDrone.yaw, lastDrone.grounded);
      }
      online = false;
      joined = false;
      controls.enabled = false;
      controls.unlock();
      selfId = LOCAL_ID;
      avatars.selfId = LOCAL_ID;
      avatars.clear();
      playerList.clear();
      if (!dbg.drone) setDrone(localDrone.state, [...localCrew.seats], false);
      serverWeather = null;
      weatherMode = localWeather.mode;
      envBy = undefined;
      calling = null;
      if (respawnTimer > 0) {
        respawnTimer = 0;
        player.teleport(layout.respawn.position, layout.respawn.yaw);
        player.frozen = false;
      }
      ui.setPlayers([], false);
      ui.loggedOut();
      startServerCheck();
      window.setTimeout(() => ui.setFade(false), 150);
    }, 450);
  }

  function enterWorld() {
    joined = true;
    ui.joined = true;
    controls.enabled = true;
    ui.hideOverlay();
    controls.lock();
    // If the browser refuses the pointer lock, the cursor stays free: show the toolbar.
    setTimeout(() => ui.setCursorFree(!controls.locked && !ui.chatOpen), 400);
  }

  const net = new NetClient({
    onWelcome(w) {
      online = true;
      selfId = w.you.id;
      avatars.selfId = selfId;
      ui.setSelf(w.you);
      avatars.clear();
      clock = w.clock;
      serverWeather = w.weather as WeatherState;
      weatherMode = w.weatherMode as WeatherMode;
      playerList.clear();
      for (const p of w.players) {
        playerList.set(p.id, p);
        avatars.add(p);
      }
      for (const [id, open] of Object.entries(w.doors)) doors.setOpen(id, open);
      if (!dbg.drone) setDrone(w.drone as DroneState, w.crew, false);
      liftState = w.elevator;
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
          if (m.drone && mySeat !== 0) dronePoses.push(m.t, m.drone);
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
        case 'envctl': {
          const now = net.serverNow();
          const jumped = Math.abs(gameTime(m.clock, now) - gameTime(clock, now)) > 120_000;
          const rateChanged = Math.abs(m.clock.rate - clock.rate) > 1e-6;
          const who = m.by ?? 'Someone';
          if (m.weatherMode !== weatherMode) ui.addChat({ system: `${who} changed the weather: ${m.weatherMode === 'auto' ? 'back to the forecast' : m.weatherMode}.` });
          if (jumped) ui.addChat({ system: `${who} set the time to ${hhmm(celestialAt(gameTime(m.clock, now)).localHour)}.` });
          if (rateChanged) ui.addChat({ system: `${who} changed the speed of the day.` });
          clock = m.clock;
          weatherMode = m.weatherMode as WeatherMode;
          envBy = m.by;
          break;
        }
        case 'chat':
          ui.addChat(m.entry);
          if (m.entry.from !== selfId) avatars.say(m.entry.from, m.entry.text);
          break;
        case 'door':
          doors.setOpen(m.id, m.open);
          break;
        case 'drone':
          if (!dbg.drone) setDrone(m.state as DroneState, m.crew, true);
          break;
        case 'elevator':
          liftState = m.state;
          break;
        case 'correct':
          player.teleport(m.p);
          break;
        case 'error':
          ui.addChat({ system: m.message });
          break;
        default:
          break;
      }
    },
    onClose(reason, _willRetry, unreachable) {
      online = false;
      ui.setPlayers([], false);
      if (!joined) {
        // Stop the background retries: the join card offers the next step instead.
        net.disconnect();
        ui.joinFailed(reason, unreachable);
      }
      else ui.addChat({ system: reason });
    },
  });

  /** P: save the next frame as a picture. */
  let shotWanted = false;

  // Esc frees the cursor without pausing anything: the toolbar and panels become usable.
  controls.onPointerLockChange = (locked) => ui.setCursorFree(!locked && joined && !ui.chatOpen);
  renderer.domElement.addEventListener('click', () => {
    if (joined && !ui.overlayVisible) controls.lock();
  });
  document.addEventListener('keydown', (e) => {
    if (!joined || ui.overlayVisible) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.code === 'KeyT' || e.code === 'Enter') {
      e.preventDefault();
      ui.openChat();
      ui.setCursorFree(false);
      controls.unlock();
    }
    if (e.code === 'Tab') {
      e.preventDefault();
      ui.togglePlayers(true);
    }
    if (e.code === 'KeyP' && !e.repeat) {
      e.preventDefault();
      shotWanted = true;
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
  await setLoading('Compiling shaders…', 0.65);
  await renderer.compileAsync(scene, camera);
  await setLoading('Warming up the ocean and lighting…', 0.9);
  const timer = new Timer();
  timer.connect(document);
  let simTime = 0;
  let introAngle = 0.6;
  let lastDrone: (DronePose & { grounded: boolean }) | null = null;
  let uiTick = 0;
  const stats = { frames: 0, gpuReady: false };
  const doorTargets: Interactable[] = layout.doors.map((d) => ({ id: d.id, point: d.center, reach: 3.2 }));
  const liftTargets: Interactable[] = elevatorPanels().map((p) => ({ id: `lift-call-${p.stop}`, point: p.position, reach: 2.6, facing: 0.6 }));
  (window as unknown as Record<string, unknown>).__oceanHome = {
    stats,
    perf: prof,
    camera,
    player,
    renderer,
    doors,
    layout,
    avatars,
    U,
    drone,
    tender,
    furniture,
    sw,
    lift,
    droneState: () => droneState,
    crew: () => crew,
    flight: () => flight,
    liftState: () => liftState,
    localLift,
    dbg,
    interact,
    clock: () => clock,
    controls,
    ui,
    weatherMode: () => (online ? weatherMode : localWeather.mode),
  };
  ui.showJoin();
  startServerCheck();
  if (dbg.camera) ui.hideOverlay();

  renderer.setAnimationLoop(() => {
    prof.beginFrame();
    timer.update();
    const rawDt = timer.getDelta();
    const dt = Math.min(rawDt, 0.1);
    simTime += dt;
    U.time.value = simTime;

    const realNow = online ? net.serverNow() : Date.now();
    const renderT = realNow - 110;
    let gms = gameTime(clock, realNow);
    if (dbg.hour !== undefined) {
      const day = dbg.date ?? Math.floor(gms / 86400000) * 86400000;
      gms = day + ((dbg.hour - WORLD.longitude / 15 + 24) % 24) * 3600000 + simTime * 1000 * dbg.timeScale;
    }
    // Weather: the server's (eased between its once-a-second updates) or the local one.
    const target = online && serverWeather ? serverWeather : localWeather.sample(gms, Date.now());
    if (!shownWeather) shownWeather = { ...target };
    else {
      const k = Math.min(1, dt * 1.5);
      const sw0 = shownWeather;
      for (const key of ['cloudCover', 'cloudDensity', 'rain', 'fog', 'windSpeed', 'waveHeight', 'storminess'] as const) sw0[key] += (target[key] - sw0[key]) * k;
      let dd = target.windDirection - sw0.windDirection;
      if (dd > 180) dd -= 360;
      if (dd < -180) dd += 360;
      sw0.windDirection = (sw0.windDirection + dd * k + 360) % 360;
      sw0.kind = target.kind;
    }
    const weather: WeatherState = dbg.weather ? { ...shownWeather, ...dbg.weather } : shownWeather;
    const celestial = celestialAt(gms);

    // Elevator: the car and the gates follow the shared timeline; riders move with the car.
    prof.begin('elevator');
    if (!online) {
      localLift.update(Date.now());
      liftState = localLift.state;
    }
    const liftNow = elevatorPose(liftState, realNow);
    sw.setElevator(liftNow.y, DIMS.ELEVATOR.stops.map((_, i) => gateOpen(liftNow, i)));
    if (joined) player.ride(carY, liftNow.y);
    if (liftNow.phase !== liftPhase) {
      const doorAt = (stop: number | null): Vec3 => [(DIMS.ELEVATOR.door.x0 + DIMS.ELEVATOR.door.x1) / 2, (stop === null ? liftNow.y : DIMS.ELEVATOR.stops[stop]) + 1.2, DIMS.ELEVATOR.z0];
      if (liftNow.phase === 'closing' || (liftNow.phase === 'opening' && liftPhase !== 'travel')) sound.playAt('elevator-doors.mp3', doorAt(liftNow.stop), 0.7, 3);
      if (liftNow.phase === 'opening' && liftPhase === 'travel') {
        sound.playAt('elevator-chime.mp3', doorAt(liftNow.stop), 0.8, 3);
        sound.playAt('elevator-doors.mp3', doorAt(liftNow.stop), 0.7, 3);
      }
      liftPhase = liftNow.phase;
    }
    carY = liftNow.y;
    if (calling && (performance.now() > calling.until || (liftNow.stop === calling.stop && liftNow.phase !== 'closing'))) calling = null;
    lift.update(liftNow, calling?.stop ?? null);
    sound.setElevator([(DIMS.ELEVATOR.x0 + DIMS.ELEVATOR.x1) / 2, liftNow.y + 1.2, (DIMS.ELEVATOR.z0 + DIMS.ELEVATOR.z1) / 2], liftNow.phase === 'travel');
    prof.end('elevator');

    // Drone schedule (offline) and pose.
    prof.begin('drone');
    if (!online && !dbg.drone) {
      localDrone.update(Date.now());
      if (localDrone.state !== droneState) setDrone(localDrone.state, [...localCrew.seats], joined);
    }
    const parked = droneState.phase === 'landed' ? `${droneState.from.join(',')},${droneState.padYaw}` : '';
    if (parked !== parkedKey) {
      parkedKey = parked;
      sw.setDrone(parked ? { position: droneState.from, yaw: droneState.padYaw } : null);
    }
    prof.end('drone');

    // The player: walking, or seated in the drone (and flying it from the pilot's seat).
    prof.begin('player');
    if (dbg.camera) {
      camera.position.set(dbg.camera.position[0], dbg.camera.position[1], dbg.camera.position[2]);
      camera.lookAt(dbg.camera.target[0], dbg.camera.target[1], dbg.camera.target[2]);
    } else if (!joined) {
      introAngle += dt * 0.03;
      camera.position.set(6 + Math.cos(introAngle) * 105, 34, Math.sin(introAngle) * 105);
      camera.lookAt(6, 14, 0);
    } else if (player.seated && mySeat !== null) {
      const input = controls.sampleFlight(dt);
      if (flight) {
        if (input.home) toggleAutopilot();
        else if (autopilot && Math.abs(input.forward) + Math.abs(input.right) + Math.abs(input.up) > 0.05) stopAutopilot('You have the controls.');
        // It waits above the pad while anyone (not aboard) stands on the landing circle.
        const padBusy = autopilot ? padOccupied(avatars.standing((id) => crew.includes(id))) : false;
        pilotAcc += dt;
        let steps = 0;
        while (pilotAcc >= PILOT_DT && steps < 12) {
          flight.step(autopilot ? autopilot.step(flight, PILOT_DT, padBusy) : input, PILOT_DT);
          pilotAcc -= PILOT_DT;
          steps++;
        }
        if (autopilot?.stage === 'landed') stopAutopilot('Landed on the helipad. E to climb out.');
        else if (autopilot?.stage === 'stuck') stopAutopilot('The autopilot cannot find a way home from here: you have the controls.');
        if (!online) localDrone.track(flight.pose.position, flight.yaw);
      }
      const pose = currentDrone(realNow, renderT);
      if (input.interact) climbOut(pose);
      if (player.seated && mySeat !== null) {
        const eye = seatPosition(pose, mySeat, true);
        camera.position.set(eye[0], eye[1], eye[2]);
        camera.rotation.set(controls.pitch, viewYaw(pose), 0, 'YXZ');
        player.motor.teleport([eye[0], eye[1] - DIMS.DRONE.seatedEye - 0.45, eye[2]]);
      }
      ui.setPrompt(null);
    } else {
      // What can be operated from here: doors, elevator buttons, the drone if it is landed.
      const targets = [...doorTargets, ...liftTargets];
      if (inCar(liftNow.y, player.position)) targets.push({ id: 'lift-car', point: carPanel(liftNow.y), reach: 2.4, facing: 0.35 });
      const dp = lastDrone;
      if (dp && dp.visible && dp.grounded && crew.some((c) => c === null)) targets.push({ id: 'drone', point: [dp.position[0], dp.position[1] + 1.3, dp.position[2]], reach: 6.5, facing: 0.45 });
      player.targets = targets;
      player.update(dt);
      doors.setFocus(player.focus?.startsWith('door-') ? player.focus : null);
      if (respawnTimer > 0) {
        respawnTimer -= dt;
        if (respawnTimer <= 0) {
          player.teleport(layout.respawn.position, layout.respawn.yaw);
          if (online) net.send({ type: 'respawn' });
          player.frozen = false;
          ui.setFade(false);
        }
      }
      ui.setPrompt(promptFor(player.focus, liftNow));
    }
    prof.end('player');

    // Drone: draw it, its sound, and its instruments for whoever sits in it.
    prof.begin('drone');
    const dpose = currentDrone(realNow, renderT);
    lastDrone = dpose;
    const under = dpose.visible ? ground(dpose.position) : null;
    if (dpose.visible) {
      // Out on the ring where the spray billows, beyond the landing light's spot under the drone.
      let e = 0;
      for (const [dx, dz] of RING) e += lampLightAt(lamps, lampProbe.set(dpose.position[0] + dx * 2, (under ?? 0) + 0.8, dpose.position[2] + dz * 2));
      drone.sprayLamplight = e / RING.length;
    }
    drone.update(dpose, dt, under, crew.some((c) => c !== null));
    sound.setDrone(dpose);
    ui.setFlight(
      player.seated && mySeat !== null
        ? {
            pilot: mySeat === 0,
            altitude: dpose.position[1],
            ground: under === null ? null : dpose.position[1] - under,
            speed: Math.hypot(dpose.velocity[0], dpose.velocity[2]),
            climb: dpose.velocity[1],
            heading: (-dpose.yaw * 180) / Math.PI,
            grounded: dpose.grounded,
            seats: `Pilot: ${nameOf(crew[0]) ?? 'nobody'} · ${crew.filter(Boolean).length} aboard`,
            autopilot: autopilot ? { stage: AUTOPILOT_STAGE[autopilot.stage] ?? 'Autopilot', distance: autopilot.distanceHome(dpose.position) } : null,
            atPad: dpose.grounded && Math.hypot(dpose.position[0] - DIMS.DRONE.pad[0], dpose.position[2] - DIMS.DRONE.pad[2]) < 2.5,
          }
        : null,
    );
    prof.end('drone');

    prof.begin('net');
    if (joined && online && realNow - lastPose >= net.poseIntervalMs) {
      lastPose = realNow;
      const s = player.motor.state;
      net.send({ type: 'pose', seq: poseSeq++, p: [...s.position], v: [...s.velocity], yaw: controls.yaw, pitch: controls.pitch, grounded: s.grounded });
      if (flight) {
        const fp = flight.pose;
        net.send({ type: 'drone', p: fp.position, v: fp.velocity, yaw: fp.yaw, pitch: fp.pitch, roll: fp.roll, rotor: fp.rotor, grounded: flight.grounded });
      }
    }
    prof.end('net');

    prof.begin('audio');
    camera.getWorldDirection(listenerFwd);
    listenerUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    sound.setListener(camera.position, listenerFwd, listenerUp);
    sound.update(dt, {
      heightAboveSea: camera.position.y - PLAYER.eyeHeight,
      windSpeed: weather.windSpeed,
      waveHeight: weather.waveHeight,
      rain: weather.rain,
      indoors: joined && (player.indoors || player.seated),
    });
    prof.end('audio');

    prof.time('atmosphere', () => atmosphere.update(dt, camera.position, celestial, weather, lampsAround(camera.position)));
    if (!off.has('probes')) {
      const baked = prof.time('interior', () => interior.update(sunDir.set(...celestial.sunDirection), weather.cloudCover));
      if (baked) prof.note(baked);
    }
    if (!off.has('ocean')) prof.time('ocean', () => ocean.update(simTime, dt, camera.position, weather.windSpeed, weather.windDirection));
    prof.time('tender', () => tender.update(dt));
    prof.begin('world');
    furniture.update(simTime);
    props.update(dt);
    lights.update(simTime);
    doors.update(dt);
    rain.update();
    prof.end('world');
    prof.time('avatars', () => {
      const seated = new Map<string, { position: Vec3; yaw: number }>();
      crew.forEach((id, i) => {
        if (id && id !== selfId) seated.set(id, { position: seatPosition(dpose, i), yaw: dpose.yaw });
      });
      avatars.update(online ? net.serverNow() : Date.now(), dt, seated);
    });
    prof.time('ui', () => {
      ui.setClock(celestial.localHour);
      ui.setWeather(weather);
      if (++uiTick % 15 === 0) {
        ui.setEnv({ hour: celestial.localHour, rate: clock.rate, weatherMode: online ? weatherMode : localWeather.mode, online, by: envBy });
        if (ui.perfOpen) ui.setPerf(prof.report(), prof.history());
      }
    });

    // A resolution change resizes every post-processing target in this render.
    if (dynRes.scale !== renderedScale) {
      prof.note(`resolution ${renderedScale}→${dynRes.scale}`);
      renderedScale = dynRes.scale;
    }
    prof.time('render', () => pipeline.render());
    if (shotWanted) {
      shotWanted = false;
      saveScreenshot(renderer.domElement).then(
        (name) => ui.screenshotTaken(name),
        (err: Error) => ui.addChat({ system: `Screenshot failed: ${err.message}` }),
      );
    }
    // Only the avatars carry CSS labels: traversing them alone is much cheaper than the scene.
    if (!off.has('labels')) prof.time('labels', () => labels.render(avatars.group as unknown as Scene, camera));
    stats.frames++;
    dynRes.update(rawDt * 1000, simTime);
    prof.resolutionScale = dynRes.scale;
    prof.endFrame();
    if (stats.frames === 3) hideLoading();
  });

  function promptFor(focus: string | null, liftNow: ReturnType<typeof elevatorPose>): string | null {
    if (!focus) return null;
    if (focus.startsWith('door-')) return `E · ${doors.isOpen(focus) ? 'Close' : 'Open'} ${layout.doors.find((d) => d.id === focus)?.name.toLowerCase()}`;
    if (focus === 'drone') return crew[0] === null ? 'E · Fly the drone' : 'E · Board the drone';
    if (focus === 'lift-car') return liftNow.stop === null ? null : `E · ${liftNow.stop === 1 ? 'Down to the boat landing' : 'Up to the main deck'}`;
    if (focus.startsWith('lift-call-')) {
      const stop = Number(focus.slice('lift-call-'.length));
      return liftNow.stop === stop && liftNow.phase !== 'closing' ? 'Elevator is here' : 'E · Call the elevator';
    }
    return null;
  }
}

function hhmm(hour: number) {
  const h = Math.floor(((hour % 24) + 24) % 24);
  const m = Math.floor((hour - Math.floor(hour)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

boot().catch((err) => {
  console.error(err);
  hideLoading();
  const app = document.getElementById('app');
  if (app) app.innerHTML = `<div class="fatal">Failed to start: ${String(err?.message ?? err)}</div>`;
});
