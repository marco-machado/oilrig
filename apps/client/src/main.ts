import { REVISION } from 'three/webgpu';
import { U } from './state.ts';
import { UI } from './ui/ui.ts';
import { Player } from './player/player.ts';
import { createPipeline } from './render/pipeline.ts';
import { hideLoading, setLoading } from './loading.ts';
import { DroneSeat } from './game/droneSeat.ts';
import { createFrame } from './game/frame.ts';
import { Game } from './game/game.ts';
import { interact } from './game/interact.ts';
import { createNet } from './game/messages.ts';
import { precompile } from './game/precompile.ts';
import { Session } from './game/session.ts';
import { buildStage } from './game/stage.ts';

/**
 * Starts the game: builds the stage, wires the parts of the game together (they find each other
 * through the Game), compiles the first frame's shaders and starts the frame loop.
 */
async function boot() {
  const app = document.getElementById('app')!;
  if (!('gpu' in navigator)) {
    hideLoading();
    app.innerHTML = `<div class="fatal">Ocean Home needs WebGPU.<br/>Use a current Chrome or Edge, or Safari 26+.</div>`;
    return;
  }
  const stage = await buildStage(app);
  if (!stage) return;
  const { avatars, camera, controls, dbg, doors, drone, furniture, labels, layout, lift, prof, renderer, scene, sound, sw, tender } = stage;

  const g = new Game(stage);
  g.seat = new DroneSeat(g);
  g.session = new Session(g);
  const ui = (g.ui = new UI(g.session.uiHandlers(), stage.settings, dbg.name));
  const player = (g.player = new Player(sw, layout, camera, controls, {
    onFootstep: (surface, run) => sound.footstep(surface, run),
    onLand: (surface, speed) => sound.footstep(surface, true, Math.min(2, speed / 4)),
    onInteract: (id) => interact(g, id),
    onFellInSea: () => {
      ui.setFade(true);
      player.frozen = true;
      g.respawnTimer = 0.8;
    },
  }));
  g.net = createNet(g);

  // Esc frees the cursor without pausing anything: the toolbar and panels become usable.
  controls.onPointerLockChange = (locked) => ui.setCursorFree(!locked && g.joined && !ui.chatOpen);
  renderer.domElement.addEventListener('click', () => {
    if (g.joined && !ui.overlayVisible) controls.lock();
  });
  document.addEventListener('keydown', (e) => {
    if (!g.joined || ui.overlayVisible) return;
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
      g.shotWanted = true;
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

  const pipeline = createPipeline(renderer, scene, camera, stage.q);

  await setLoading('Compiling shaders…', 0.65);
  if (Number.parseInt(REVISION, 10) >= 187) await precompile(g, pipeline);
  else await renderer.compileAsync(scene, camera);
  await setLoading('Warming up the ocean and lighting…', 0.9);
  const { frame, stats } = createFrame(g, pipeline);
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
    droneState: () => g.droneState,
    crew: () => g.crew,
    flight: () => g.seat.flight,
    liftState: () => g.liftState,
    localLift: g.localLift,
    dbg,
    interact: (id: string) => interact(g, id),
    clock: () => g.clock,
    controls,
    ui,
    weatherMode: () => (g.online ? g.weatherMode : g.localWeather.mode),
  };
  ui.showJoin();
  g.session.startServerCheck();
  if (dbg.camera) ui.hideOverlay();

  renderer.setAnimationLoop(frame);
}

boot().catch((err) => {
  console.error(err);
  hideLoading();
  const app = document.getElementById('app');
  if (app) app.innerHTML = `<div class="fatal">Failed to start: ${String(err?.message ?? err)}</div>`;
});
