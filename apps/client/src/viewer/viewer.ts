import {
  Box3,
  CircleGeometry,
  Color,
  DirectionalLight,
  type InstancedMesh,
  Mesh,
  MeshStandardNodeMaterial,
  NeutralToneMapping,
  type Object3D,
  PMREMGenerator,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import { abs, color, float, fog, fract, fwidth, max, min, mix, positionWorld, rangeFogFactor, screenUV, smoothstep, uniform } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import '../ui/style.css';
import './viewer.css';
import { U } from '../state.ts';
import { createMaterials } from '../world/materials/index.ts';
import { type Built, CATALOG, CATEGORIES, type Control, type Entry } from './catalog.ts';

// Standalone object viewer: every object the game builds, one at a time on a studio floor
// with a 1 m grid. Open /viewer.html (deep links: /viewer.html#drone).

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Lighting in the game's units (sun irradiance ~100, exposure ~0.1), so emissive parts read as they do in the game. */
const LIGHTING = {
  day: { sun: 110, sunColor: 0xfff3e2, env: 9, exposure: 0.11, night: 0, top: 0x7d93a6, bottom: 0xc3ccd2 },
  night: { sun: 0.2, sunColor: 0x9fb8ff, env: 0.015, exposure: 4.5, night: 1, top: 0x020409, bottom: 0x0a121b },
} as const;
type LightingName = keyof typeof LIGHTING;
const SUN_DIR = new Vector3(0.55, 1, 0.4).normalize();

const $ = <T extends Element>(sel: string) => document.querySelector(sel) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...children);
  return e;
};

function groundMaterial() {
  const m = new MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  const p = positionWorld.xz;
  // Anti-aliased grid lines about a pixel wide, faded out where they would crowd closer than ~10 px.
  const line = (period: number) => {
    const q = p.div(period);
    const g: any = abs(fract(q.sub(0.5)).sub(0.5)).div(fwidth(q));
    return float(1).sub(min(min(g.x, g.y), float(1))).mul(smoothstep(period / 8, period / 20, fwidth(p.x)));
  };
  m.colorNode = mix(color(0x353a3f), color(0x5c646b), max(line(1).mul(0.8), line(0.1).mul(0.35)));
  return m;
}

/** Bounds, triangles and meshes of what is visible under a root. */
function measure(root: Object3D) {
  root.updateMatrixWorld(true);
  const box = new Box3();
  const tmp = new Box3();
  let triangles = 0;
  let meshes = 0;
  const visit = (o: Object3D) => {
    if (!o.visible) return;
    const mesh = o as Mesh;
    if (mesh.isMesh) {
      const g = mesh.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      box.union(tmp.copy(g.boundingBox!).applyMatrix4(mesh.matrixWorld));
      const count = (mesh as InstancedMesh).isInstancedMesh ? (mesh as InstancedMesh).count : 1;
      triangles += ((g.index ? g.index.count : g.getAttribute('position').count) / 3) * count;
      meshes++;
    }
    for (const c of o.children) visit(c);
  };
  visit(root);
  return { box, triangles: Math.round(triangles), meshes };
}

/** Name tags live in the DOM: take them out when their object leaves the scene. */
function detachLabels(root: Object3D) {
  root.traverse((o) => {
    if (o instanceof CSS2DObject) o.element.remove();
  });
}

async function boot() {
  const stage = $<HTMLElement>('.v-stage');
  const status = $<HTMLElement>('.v-status');
  const info = $<HTMLElement>('.v-info');
  const items = $<HTMLElement>('.v-items');
  if (!('gpu' in navigator)) {
    stage.append(el('div', { className: 'fatal' }, 'The viewer needs WebGPU. Use a current Chrome or Edge, or Safari 26+.'));
    return;
  }

  const renderer = new WebGPURenderer({ antialias: true });
  await renderer.init();
  renderer.toneMapping = NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  stage.prepend(renderer.domElement);
  const labels = new CSS2DRenderer();
  labels.domElement.className = 'v-labels';
  stage.append(labels.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.05, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotateSpeed = 1.2;

  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const bgTop = uniform(new Color()) as any;
  const bgBottom = uniform(new Color()) as any;
  scene.backgroundNode = mix(bgBottom, bgTop, smoothstep(0.25, 1, screenUV.y.oneMinus()));
  scene.fogNode = fog(bgBottom, rangeFogFactor(40, 140));

  const ground = new Mesh(new CircleGeometry(200, 128).rotateX(-Math.PI / 2), groundMaterial());
  ground.receiveShadow = true;
  scene.add(ground);
  const sun = new DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  let lighting: LightingName = 'day';
  const setLighting = (name: LightingName) => {
    lighting = name;
    const l = LIGHTING[name];
    U.nightLights.value = l.night;
    sun.intensity = l.sun;
    sun.color.set(l.sunColor);
    scene.environmentIntensity = l.env;
    renderer.toneMappingExposure = l.exposure;
    // The backdrop is tone mapped with everything else: undo the exposure so it keeps its colour.
    bgTop.value.set(l.top).multiplyScalar(1 / l.exposure);
    bgBottom.value.set(l.bottom).multiplyScalar(1 / l.exposure);
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-light]')) b.setAttribute('aria-pressed', String(b.dataset.light === name));
  };
  setLighting('day');

  const materials = createMaterials();
  const cache = new Map<string, Built>();
  let entry: Entry | null = null;
  let built: Built | null = null;
  let rendering = true;
  let time = 0;
  let token = 0;

  const resize = () => {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    renderer.setSize(w, h);
    labels.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(stage);
  resize();

  // ---------- framing

  const frame = (e: Entry, box: Box3) => {
    const sphere = box.isEmpty() ? new Sphere(new Vector3(), 0.5) : box.getBoundingSphere(new Sphere());
    const target = e.view?.target ? new Vector3(...e.view.target) : sphere.center;
    const r = Math.max(sphere.radius, e.view?.radius ?? 0.5);
    const vfov = (camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const dist = (r / Math.sin(Math.min(vfov, hfov) / 2)) * 1.05;
    const dir = new Vector3(...(e.view?.dir ?? [1, 0.6, 1.3])).normalize();
    camera.position.copy(target).addScaledVector(dir, dist);
    camera.near = Math.max(0.01, dist / 200);
    camera.far = dist * 50 + 500;
    camera.updateProjectionMatrix();
    controls.target.copy(target);
    controls.minDistance = r * 0.25;
    controls.maxDistance = dist * 5;
    controls.update();
    // Fit the shadow camera round the object.
    const s = sun.shadow.camera;
    sun.position.copy(sphere.center).addScaledVector(SUN_DIR, r * 4 + 5);
    sun.target.position.copy(sphere.center);
    s.left = s.bottom = -r * 1.6;
    s.right = s.top = r * 1.6;
    s.near = 0.1;
    s.far = r * 8 + 12;
    s.updateProjectionMatrix();
  };

  // ---------- info panel

  const fmt = (v: number) => (v < 1 ? `${Math.round(v * 100)} cm` : `${+v.toFixed(2)} m`);
  const renderInfo = (e: Entry, b: Built) => {
    const m = measure(b.root);
    const size = m.box.getSize(new Vector3());
    const where = Array.isArray(e.inWorld)
      ? el(
          'details',
          {},
          el('summary', {}, `${e.inWorld.length} in the layout`),
          el('p', { className: 'v-ids' }, ...e.inWorld.map((id) => el('code', {}, id))),
        )
      : e.inWorld;
    const facts: Array<[string, Node | string]> = [
      ['Size', `${fmt(size.x)} wide × ${fmt(size.z)} deep × ${fmt(size.y)} high`],
      ['Geometry', `${m.triangles.toLocaleString('en')} triangles in ${m.meshes} mesh${m.meshes === 1 ? '' : 'es'}`],
      ['In the game', where],
      // Let long paths wrap after a slash, not mid-name.
      ['Built by', el('code', {}, ...e.source.split('/').flatMap((part, i) => (i ? [el('wbr'), `/${part}`] : [part])))],
    ];
    info.replaceChildren(
      el('p', { className: 'v-cat' }, e.category),
      el('h2', {}, e.name),
      el('p', { className: 'v-about' }, e.about),
      el('dl', { className: 'v-facts' }, ...facts.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])),
      ...(b.controls.length ? [el('h3', {}, 'Try it'), el('div', { className: 'v-controls' }, ...b.controls.map((c) => controlRow(c)))] : []),
    );
    return m;
  };

  const changed = (r: void | 'reframe') => {
    if (r !== 'reframe' || !entry || !built) return;
    frame(entry, renderInfo(entry, built).box);
  };

  let uid = 0;
  const controlRow = (c: Control): HTMLElement => {
    const id = `v-c${uid++}`;
    const label = el('label', { htmlFor: id }, c.label);
    switch (c.type) {
      case 'range': {
        const out = el('output', {}, c.format?.(c.value) ?? String(c.value));
        out.setAttribute('for', id);
        const input = el('input', { id, type: 'range', min: String(c.min), max: String(c.max), step: String(c.step), value: String(c.value) });
        input.addEventListener('input', () => {
          const v = Number(input.value);
          c.value = v;
          out.textContent = c.format?.(v) ?? String(v);
          changed(c.set(v));
        });
        return el('div', { className: 'v-row v-range' }, el('div', { className: 'v-row-head' }, label, out), input);
      }
      case 'toggle': {
        const input = el('input', { id, type: 'checkbox', checked: c.value });
        input.addEventListener('change', () => {
          c.value = input.checked;
          changed(c.set(input.checked));
        });
        return el('div', { className: 'v-row v-toggle' }, input, label);
      }
      case 'select': {
        const input = el('select', { id }, ...c.options.map(([v, t]) => el('option', { value: v, selected: v === c.value }, t)));
        input.addEventListener('change', () => {
          c.value = input.value;
          changed(c.set(input.value));
        });
        return el('div', { className: 'v-row' }, label, input);
      }
      case 'color': {
        const input = el('input', { id, type: 'color', value: c.value });
        input.addEventListener('input', () => {
          c.value = input.value;
          changed(c.set(input.value));
        });
        return el('div', { className: 'v-row v-inline' }, label, input);
      }
      case 'text': {
        const input = el('input', { id, type: 'text', value: c.value, maxLength: 120 });
        const go = el('button', { type: 'button', className: 'v-btn' }, c.action);
        const submit = () => {
          c.value = input.value;
          changed(c.set(input.value));
        };
        go.addEventListener('click', submit);
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') submit();
        });
        return el('div', { className: 'v-row' }, label, el('div', { className: 'v-text' }, input, go));
      }
    }
  };

  // ---------- the list

  const buttons = new Map<string, HTMLButtonElement>();
  for (const cat of CATEGORIES) {
    const list = CATALOG.filter((e) => e.category === cat);
    if (!list.length) continue;
    const ul = el('ul');
    for (const e of list) {
      const count = Array.isArray(e.inWorld) ? e.inWorld.length : null;
      const b = el('button', { type: 'button' }, el('span', {}, e.name), ...(count !== null ? [el('span', { className: 'v-count', title: `${count} in the layout` }, String(count))] : []));
      b.addEventListener('click', () => void select(e));
      buttons.set(e.id, b);
      ul.append(el('li', {}, b));
    }
    items.append(el('section', {}, el('h2', {}, cat), ul));
  }

  const select = async (e: Entry) => {
    const my = ++token;
    for (const [id, b] of buttons) {
      if (id === e.id) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    }
    buttons.get(e.id)?.scrollIntoView({ block: 'nearest' });
    if (location.hash.slice(1) !== e.id) history.replaceState(null, '', `#${e.id}`);
    let next = cache.get(e.id);
    const fresh = !next;
    if (!next) {
      next = e.build(materials);
      next.update?.(0, time);
      cache.set(e.id, next);
    }
    if (built) {
      scene.remove(built.root);
      detachLabels(built.root);
    }
    entry = e;
    built = next;
    scene.add(next.root);
    frame(e, renderInfo(e, next).box);
    // Compile the new shaders while the last frame stays up, rather than freezing mid-frame.
    if (fresh) {
      rendering = false;
      status.textContent = 'Compiling shaders…';
      try {
        await renderer.compileAsync(scene, camera);
      } catch (err) {
        console.warn('viewer: compile failed', err);
      }
      if (my !== token) return;
      status.textContent = '';
      rendering = true;
    }
  };

  // ---------- toolbar and keys

  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-light]')) b.addEventListener('click', () => setLighting(b.dataset.light as LightingName));
  const spin = $<HTMLButtonElement>('[data-act="spin"]');
  spin.addEventListener('click', () => {
    controls.autoRotate = !controls.autoRotate;
    spin.setAttribute('aria-pressed', String(controls.autoRotate));
  });
  $<HTMLButtonElement>('[data-act="frame"]').addEventListener('click', () => entry && built && frame(entry, measure(built.root).box));
  window.addEventListener('keydown', (ev) => {
    if ((ev.target as HTMLElement).closest('input, select, textarea')) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const i = entry ? CATALOG.indexOf(entry) : -1;
      const next = CATALOG[(i + (ev.key === 'ArrowDown' ? 1 : -1) + CATALOG.length) % CATALOG.length];
      void select(next);
    } else if (ev.key === 'n') setLighting(lighting === 'day' ? 'night' : 'day');
  });
  window.addEventListener('hashchange', () => {
    const e = CATALOG.find((c) => c.id === location.hash.slice(1));
    if (e && e !== entry) void select(e);
  });

  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!rendering) return;
    time += dt;
    U.time.value = time;
    built?.update?.(dt, time);
    controls.update(dt);
    renderer.render(scene, camera);
    labels.render(scene, camera);
  });

  await select(CATALOG.find((c) => c.id === location.hash.slice(1)) ?? CATALOG[0]);
}

void boot();
