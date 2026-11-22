import { Euler, Quaternion, type Scene, Timer, Vector3 } from 'three/webgpu';
import { type AutopilotStage, DIMS, PLAYER, type Vec3, type WeatherState, carPanel, celestialAt, elevatorPanels, elevatorPose, gateOpen, inCar, seatPosition } from '@oilrig/shared';
import { hideLoading } from '../loading.ts';
import type { Interactable } from '../player/player.ts';
import { lampLightAt } from '../render/localLight.ts';
import type { createPipeline } from '../render/pipeline.ts';
import { saveScreenshot } from '../screenshot.ts';
import { U } from '../state.ts';
import { swayPose } from '../world/drone.ts';
import type { Game } from './game.ts';
import { promptFor } from './interact.ts';
import { RING } from './stage.ts';

const AUTOPILOT_STAGE: Partial<Record<AutopilotStage, string>> = {
  climb: 'Climbing clear',
  cruise: 'Flying home',
  hold: 'Holding: helipad occupied',
  descend: 'Landing on the helipad',
};

/** The frame loop: one call advances the shared simulations, the player and the scene, and renders. */
export function createFrame(g: Game, pipeline: ReturnType<typeof createPipeline>) {
  const { atmosphere, avatars, camera, controls, dbg, doors, drone, dynRes, furniture, interior, labels, lamps, lampsAround, layout, lift, lights, ocean, off, prof, props, rain, renderer, sound, sw, tender } =
    g.stage;
  const seat = g.seat;
  const timer = new Timer();
  timer.connect(document);
  let introAngle = 0.6;
  let parkedKey = '';
  let renderedScale = dynRes.scale;
  const lampProbe = new Vector3();
  const sunDir = new Vector3();
  const listenerFwd = new Vector3();
  const listenerUp = new Vector3();
  /** The seated view: the cabin's attitude, the look around it, and the rotor shake. */
  const bodyQ = new Quaternion();
  const viewQ = new Quaternion();
  const shakeQ = new Quaternion();
  const bodyE = new Euler();
  const viewE = new Euler();
  const shakeE = new Euler();
  let uiTick = 0;
  const stats = { frames: 0, gpuReady: false };
  const doorTargets: Interactable[] = layout.doors.map((d) => ({ id: d.id, point: d.center, reach: 3.2 }));
  const liftTargets: Interactable[] = elevatorPanels().map((p) => ({ id: `lift-call-${p.stop}`, point: p.position, reach: 2.6, facing: 0.6 }));

  const frame = () => {
    const { net, player, ui } = g;
    prof.beginFrame();
    timer.update();
    const rawDt = timer.getDelta();
    const dt = Math.min(rawDt, 0.1);
    g.simTime += dt;
    const simTime = g.simTime;
    U.time.value = simTime;

    const realNow = g.now();
    const renderT = realNow - 110;
    const gms = g.gameNow(realNow, simTime);
    // Weather: the server's (eased between its once-a-second updates) or the local one.
    const target = g.online && g.serverWeather ? g.serverWeather : g.localWeather.sample(gms, Date.now());
    if (!g.shownWeather) g.shownWeather = { ...target };
    else {
      const k = Math.min(1, dt * 1.5);
      const sw0 = g.shownWeather;
      for (const key of ['cloudCover', 'cloudDensity', 'rain', 'fog', 'windSpeed', 'waveHeight', 'storminess'] as const) sw0[key] += (target[key] - sw0[key]) * k;
      let dd = target.windDirection - sw0.windDirection;
      if (dd > 180) dd -= 360;
      if (dd < -180) dd += 360;
      sw0.windDirection = (sw0.windDirection + dd * k + 360) % 360;
      sw0.kind = target.kind;
    }
    const weather: WeatherState = dbg.weather ? { ...g.shownWeather, ...dbg.weather } : g.shownWeather;
    const celestial = celestialAt(gms);

    // Elevator: the car and the gates follow the shared timeline; riders move with the car.
    prof.begin('elevator');
    if (!g.online) {
      g.localLift.update(Date.now());
      g.liftState = g.localLift.state;
    }
    const liftNow = elevatorPose(g.liftState, realNow);
    sw.setElevator(liftNow.y, DIMS.ELEVATOR.stops.map((_, i) => gateOpen(liftNow, i)));
    if (g.joined) player.ride(g.carY, liftNow.y);
    if (liftNow.phase !== g.liftPhase) {
      const doorAt = (stop: number | null): Vec3 => [(DIMS.ELEVATOR.door.x0 + DIMS.ELEVATOR.door.x1) / 2, (stop === null ? liftNow.y : DIMS.ELEVATOR.stops[stop]) + 1.2, DIMS.ELEVATOR.z0];
      if (liftNow.phase === 'closing' || (liftNow.phase === 'opening' && g.liftPhase !== 'travel')) sound.playAt('elevator-doors.mp3', doorAt(liftNow.stop), 0.7, 3);
      if (liftNow.phase === 'opening' && g.liftPhase === 'travel') {
        sound.playAt('elevator-chime.mp3', doorAt(liftNow.stop), 0.8, 3);
        sound.playAt('elevator-doors.mp3', doorAt(liftNow.stop), 0.7, 3);
      }
      g.liftPhase = liftNow.phase;
    }
    g.carY = liftNow.y;
    if (g.calling && (performance.now() > g.calling.until || (liftNow.stop === g.calling.stop && liftNow.phase !== 'closing'))) g.calling = null;
    lift.update(liftNow, g.calling?.stop ?? null);
    sound.setElevator([(DIMS.ELEVATOR.x0 + DIMS.ELEVATOR.x1) / 2, liftNow.y + 1.2, (DIMS.ELEVATOR.z0 + DIMS.ELEVATOR.z1) / 2], liftNow.phase === 'travel');
    prof.end('elevator');

    // Drone schedule (offline) and pose.
    prof.begin('drone');
    if (!g.online && !dbg.drone) {
      g.localDrone.update(Date.now());
      if (g.localDrone.state !== g.droneState) seat.set(g.localDrone.state, [...g.localCrew.seats], g.joined);
    }
    const parked = g.droneState.phase === 'landed' ? `${g.droneState.from.join(',')},${g.droneState.padYaw}` : '';
    if (parked !== parkedKey) {
      parkedKey = parked;
      sw.setDrone(parked ? { position: g.droneState.from, yaw: g.droneState.padYaw } : null);
    }
    prof.end('drone');

    // The player: walking, or seated in the drone (and flying it from the pilot's seat).
    prof.begin('player');
    if (dbg.camera) {
      camera.position.set(dbg.camera.position[0], dbg.camera.position[1], dbg.camera.position[2]);
      camera.lookAt(dbg.camera.target[0], dbg.camera.target[1], dbg.camera.target[2]);
    } else if (!g.joined) {
      introAngle += dt * 0.03;
      camera.position.set(6 + Math.cos(introAngle) * 105, 34, Math.sin(introAngle) * 105);
      camera.lookAt(6, 14, 0);
    } else if (player.seated && seat.mine !== null) {
      const input = controls.sampleFlight(dt);
      seat.pilot(dt, input);
      const pose = seat.current(realNow, renderT);
      if (input.interact) seat.climbOut(pose);
      if (player.seated && seat.mine !== null) {
        // The seat follows the cabin's bank and pitch (and its hover sway), and so does the
        // view: strapped in, the pilot sees the horizon tilt. A fraction is left out so the
        // mouse still feels in charge of where the nose points.
        const shown = swayPose(pose, simTime);
        const eye = seatPosition(shown, seat.mine, DIMS.DRONE.seatedEye);
        camera.position.set(eye[0], eye[1], eye[2]);
        bodyQ.setFromEuler(bodyE.set(shown.pitch * 0.6, shown.yaw, shown.roll * 0.8, 'YXZ'));
        viewQ.setFromEuler(viewE.set(controls.pitch, seat.viewYaw(pose) - shown.yaw, 0, 'YXZ'));
        camera.quaternion.copy(bodyQ).multiply(viewQ);
        player.motor.teleport([eye[0], eye[1] - DIMS.DRONE.seatedEye - 0.45, eye[2]]);
        // A touch of rotor shake, and a wider view at speed.
        const speed = Math.hypot(shown.velocity[0], shown.velocity[2]);
        if (!shown.grounded) {
          const shake = 0.0012 * Math.min(1, shown.rotor) * (0.6 + 0.4 * Math.min(1, speed / 15));
          shakeE.set(Math.sin(simTime * 61) * shake, Math.sin(simTime * 47 + 1) * shake, Math.sin(simTime * 53 + 2) * shake);
          camera.quaternion.multiply(shakeQ.setFromEuler(shakeE));
        }
        g.fovKick += ((shown.grounded ? 0 : 7 * Math.min(1, speed / DIMS.DRONE.maxSpeed)) - g.fovKick) * Math.min(1, dt * 3);
      }
      ui.setPrompt(null);
    } else {
      g.fovKick += (0 - g.fovKick) * Math.min(1, dt * 3);
      // What can be operated from here: doors, elevator buttons, the drone if it is landed.
      const targets = [...doorTargets, ...liftTargets];
      if (inCar(liftNow.y, player.position)) targets.push({ id: 'lift-car', point: carPanel(liftNow.y), reach: 2.4, facing: 0.35 });
      const dp = seat.last;
      if (dp && dp.visible && dp.grounded && g.crew.some((c) => c === null)) targets.push({ id: 'drone', point: [dp.position[0], dp.position[1] + 1.6, dp.position[2]], reach: 8, facing: 0.45 });
      player.targets = targets;
      player.update(dt);
      doors.setFocus(player.focus?.startsWith('door-') ? player.focus : null);
      if (g.respawnTimer > 0) {
        g.respawnTimer -= dt;
        if (g.respawnTimer <= 0) {
          player.teleport(layout.respawn.position, layout.respawn.yaw);
          if (g.online) net.send({ type: 'respawn' });
          player.frozen = false;
          ui.setFade(false);
        }
      }
      ui.setPrompt(promptFor(g, player.focus, liftNow));
    }
    const fovNow = Math.round((g.baseFov + g.fovKick) * 10) / 10;
    if (fovNow !== camera.fov) {
      camera.fov = fovNow;
      camera.updateProjectionMatrix();
    }
    prof.end('player');

    // Drone: draw it, its sound, and its instruments for whoever sits in it.
    prof.begin('drone');
    const dpose = seat.current(realNow, renderT);
    seat.last = dpose;
    const shownPose = swayPose(dpose, simTime);
    const under = dpose.visible ? g.ground(dpose.position) : null;
    if (dpose.visible) {
      // Out on the ring where the spray billows, beyond the landing light's spot under the drone.
      let e = 0;
      for (const [dx, dz] of RING) e += lampLightAt(lamps, lampProbe.set(dpose.position[0] + dx * 2, (under ?? 0) + 0.8, dpose.position[2] + dz * 2));
      drone.sprayLamplight = e / RING.length;
    }
    drone.update(shownPose, dt, under, g.crew.some((c) => c !== null));
    sound.setDrone(dpose, player.seated ? Math.hypot(dpose.velocity[0], dpose.velocity[1], dpose.velocity[2]) : 0);
    ui.setFlight(
      player.seated && seat.mine !== null
        ? {
            pilot: seat.mine === 0,
            altitude: dpose.position[1],
            ground: under === null ? null : dpose.position[1] - under,
            speed: Math.hypot(dpose.velocity[0], dpose.velocity[2]),
            climb: dpose.velocity[1],
            heading: (-dpose.yaw * 180) / Math.PI,
            pitch: dpose.pitch,
            roll: dpose.roll,
            rotor: dpose.rotor,
            grounded: dpose.grounded,
            spooling: !!seat.flight?.spooling,
            seats: `Pilot: ${g.nameOf(g.crew[0]) ?? 'nobody'} · ${g.crew.filter(Boolean).length} aboard`,
            autopilot: seat.autopilot ? { stage: AUTOPILOT_STAGE[seat.autopilot.stage] ?? 'Autopilot', distance: seat.autopilot.distanceHome(dpose.position) } : null,
            atPad: dpose.grounded && Math.hypot(dpose.position[0] - DIMS.DRONE.pad[0], dpose.position[2] - DIMS.DRONE.pad[2]) < 2.5,
          }
        : null,
    );
    prof.end('drone');

    prof.begin('net');
    if (g.joined && g.online && realNow - g.lastPose >= net.poseIntervalMs) {
      g.lastPose = realNow;
      const s = player.motor.state;
      net.send({ type: 'pose', seq: g.poseSeq++, p: [...s.position], v: [...s.velocity], yaw: controls.yaw, pitch: controls.pitch, grounded: s.grounded });
      if (seat.flight) {
        const fp = seat.flight.pose;
        net.send({ type: 'drone', p: fp.position, v: fp.velocity, yaw: fp.yaw, pitch: fp.pitch, roll: fp.roll, rotor: fp.rotor, grounded: seat.flight.grounded });
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
      indoors: g.joined && (player.indoors || player.seated),
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
      const seated = new Map<string, { position: Vec3; yaw: number; pitch: number; roll: number }>();
      g.crew.forEach((id, i) => {
        if (id && id !== g.selfId) seated.set(id, { position: seatPosition(shownPose, i, -DIMS.DRONE.seatedHips), yaw: shownPose.yaw, pitch: shownPose.pitch, roll: shownPose.roll });
      });
      avatars.update(g.now(), dt, seated);
    });
    prof.time('ui', () => {
      ui.setClock(celestial.localHour);
      ui.setWeather(weather);
      if (++uiTick % 15 === 0) {
        ui.setEnv({ hour: celestial.localHour, rate: g.clock.rate, weatherMode: g.online ? g.weatherMode : g.localWeather.mode, online: g.online, by: g.envBy });
        if (ui.perfOpen) ui.setPerf(prof.report(), prof.history());
      }
    });

    // A resolution change resizes every post-processing target in this render.
    if (dynRes.scale !== renderedScale) {
      prof.note(`resolution ${renderedScale}→${dynRes.scale}`);
      renderedScale = dynRes.scale;
    }
    prof.time('render', () => pipeline.render());
    if (g.shotWanted) {
      g.shotWanted = false;
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
  };

  return { frame, stats };
}
