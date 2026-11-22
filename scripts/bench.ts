// Benchmarks built copies of the client in headless Chrome (WebGPU), for before/after comparisons.
// It serves each build directory itself and measures from outside the game: a script injected
// into the page wraps requestAnimationFrame (frame intervals, script time per frame) and, for the
// counting suites, the WebGPU API (draws, primitives, passes, pipelines, uploads). So the same
// harness measures a build that knows nothing about it. docs/performance.md has the method.
//
//   pnpm build && cp -R apps/client/dist/client bench-results/builds/new
//   pnpm bench timing --build old=bench-results/builds/old --build new=bench-results/builds/new --runs 5 [--uncapped]
//   pnpm bench report                      # the before/after tables from the results so far
//
// The first --build is the original, the second the one compared with it. Suites:
//   timing    frame pacing per scenario; builds alternate within each scenario
//   startup   time to a usable scene, warm and cold (every fragment shader new to the driver)
//   regen     time-of-day and weather jumps: how long regeneration takes, the frames meanwhile, memory
//   count     WebGPU calls per frame (draws, primitives, passes, uploads) and resource counts
//   reload    memory across reloads of the page
//   alloc     JavaScript allocated per frame (sampling heap profiler)
//   shots     repeatable screenshots (seeded random, a clock that steps with the frames);
//             `diff <dirA> <dirB>` compares two sets
//   report    Markdown tables from the newest result of each suite in --out
// For finding out where the time goes: attrib (frame time with each ?off= feature off), ablate
// (things switched off inside one running page), passes (one frame's passes and the textures
// alive), cpu (sampling CPU profile; build with `vite build --minify false` to read it), thread
// (a Chrome trace: wall and CPU time inside the animation callbacks, garbage collections).
// Options: --runs N, --uncapped (no 60 Hz cap), --only id,id, --out dir (default bench-results,
// not under test-results, which Playwright empties on every run), --seconds N, --settle N, --label x,
// --busy N (thread only: keep N other cores busy, so an idle CPU is not slowed down under the cap).
import { execFileSync, spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { type Browser, type Page, chromium } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------- scenarios

const VIEWPORT = { width: 2560, height: 1440 };
/** Fixed date (seeded weather, sun path), no automatic resolution. */
const BASE = 'offline&fixedres&date=2026-12-21';

interface Scenario {
  id: string;
  group: 'typical' | 'demanding' | 'path';
  query: string;
  seconds?: number;
  /** Fly the camera along PATH instead of holding the viewpoint. */
  path?: boolean;
}

const SCENARIOS: Scenario[] = [
  // The six viewpoints of tests/e2e/perf.spec.ts: High, 11:00, fair weather.
  ...['refn', 'deck', 'interior', 'aerial', 'swim', 'pad'].map((cam): Scenario => ({ id: `high-${cam}`, group: 'typical', query: `cam=${cam}&hour=11&weather=fair&q=high` })),
  { id: 'ultra-refn', group: 'demanding', query: 'cam=refn&hour=11&weather=fair&q=ultra' },
  { id: 'ultra-deck-storm', group: 'demanding', query: 'cam=deck&hour=14&weather=storm&q=ultra' },
  { id: 'high-lounge-night', group: 'demanding', query: 'cam=lounge&hour=22&weather=clear&q=high' },
  { id: 'high-interior-night', group: 'demanding', query: 'cam=interior&hour=21&weather=clear&q=high' },
  { id: 'high-pad-drone-rain', group: 'demanding', query: 'cam=pad&hour=16&weather=rain&q=high&drone=hold' },
  // Navigation with the clock running at the game's default rate (a day in two hours), so the
  // sky's environment map and the light probes regenerate as they do in play.
  { id: 'high-path', group: 'path', query: 'cam=aerial&hour=11&weather=fair&q=high&ts=12', path: true, seconds: 60 },
];

/** Camera keyframes (position, target), one leg every PATH_LEG seconds, eased, looping. */
const PATH: Array<[number[], number[]]> = [
  [[95, 70, 95], [5, 10, 0]],
  [[6, 9, -118], [6, 8, 0]],
  [[4, 21.7, 12], [4, 21, -5]],
  [[3, 21.8, -1], [-12, 21.2, -8]],
  [[-5.2, 21.55, -11.3], [-9.4, 20.5, -7.6]],
  [[27.5, 23.5, 17], [42, 21, 0]],
  [[-5, 2.85, 21.2], [-12, -6, 6]],
  [[12, 6, 66], [12, 9, 0]],
];
const PATH_LEG = 7.5;

const WEATHER: Record<string, Record<string, unknown>> = {
  clear: { kind: 'clear', cloudCover: 0.08, cloudDensity: 0.3, rain: 0, fog: 0, windSpeed: 5, storminess: 0 },
  fair: { kind: 'fair', cloudCover: 0.4, cloudDensity: 0.45, rain: 0, fog: 0.02, windSpeed: 7, storminess: 0 },
  overcast: { kind: 'overcast', cloudCover: 0.88, cloudDensity: 0.75, rain: 0, fog: 0.12, windSpeed: 9, storminess: 0 },
  rain: { kind: 'rain', cloudCover: 0.95, cloudDensity: 0.9, rain: 0.65, fog: 0.3, windSpeed: 11, storminess: 0.1 },
  storm: { kind: 'storm', cloudCover: 1, cloudDensity: 1, rain: 1, fog: 0.4, windSpeed: 17, storminess: 1 },
  fog: { kind: 'fog', cloudCover: 0.55, cloudDensity: 0.5, rain: 0, fog: 0.9, windSpeed: 2.5, storminess: 0 },
};

/** Screenshot views: [name, query, a camera to use instead of the query's (position, target)]. */
const SHOTS: Array<[string, string, [number[], number[]]?]> = [
  ['ref-morning', 'cam=ref&hour=8.4&weather=fair&q=high'],
  ['refn-noon', 'cam=refn&hour=12&weather=fair&q=high'],
  ['aerial-golden', 'cam=aerial&hour=18.3&weather=clear&q=high'],
  ['deck-night', 'cam=deck&hour=22&weather=clear&q=high'],
  ['refn-storm', 'cam=refn&hour=14&weather=storm&q=high'],
  ['aerial-fog', 'cam=aerial&hour=9&weather=fog&q=high'],
  ['interior', 'cam=interior&hour=10&weather=fair&q=high'],
  ['interior-night', 'cam=interior&hour=21&weather=clear&q=high'],
  ['helipad', 'cam=helipad&hour=16&weather=fair&q=high'],
  ['swim', 'cam=swim&hour=11&weather=clear&wind=5&q=high'],
  ['walkway', 'cam=walkway&hour=10&weather=fair&q=high'],
  ['living', 'cam=living&hour=10&weather=fair&q=high'],
  ['doors-dusk', 'cam=doors&hour=18.6&weather=clear&q=high'],
  ['lounge-dusk', 'cam=lounge&hour=19.4&weather=clear&q=high'],
  ['hammocks', 'cam=hammocks&hour=10&weather=fair&q=high'],
  ['tender', 'cam=tender&hour=10&weather=fair&q=high'],
  ['tender-windscreen', 'cam=tender&hour=10&weather=fair&q=high', [[-18.6, 4.6, 24.3], [-15.55, 1.5, 24.9]]],
  ['underwater', 'cam=tender&hour=10&weather=fair&q=high', [[-13.6, 2.1, 28.6], [-15.5, 1.3, 25]]],
  // Straight at the moon (its direction at 21:00 on the fixed date), with the stars around it.
  ['moon', 'cam=helipad&hour=21&weather=clear&q=high', [[40, 24, 0], [61.25, 87.2, -74.5]]],
  ['pool', 'cam=deck&hour=13&weather=clear&q=high', [[9, 22.2, 9.5], [14, 19.6, 4]]],
  ['lift', 'cam=lift&hour=15&weather=fair&q=high'],
  ['pad-drone-landing', 'cam=pad&hour=16&weather=fair&q=high&drone=descend&droneT=14'],
  ['drone-parked', 'cam=drone3q&hour=17.5&weather=fair&q=high&drone=landed&droneT=60'],
  ['deck-rain', 'cam=deck&hour=13&weather=rain&q=high'],
  ['refn-ultra', 'cam=refn&hour=11&weather=fair&q=ultra'],
  ['deck-ultra', 'cam=deck&hour=16&weather=fair&q=ultra'],
  ['aerial-medium', 'cam=aerial&hour=11&weather=fair&q=medium'],
  ['aerial-low', 'cam=aerial&hour=11&weather=fair&q=low'],
];
const SHOT_VIEWPORT = { width: 1536, height: 1024 };
/** Game frames rendered before a screenshot: the probes are baked and the exposure has settled. */
const SHOT_FRAMES = 420;

// ---------------------------------------------------------------- the page side

interface RecorderOptions {
  /** Wrap the WebGPU API and count per frame. */
  count?: boolean;
  /** Make every fragment shader new to the GPU's shader cache (a number unique to the run). */
  coldNonce?: number;
  /** Seeded Math.random and a clock that advances 1/60 s per frame, for repeatable pictures. */
  deterministic?: boolean;
  /** With `deterministic`: stop the frame loop after this many game frames. */
  freezeAt?: number;
  /** A camera (position, target) to put in place of the URL's as soon as the game is up. */
  camera?: [number[], number[]];
}

/** Runs in the page before any of its scripts. Plain JavaScript: Playwright sends its source. */
function recorder(opts: RecorderOptions) {
  const w = window as any;
  const perfNow = performance.now.bind(performance);
  const B: any = (w.__bench = {
    t: [], // requestAnimationFrame timestamp of each recorded frame (ms)
    cpu: [], // script time inside that frame's animation callbacks (ms)
    recording: false,
    steps: [], // loading-screen steps: [time, text]
    longTasks: [], // [start, duration]
    marks: {},
    frozen: false,
    bakes: [],
    gpu: null,
    perturbed: 0,
  });
  const raf: (cb: FrameRequestCallback) => number = w.requestAnimationFrame.bind(w);
  B.raf = raf;

  let virtual = 0;
  if (opts.deterministic) {
    let s = 0x2545f491;
    Math.random = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // The clock steps with the frames, and jumps to a fixed time when the game's loop starts, so
    // game frame N is at the same time in every run however long the boot took.
    const epoch = Date.UTC(2026, 10, 22, 12);
    performance.now = () => virtual;
    Date.now = () => epoch + virtual;
  }

  let curT = -1;
  let curCpu = 0;
  let gameStarted = false;
  const held: FrameRequestCallback[] = [];
  w.requestAnimationFrame = (cb: FrameRequestCallback) =>
    raf((t: number) => {
      if (B.frozen) {
        held.push(cb);
        return;
      }
      if (t !== curT) {
        if (curT >= 0) {
          if (B.recording) {
            B.t.push(curT);
            B.cpu.push(curCpu);
          }
          if (B.gpu) B.gpu.endFrame(B.recording);
        }
        curT = t;
        curCpu = 0;
        if (w.__oilrig && !gameStarted) {
          gameStarted = true;
          if (opts.deterministic) virtual = 3_600_000;
          if (opts.camera) w.__oilrig.dbg.camera = { position: opts.camera[0], target: opts.camera[1] };
          // Every light-probe bake from here on: [start, duration, first probe, probes].
          const grid = w.__oilrig.camera.parent.children.find((c: any) => c.isLightProbeGrid);
          if (grid) {
            const bake = grid.bake;
            grid.bake = function (this: any, ...args: any[]) {
              const t0 = perfNow();
              try {
                return bake.apply(this, args);
              } finally {
                B.bakes.push([t0, perfNow() - t0, args[2]?.start ?? 0, args[2]?.count ?? 0]);
              }
            };
          }
        }
        if (opts.deterministic) virtual += 1000 / 60;
      }
      const t0 = perfNow();
      try {
        cb(opts.deterministic ? virtual : t);
      } finally {
        curCpu += perfNow() - t0;
        const frames = w.__oilrig?.stats.frames ?? 0;
        if (frames >= 1 && !B.marks.firstFrame) B.marks.firstFrame = perfNow();
        if (frames >= 3 && !B.marks.frame3) B.marks.frame3 = perfNow();
        if (frames >= 120 && !B.marks.frame120) B.marks.frame120 = perfNow();
        if (opts.freezeAt && frames >= opts.freezeAt) B.frozen = true;
      }
    });
  B.start = () => {
    B.t.length = 0;
    B.cpu.length = 0;
    if (B.gpu) B.gpu.frames.length = 0;
    B.recording = true;
  };
  B.stop = () => {
    B.recording = false;
  };

  let lastStep = '';
  new MutationObserver(() => {
    const el = document.querySelector('#loader .step');
    const text = el ? el.textContent : null;
    if (text && text !== lastStep) {
      lastStep = text;
      B.steps.push([perfNow(), text]);
    }
    if (!B.marks.loaderDone && document.querySelector('#loader.done')) B.marks.loaderDone = perfNow();
  }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) B.longTasks.push([e.startTime, e.duration]);
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    // long tasks not observable
  }

  if (!opts.count && opts.coldNonce === undefined) return;
  const dev = w.GPUDevice?.prototype;
  if (!dev) return;
  const wrap = (proto: any, name: string, fn: (orig: (...a: any[]) => any, self: any, args: any[]) => any) => {
    const orig = proto?.[name];
    if (typeof orig !== 'function') return;
    proto[name] = function (...args: any[]) {
      return fn(orig, this, args);
    };
  };

  if (opts.coldNonce !== undefined) {
    // An unused variable would compile to the same machine code and hit the driver's cache. This
    // is live code on an interpolated input (never true), so each fragment shader is new.
    const sentinel = `-${(7.1 + opts.coldNonce * 1e-6).toFixed(9)}e30`;
    wrap(dev, 'createShaderModule', (orig, self, [desc]) => {
      const m = /@fragment\s+fn\s+\w+\s*\(([^{]*)\{/.exec(desc.code);
      const p = m && /(\w+)\s*:\s*(f32|vec[234]<f32>)/.exec(m[1]);
      if (!m || !p) return orig.call(self, desc);
      const at = m.index + m[0].length;
      const test = p[2] === 'f32' ? p[1] : `${p[1]}.x`;
      B.perturbed++;
      return orig.call(self, { ...desc, code: `${desc.code.slice(0, at)}\n\tif ( ${test} == ${sentinel} ) { discard; }\n${desc.code.slice(at)}` });
    });
  }
  if (!opts.count) return;

  const zero = () => ({ draws: 0, indirectDraws: 0, triangles: 0, lines: 0, points: 0, instances: 0, renderPasses: 0, computePasses: 0, dispatches: 0, submits: 0, setPipeline: 0, setBindGroup: 0, writeBufferCalls: 0, writeBufferBytes: 0, writeTextureCalls: 0, writeTextureBytes: 0, newBuffers: 0, newBufferBytes: 0, newTextures: 0, newTextureBytes: 0, newBindGroups: 0, newPipelines: 0, newShaderModules: 0 });
  const G: any = (B.gpu = {
    frame: zero(),
    frames: [],
    total: { renderPipelines: 0, computePipelines: 0, shaderModules: 0, shaderChars: 0, buffers: 0, liveBuffers: 0, liveBufferBytes: 0, peakBufferBytes: 0, mappedBuffers: 0, mappedBufferBytes: 0, textures: 0, liveTextures: 0, liveTextureBytes: 0, peakTextureBytes: 0, bindGroups: 0, samplers: 0 },
    endFrame(record: boolean) {
      if (record) G.frames.push(G.frame);
      G.frame = zero();
      if (G.capture === 'armed') G.capture = [];
      else if (Array.isArray(G.capture)) {
        G.captured = G.capture;
        G.capture = null;
      }
    },
  });
  const T = G.total;
  // One frame's passes in order, when asked for (`passes` suite): what each renders into and how much.
  G.capture = null;
  G.captured = null;
  G.liveTextures = new Map();
  const viewOf = new WeakMap<object, any>();
  const passRecord = new WeakMap<object, any>();
  const BPP: Record<string, number> = { r8unorm: 1, r8snorm: 1, r8uint: 1, r8sint: 1, stencil8: 1, r16float: 2, r16uint: 2, r16sint: 2, r16unorm: 2, rg8unorm: 2, rg8snorm: 2, depth16unorm: 2, rg32float: 8, rgba16float: 8, rgba16uint: 8, rgba16sint: 8, rgba16unorm: 8, 'depth32float-stencil8': 8, rgba32float: 16, rgba32uint: 16, rgba32sint: 16 };
  const textureBytes = (d: any) => {
    const s = d.size;
    const width = Array.isArray(s) ? s[0] : s.width;
    const height = Array.isArray(s) ? (s[1] ?? 1) : (s.height ?? 1);
    const layers = Array.isArray(s) ? (s[2] ?? 1) : (s.depthOrArrayLayers ?? 1);
    let px = 0;
    for (let m = 0, mw = width, mh = height, ml = layers; m < (d.mipLevelCount ?? 1); m++) {
      px += mw * mh * ml;
      mw = Math.max(1, mw >> 1);
      mh = Math.max(1, mh >> 1);
      if (d.dimension === '3d') ml = Math.max(1, ml >> 1);
    }
    return px * (BPP[d.format] ?? 4) * (d.sampleCount ?? 1);
  };
  const topology = new WeakMap<object, string>();
  const passTopology = new WeakMap<object, string>();
  const sizes = new WeakMap<object, number>();
  const pipeline = (kind: 'renderPipelines' | 'computePipelines') => (orig: any, self: any, [desc]: any[]) => {
    T[kind]++;
    G.frame.newPipelines++;
    const result = orig.call(self, desc);
    const note = (p: object) => topology.set(p, desc.primitive?.topology ?? 'triangle-list');
    if (kind === 'renderPipelines') {
      if (typeof result?.then === 'function') result.then(note, () => undefined);
      else note(result);
    }
    return result;
  };
  wrap(dev, 'createRenderPipeline', pipeline('renderPipelines'));
  wrap(dev, 'createRenderPipelineAsync', pipeline('renderPipelines'));
  wrap(dev, 'createComputePipeline', pipeline('computePipelines'));
  wrap(dev, 'createComputePipelineAsync', pipeline('computePipelines'));
  wrap(dev, 'createShaderModule', (orig, self, [desc]) => {
    T.shaderModules++;
    T.shaderChars += desc.code.length;
    G.frame.newShaderModules++;
    return orig.call(self, desc);
  });
  wrap(dev, 'createBuffer', (orig, self, [desc]) => {
    const b = orig.call(self, desc);
    sizes.set(b, desc.size);
    T.buffers++;
    T.liveBuffers++;
    T.liveBufferBytes += desc.size;
    T.peakBufferBytes = Math.max(T.peakBufferBytes, T.liveBufferBytes);
    if (desc.mappedAtCreation) {
      // Created mapped: its contents are uploaded through memory the browser shares with its GPU process.
      T.mappedBuffers++;
      T.mappedBufferBytes += desc.size;
    }
    G.frame.newBuffers++;
    G.frame.newBufferBytes += desc.size;
    return b;
  });
  wrap(w.GPUBuffer?.prototype, 'destroy', (orig, self) => {
    const size = sizes.get(self);
    if (size !== undefined) {
      sizes.delete(self);
      T.liveBuffers--;
      T.liveBufferBytes -= size;
    }
    return orig.call(self);
  });
  wrap(dev, 'createTexture', (orig, self, [desc]) => {
    const t = orig.call(self, desc);
    const bytes = textureBytes(desc);
    sizes.set(t, bytes);
    const sz = desc.size;
    G.liveTextures.set(t, { label: desc.label ?? '', format: desc.format, size: Array.isArray(sz) ? sz : [sz.width, sz.height ?? 1, sz.depthOrArrayLayers ?? 1], mips: desc.mipLevelCount ?? 1, samples: desc.sampleCount ?? 1, dimension: desc.dimension ?? '2d', usage: desc.usage, bytes });
    T.textures++;
    T.liveTextures++;
    T.liveTextureBytes += bytes;
    T.peakTextureBytes = Math.max(T.peakTextureBytes, T.liveTextureBytes);
    G.frame.newTextures++;
    G.frame.newTextureBytes += bytes;
    return t;
  });
  wrap(w.GPUTexture?.prototype, 'destroy', (orig, self) => {
    const size = sizes.get(self);
    if (size !== undefined) {
      sizes.delete(self);
      G.liveTextures.delete(self);
      T.liveTextures--;
      T.liveTextureBytes -= size;
    }
    return orig.call(self);
  });
  wrap(w.GPUTexture?.prototype, 'createView', (orig, self, args) => {
    const v = orig.apply(self, args);
    viewOf.set(v, { tex: G.liveTextures.get(self), mip: args[0]?.baseMipLevel ?? 0 });
    return v;
  });
  wrap(dev, 'createBindGroup', (orig, self, [desc]) => {
    T.bindGroups++;
    G.frame.newBindGroups++;
    return orig.call(self, desc);
  });
  wrap(dev, 'createSampler', (orig, self, [desc]) => {
    T.samplers++;
    return orig.call(self, desc);
  });
  const queue = w.GPUQueue?.prototype;
  wrap(queue, 'submit', (orig, self, args) => {
    G.frame.submits++;
    return orig.apply(self, args);
  });
  wrap(queue, 'writeBuffer', (orig, self, args) => {
    const [, , data, offset, size] = args;
    const unit = data.BYTES_PER_ELEMENT ?? 1;
    G.frame.writeBufferCalls++;
    G.frame.writeBufferBytes += size !== undefined ? size * unit : data.byteLength - (offset ?? 0) * unit;
    return orig.apply(self, args);
  });
  wrap(queue, 'writeTexture', (orig, self, args) => {
    G.frame.writeTextureCalls++;
    G.frame.writeTextureBytes += args[1]?.byteLength ?? 0;
    return orig.apply(self, args);
  });
  wrap(queue, 'copyExternalImageToTexture', (orig, self, args) => {
    G.frame.writeTextureCalls++;
    return orig.apply(self, args);
  });
  const encoder = w.GPUCommandEncoder?.prototype;
  const describe = (a: any) => {
    const v = a && viewOf.get(a.view);
    const t = v?.tex;
    return t ? `${t.label || '?'} ${t.format} ${Math.max(1, t.size[0] >> v.mip)}x${Math.max(1, t.size[1] >> v.mip)}${a.loadOp ? ` ${a.loadOp ?? a.depthLoadOp}` : a.depthLoadOp ? ` ${a.depthLoadOp}` : ''}` : a ? 'canvas/unknown' : '';
  };
  wrap(encoder, 'beginRenderPass', (orig, self, args) => {
    G.frame.renderPasses++;
    if (Array.isArray(G.capture)) {
      const d = args[0];
      const pass = { type: 'render', label: d.label ?? '', color: [...(d.colorAttachments ?? [])].map(describe), depth: describe(d.depthStencilAttachment), draws: 0, triangles: 0 };
      G.capture.push(pass);
      const encoder = orig.apply(self, args);
      passRecord.set(encoder, pass);
      return encoder;
    }
    return orig.apply(self, args);
  });
  wrap(encoder, 'beginComputePass', (orig, self, args) => {
    G.frame.computePasses++;
    if (Array.isArray(G.capture)) {
      const pass = { type: 'compute', label: args[0]?.label ?? '', dispatches: 0 };
      G.capture.push(pass);
      const encoder = orig.apply(self, args);
      passRecord.set(encoder, pass);
      return encoder;
    }
    return orig.apply(self, args);
  });
  // What a render bundle draws, noted while it is recorded and counted each time it is executed
  // (three replays bundles for its mip chains and for layered renders).
  const bundleWork = new WeakMap<object, { draws: number; triangles: number; lines: number; points: number; instances: number }>();
  const primitives = (pass: object, count: number, instances: number) => {
    const tp = passTopology.get(pass) ?? 'triangle-list';
    const triangles = tp === 'triangle-list' ? Math.floor(count / 3) * instances : tp === 'triangle-strip' ? Math.max(0, count - 2) * instances : 0;
    const lines = tp === 'line-list' ? Math.floor(count / 2) * instances : tp === 'line-strip' ? Math.max(0, count - 1) * instances : 0;
    const points = tp === 'point-list' ? count * instances : 0;
    if (w.GPURenderBundleEncoder && pass instanceof w.GPURenderBundleEncoder) {
      const b = bundleWork.get(pass) ?? { draws: 0, triangles: 0, lines: 0, points: 0, instances: 0 };
      b.draws++;
      b.triangles += triangles;
      b.lines += lines;
      b.points += points;
      b.instances += instances;
      bundleWork.set(pass, b);
      return;
    }
    const current = passRecord.get(pass);
    const f = G.frame;
    f.draws++;
    f.instances += instances;
    f.triangles += triangles;
    f.lines += lines;
    f.points += points;
    if (current) {
      current.draws++;
      current.triangles += triangles;
    }
  };
  wrap(w.GPURenderBundleEncoder?.prototype, 'finish', (orig, self, args) => {
    const bundle = orig.apply(self, args);
    const work = bundleWork.get(self);
    if (work) bundleWork.set(bundle, work);
    return bundle;
  });
  wrap(w.GPURenderPassEncoder?.prototype, 'executeBundles', (orig, self, args) => {
    const current = passRecord.get(self);
    for (const bundle of args[0]) {
      const work = bundleWork.get(bundle);
      if (!work) continue;
      const f = G.frame;
      f.draws += work.draws;
      f.instances += work.instances;
      f.triangles += work.triangles;
      f.lines += work.lines;
      f.points += work.points;
      if (current) {
        current.draws += work.draws;
        current.triangles += work.triangles;
      }
    }
    return orig.apply(self, args);
  });
  for (const pass of [w.GPURenderPassEncoder?.prototype, w.GPURenderBundleEncoder?.prototype]) {
    wrap(pass, 'setPipeline', (orig, self, args) => {
      G.frame.setPipeline++;
      passTopology.set(self, topology.get(args[0]) ?? 'triangle-list');
      return orig.apply(self, args);
    });
    wrap(pass, 'setBindGroup', (orig, self, args) => {
      G.frame.setBindGroup++;
      return orig.apply(self, args);
    });
    wrap(pass, 'draw', (orig, self, args) => {
      primitives(self, args[0], args[1] ?? 1);
      return orig.apply(self, args);
    });
    wrap(pass, 'drawIndexed', (orig, self, args) => {
      primitives(self, args[0], args[1] ?? 1);
      return orig.apply(self, args);
    });
    for (const name of ['drawIndirect', 'drawIndexedIndirect'])
      wrap(pass, name, (orig, self, args) => {
        G.frame.draws++;
        G.frame.indirectDraws++;
        return orig.apply(self, args);
      });
  }
  const compute = w.GPUComputePassEncoder?.prototype;
  wrap(compute, 'dispatchWorkgroups', (orig, self, args) => {
    G.frame.dispatches++;
    const cur = passRecord.get(self);
    if (cur) cur.dispatches++;
    return orig.apply(self, args);
  });
  wrap(compute, 'dispatchWorkgroupsIndirect', (orig, self, args) => {
    G.frame.dispatches++;
    return orig.apply(self, args);
  });
}

/** Flies the fixed camera along the keyframes; time-based, so slow frames do not shorten the flight. */
function flyPath(arg: { path: Array<[number[], number[]]>; leg: number }) {
  const w = window as any;
  const cam = w.__oilrig.dbg.camera;
  const t0 = performance.now();
  const step = () => {
    const s = (performance.now() - t0) / 1000 / arg.leg;
    const i = Math.floor(s) % arg.path.length;
    const j = (i + 1) % arg.path.length;
    const u = s - Math.floor(s);
    const e = u * u * (3 - 2 * u);
    for (let k = 0; k < 3; k++) {
      cam.position[k] = arg.path[i][0][k] + (arg.path[j][0][k] - arg.path[i][0][k]) * e;
      cam.target[k] = arg.path[i][1][k] + (arg.path[j][1][k] - arg.path[i][1][k]) * e;
    }
    w.__bench.raf(step);
  };
  // Own copies: the game's camera presets are shared objects.
  w.__oilrig.dbg.camera = { position: [...cam.position], target: [...cam.target] };
  Object.assign(cam, w.__oilrig.dbg.camera);
  step();
}

/** What three and the game's profiler report, read from the page. */
function readState() {
  const o = (window as any).__oilrig;
  const r = o.renderer;
  const report = o.perf.report();
  const pipelines = r._pipelines;
  const size = (m: any) => (m && typeof m.size === 'number' ? m.size : null);
  return {
    frames: o.stats.frames,
    canvas: report.canvas,
    resolutionScale: report.resolutionScale,
    quality: report.quality,
    profiler: { cpuMs: report.cpuMs, sections: report.sections, gpu: report.gpu, drawCalls: report.renderer.drawCalls, triangles: report.renderer.triangles, computeCalls: report.renderer.computeCalls },
    three: {
      geometries: r.info.memory.geometries,
      textures: r.info.memory.textures,
      pipelines: size(pipelines?.caches),
      vertexPrograms: size(pipelines?.programs?.vertex),
      fragmentPrograms: size(pipelines?.programs?.fragment),
      computePrograms: size(pipelines?.programs?.compute),
    },
    gpu: (window as any).__bench.gpu ? { total: { ...(window as any).__bench.gpu.total } } : null,
  };
}

// ---------------------------------------------------------------- the Node side

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serve(dir: string): Promise<{ url: string; server: Server }> {
  const root = path.resolve(dir);
  if (!existsSync(path.join(root, 'index.html'))) throw new Error(`${dir} has no index.html: build the client first`);
  const server = createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const file = path.join(root, name === '/' ? 'index.html' : name);
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server })));
}

const ARGS = ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'];
const UNCAPPED = ['--disable-frame-rate-limit', '--disable-gpu-vsync'];

function launch(uncapped: boolean) {
  return chromium.launch({ channel: 'chrome', headless: true, args: [...ARGS, ...(uncapped ? UNCAPPED : [])] });
}

async function openPage(browser: Browser, url: string, opts: RecorderOptions = {}, viewport = VIEWPORT) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(recorder, opts);
  await page.goto(url);
  return { context, page, errors };
}

const waitFrames = (page: Page, n: number) => page.waitForFunction((k) => (window as any).__oilrig?.stats.frames > k, n, { timeout: 180_000 });

const quantile = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0);
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** A 60 Hz refresh, with room for the jitter of the frame timestamps. */
const BUDGET_MS = 1000 / 60;
const OVER_BUDGET_MS = BUDGET_MS + 0.5;
const HITCH_MS = 2.5 * BUDGET_MS;
const LONG_HITCH_MS = 100;

function frameStats(t: number[], cpu: number[]) {
  const dt: number[] = [];
  for (let i = 1; i < t.length; i++) dt.push(t[i] - t[i - 1]);
  const sorted = [...dt].sort((a, b) => a - b);
  const seconds = (t[t.length - 1] - t[0]) / 1000;
  const cpuSorted = [...cpu].sort((a, b) => a - b);
  return {
    frames: dt.length,
    seconds: round(seconds),
    fps: round(dt.length / seconds),
    frameMs: { avg: round(mean(dt)), p50: round(quantile(sorted, 0.5)), p95: round(quantile(sorted, 0.95)), p99: round(quantile(sorted, 0.99)), max: round(sorted.at(-1) ?? 0) },
    overBudgetPct: round((100 * dt.filter((v) => v > OVER_BUDGET_MS).length) / dt.length),
    hitches: dt.filter((v) => v > HITCH_MS).length,
    hitchesPerMin: round((60 * dt.filter((v) => v > HITCH_MS).length) / seconds),
    longHitches: dt.filter((v) => v > LONG_HITCH_MS).length,
    cpuMs: { avg: round(mean(cpu)), p50: round(quantile(cpuSorted, 0.5)), p95: round(quantile(cpuSorted, 0.95)), max: round(cpuSorted.at(-1) ?? 0) },
  };
}

async function heap(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize, totalSize } = await cdp.send('Runtime.getHeapUsage');
  await cdp.detach();
  return { usedMB: round(usedSize / 1048576), totalMB: round(totalSize / 1048576) };
}

/** Physical memory of Chrome's GPU and renderer processes (macOS `footprint`), MB. */
async function processMemory(browser: Browser) {
  try {
    const cdp = await browser.newBrowserCDPSession();
    const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
    await cdp.detach();
    const out: Record<string, { footprintMB: number; peakMB: number }> = {};
    for (const p of processInfo) {
      const type = p.type.toLowerCase();
      if (type !== 'gpu' && type !== 'renderer') continue;
      const text = execFileSync('footprint', ['-p', String(p.id)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const mb = (label: string) => {
        const m = new RegExp(`${label}:\\s*([\\d.]+)\\s*(KB|MB|GB)`).exec(text);
        return m ? round(Number(m[1]) * (m[2] === 'GB' ? 1024 : m[2] === 'KB' ? 1 / 1024 : 1)) : NaN;
      };
      const cur = out[type];
      const v = { footprintMB: mb('phys_footprint'), peakMB: mb('phys_footprint_peak') };
      // Several renderers (the page and helpers): keep the largest.
      if (!cur || v.footprintMB > cur.footprintMB) out[type] = v;
    }
    return out;
  } catch {
    return null;
  }
}

interface Args {
  suite: string;
  builds: Array<{ label: string; dir: string }>;
  runs: number;
  uncapped: boolean;
  only: string[] | null;
  out: string;
  seconds: number | null;
  settle: number | null;
  label: string;
  /** Other cores to keep busy meanwhile (the `thread` suite). */
  busy: number;
  rest: string[];
}

function parseArgs(): Args {
  const [suite = 'help', ...argv] = process.argv.slice(2);
  const a: Args = { suite, builds: [], runs: 1, uncapped: false, only: null, out: 'bench-results', seconds: null, settle: null, label: '', busy: 0, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--build') {
      const [label, dir] = argv[++i].split('=');
      a.builds.push({ label, dir });
    } else if (v === '--runs') a.runs = Number(argv[++i]);
    else if (v === '--uncapped') a.uncapped = true;
    else if (v === '--only') a.only = argv[++i].split(',');
    else if (v === '--out') a.out = argv[++i];
    else if (v === '--seconds') a.seconds = Number(argv[++i]);
    else if (v === '--settle') a.settle = Number(argv[++i]) * 1000;
    else if (v === '--label') a.label = argv[++i];
    else if (v === '--busy') a.busy = Number(argv[++i]);
    else a.rest.push(v);
  }
  return a;
}

function environment(uncapped: boolean, browser: Browser) {
  const sys = (k: string) => execFileSync('sysctl', ['-n', k], { encoding: 'utf8' }).trim();
  return {
    date: new Date().toISOString(),
    machine: process.platform === 'darwin' ? `${sys('machdep.cpu.brand_string')}, ${Math.round(Number(sys('hw.memsize')) / 2 ** 30)} GB` : process.platform,
    os: process.platform === 'darwin' ? `macOS ${execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim()}` : process.platform,
    browser: `Chrome ${browser.version()} headless`,
    flags: [...ARGS, ...(uncapped ? UNCAPPED : [])].join(' '),
    viewport: `${VIEWPORT.width}x${VIEWPORT.height} @1x`,
    frameCap: uncapped ? 'none' : '60 Hz (headless)',
  };
}

function save(a: Args, name: string, data: unknown) {
  mkdirSync(a.out, { recursive: true });
  const file = path.join(a.out, `${name}${a.label ? `-${a.label}` : ''}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  // The builds in the order given: the first is the original, whichever happened to run first.
  writeFileSync(file, JSON.stringify({ builds: a.builds.map((b) => b.label), ...(data as object) }));
  console.log(`→ ${file}`);
  return file;
}

/** Runs `fn` for every build in every run, alternating the order so neither build always goes first. */
async function eachRun(a: Args, fn: (build: { label: string; url: string }, run: number) => Promise<void>) {
  const served = await Promise.all(a.builds.map(async (b) => ({ label: b.label, ...(await serve(b.dir)) })));
  try {
    for (let run = 0; run < a.runs; run++) {
      const order = run % 2 === 0 ? served : [...served].reverse();
      for (const b of order) await fn(b, run);
    }
  } finally {
    for (const s of served) s.server.close();
  }
}

const SETTLE_MS = 8000;

/**
 * Frame pacing per scenario. Builds alternate within each scenario (one browser per run, a new
 * page per measurement), so slow drift of the machine falls on all of them alike.
 */
async function timing(a: Args) {
  const scenarios = SCENARIOS.filter((s) => !a.only || a.only.includes(s.id));
  const results: any[] = [];
  let env: unknown = null;
  const settle = a.settle ?? SETTLE_MS;
  const served = await Promise.all(a.builds.map(async (b) => ({ label: b.label, ...(await serve(b.dir)) })));
  try {
    for (let run = 0; run < a.runs; run++) {
      const browser = await launch(a.uncapped);
      env ??= environment(a.uncapped, browser);
      try {
        for (const [si, s] of scenarios.entries()) {
          // Rotate who goes first.
          const order = served.map((_, i) => served[(i + run + si) % served.length]);
          for (const build of order) {
            const { context, page, errors } = await openPage(browser, `${build.url}/?${BASE}&${s.query}`);
            await waitFrames(page, 30);
            await page.waitForTimeout(settle);
            if (s.path) await page.evaluate(flyPath, { path: PATH, leg: PATH_LEG });
            const seconds = a.seconds ?? s.seconds ?? 15;
            await page.evaluate(() => (window as any).__bench.start());
            await page.waitForTimeout(seconds * 1000);
            const rec = await page.evaluate(() => {
              const b = (window as any).__bench;
              b.stop();
              return { t: b.t, cpu: b.cpu };
            });
            const state = await page.evaluate(readState);
            const stats = frameStats(rec.t, rec.cpu);
            const dt = rec.t.slice(1).map((v: number, i: number) => round(v - rec.t[i]));
            results.push({ build: build.label, run, scenario: s.id, group: s.group, stats, state, errors, dt, cpu: rec.cpu.map((v: number) => round(v)) });
            console.log(
              `${build.label.padEnd(8)} run ${run} ${s.id.padEnd(22)} ${String(stats.fps).padStart(6)} fps  p50 ${stats.frameMs.p50} p95 ${stats.frameMs.p95} p99 ${stats.frameMs.p99} max ${stats.frameMs.max} ms  over ${stats.overBudgetPct}%  hitches ${stats.hitches}  cpu ${stats.cpuMs.avg} ms  ${state.canvas.width}x${state.canvas.height}${errors.length ? `  ERRORS ${errors.length}: ${errors[0].slice(0, 120)}` : ''}`,
            );
            await context.close();
          }
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    for (const s of served) s.server.close();
  }
  const file = save(a, `timing-${a.uncapped ? 'uncapped' : 'capped'}`, { suite: 'timing', env, budgetMs: BUDGET_MS, overBudgetMs: OVER_BUDGET_MS, hitchMs: HITCH_MS, settleMs: settle, results });
  summarize(file);
}

/** Per scenario and build: the median over runs of each run's numbers, and against the first build. */
function summarize(file: string) {
  const { results } = JSON.parse(readFileSync(file, 'utf8'));
  const builds = [...new Set(results.map((r: any) => r.build))] as string[];
  const scenarios = [...new Set(results.map((r: any) => r.scenario))] as string[];
  const med = (v: number[]) => quantile([...v].sort((x, y) => x - y), 0.5);
  console.log(`\n${'scenario'.padEnd(22)} ${'build'.padEnd(8)} runs   fps  avg ms  p50  p95  p99   max  over%  hitches  cpu ms   vs ${builds[0]} (avg ms, paired by run)`);
  for (const sc of scenarios) {
    const base = results.filter((r: any) => r.scenario === sc && r.build === builds[0]);
    for (const b of builds) {
      const rows = results.filter((r: any) => r.scenario === sc && r.build === b);
      if (!rows.length) continue;
      const g = (f: (r: any) => number) => med(rows.map(f));
      const paired = rows.map((r: any) => {
        const o = base.find((x: any) => x.run === r.run);
        return o ? (100 * (r.stats.frameMs.avg - o.stats.frameMs.avg)) / o.stats.frameMs.avg : NaN;
      }).filter((v: number) => Number.isFinite(v));
      const delta = b === builds[0] || !paired.length ? '' : `${med(paired) >= 0 ? '+' : ''}${med(paired).toFixed(1)}%  [${Math.min(...paired).toFixed(1)} … ${Math.max(...paired).toFixed(1)}]`;
      console.log(
        `${sc.padEnd(22)} ${b.padEnd(8)} ${String(rows.length).padStart(4)} ${g((r) => r.stats.fps).toFixed(1).padStart(6)} ${g((r) => r.stats.frameMs.avg).toFixed(2).padStart(6)} ${g((r) => r.stats.frameMs.p50).toFixed(1).padStart(5)} ${g((r) => r.stats.frameMs.p95).toFixed(1).padStart(4)} ${g((r) => r.stats.frameMs.p99).toFixed(1).padStart(4)} ${Math.max(...rows.map((r: any) => r.stats.frameMs.max)).toFixed(0).padStart(5)} ${g((r) => r.stats.overBudgetPct).toFixed(2).padStart(6)} ${String(rows.reduce((x: number, r: any) => x + r.stats.hitches, 0)).padStart(7)} ${g((r) => r.stats.cpuMs.avg).toFixed(2).padStart(7)}   ${delta}`,
      );
    }
  }
}

const STARTUP_QUERY = 'cam=refn&hour=11&weather=fair&q=high';

async function startup(a: Args) {
  const results: any[] = [];
  let env: unknown = null;
  // `cold`: every fragment shader is new to the GPU's shader cache, as on a first visit or after
  // a release that changed the shaders. `warm`: the cache has them (one unmeasured visit first).
  for (const mode of ['warm', 'cold'] as const) {
    if (a.only && !a.only.includes(mode)) continue;
    await eachRun({ ...a, runs: a.runs + (mode === 'warm' ? 1 : 0) }, async (build, run) => {
      const browser = await launch(false);
      env ??= environment(false, browser);
      try {
        const nonce = mode === 'cold' ? (Date.now() % 1e6) + run * 7 + build.label.length : undefined;
        const { context, page, errors } = await openPage(browser, `${build.url}/?${BASE}&${STARTUP_QUERY}`, { coldNonce: nonce });
        await page.waitForFunction(() => (window as any).__bench?.marks.frame120, undefined, { timeout: 240_000 });
        // The first bake of the light probes carries on behind the first frames.
        await page.waitForTimeout(2500);
        const r = await page.evaluate(() => {
          const b = (window as any).__bench;
          const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
          return { marks: b.marks, steps: b.steps, longTasks: b.longTasks, perturbed: b.perturbed, bakes: b.bakes, domContentLoaded: nav?.domContentLoadedEventEnd ?? null };
        });
        const state = await page.evaluate(readState);
        const until = r.marks.frame3;
        const blocking = r.longTasks.filter(([start]: number[]) => start < until);
        const row = {
          build: build.label,
          run,
          mode,
          // The scene is usable when the loading screen starts to lift: the third frame.
          usableMs: round(r.marks.frame3, 0),
          firstFrameMs: round(r.marks.firstFrame, 0),
          frame120Ms: round(r.marks.frame120, 0),
          // The interior's bounce light is complete when the last probe of the first bake is in.
          probesBakedMs: r.bakes.length ? round(r.bakes.at(-1)[0] + r.bakes.at(-1)[1], 0) : null,
          steps: r.steps.map(([t, text]: [number, string]) => [round(t, 0), text]),
          blockingMs: round(blocking.reduce((s: number, [, d]: number[]) => s + Math.max(0, d - 50), 0), 0),
          longestTaskMs: round(Math.max(0, ...blocking.map(([, d]: number[]) => d)), 0),
          longTasks: blocking.length,
          perturbed: r.perturbed,
          state,
          errors,
        };
        if (mode === 'warm' && run === 0) console.log(`${build.label.padEnd(8)} warm-up visit (not measured): usable ${row.usableMs} ms`);
        else {
          results.push(row);
          console.log(`${build.label.padEnd(8)} ${mode} run ${run}: usable ${row.usableMs} ms, first frame ${row.firstFrameMs}, 120 frames ${row.frame120Ms}, probes baked ${row.probesBakedMs}, blocking ${row.blockingMs} ms (longest task ${row.longestTaskMs})${nonce === undefined ? '' : `, ${r.perturbed} shaders made new`}`);
        }
        await context.close();
      } finally {
        await browser.close();
      }
    });
  }
  save(a, 'startup', { suite: 'startup', env, query: STARTUP_QUERY, results });
}

async function count(a: Args) {
  const scenarios = SCENARIOS.filter((s) => !a.only || a.only.includes(s.id));
  const results: any[] = [];
  let env: unknown = null;
  await eachRun(a, async (build, run) => {
    const browser = await launch(false);
    env ??= environment(false, browser);
    try {
      for (const s of scenarios) {
        const { context, page, errors } = await openPage(browser, `${build.url}/?${BASE}&${s.query}`, { count: true });
        await waitFrames(page, 30);
        const atStart = await page.evaluate(readState);
        await page.waitForTimeout(SETTLE_MS);
        if (s.path) await page.evaluate(flyPath, { path: PATH, leg: PATH_LEG });
        await page.evaluate(() => (window as any).__bench.start());
        await page.waitForTimeout((a.seconds ?? s.seconds ?? 15) * 1000);
        const frames: Array<Record<string, number>> = await page.evaluate(() => {
          const b = (window as any).__bench;
          b.stop();
          return b.gpu.frames;
        });
        const state = await page.evaluate(readState);
        const memory = { heap: await heap(page), processes: await processMemory(browser) };
        const keys = Object.keys(frames[0] ?? {});
        const per = (fn: (v: number[]) => number) => Object.fromEntries(keys.map((k) => [k, round(fn(frames.map((f) => f[k])), 1)]));
        const summary = { frames: frames.length, median: per((v) => quantile([...v].sort((x, y) => x - y), 0.5)), mean: per(mean), max: per((v) => Math.max(...v)) };
        results.push({ build: build.label, run, scenario: s.id, summary, atStart, state, memory, errors });
        const m = summary.median;
        console.log(
          `${build.label.padEnd(8)} ${s.id.padEnd(22)} draws ${m.draws} tris ${(m.triangles / 1e6).toFixed(2)}M passes ${m.renderPasses}r+${m.computePasses}c dispatches ${m.dispatches} uploads ${(summary.mean.writeBufferBytes / 1024).toFixed(1)} KB/frame  pipelines ${state.gpu?.total.renderPipelines}r+${state.gpu?.total.computePipelines}c modules ${state.gpu?.total.shaderModules}  geometries ${state.three.geometries} textures ${state.three.textures}  heap ${memory.heap.usedMB} MB`,
        );
        await context.close();
      }
    } finally {
      await browser.close();
    }
  });
  save(a, 'count', { suite: 'count', env, results });
}

/** What each ?off= feature costs: frame time without the cap, with and without it, from three viewpoints. */
async function attrib(a: Args) {
  const cams = a.only ?? ['refn', 'deck', 'interior'];
  const features = ['', 'ao', 'bloom', 'traa', 'ao,bloom,traa', 'shadows', 'ocean', 'grass', 'probes', 'ao,bloom,traa,shadows,ocean,grass,probes'];
  const quality = a.rest[0] ?? 'high';
  const results: any[] = [];
  let env: unknown = null;
  await eachRun(a, async (build, run) => {
    const browser = await launch(true);
    env ??= environment(true, browser);
    try {
      for (const cam of cams) {
        let full = 0;
        for (const off of features) {
          const { context, page, errors } = await openPage(browser, `${build.url}/?${BASE}&perf&cam=${cam}&hour=11&weather=fair&q=${quality}${off ? `&off=${off}` : ''}`);
          await waitFrames(page, 30);
          await page.waitForTimeout(6000);
          await page.evaluate(() => (window as any).__bench.start());
          await page.waitForTimeout((a.seconds ?? 6) * 1000);
          const rec = await page.evaluate(() => {
            const b = (window as any).__bench;
            b.stop();
            return { t: b.t, cpu: b.cpu };
          });
          const state = await page.evaluate(readState);
          const stats = frameStats(rec.t, rec.cpu);
          if (!off) full = stats.frameMs.p50;
          results.push({ build: build.label, run, cam, off, stats, state, errors });
          const sections = state.profiler.sections.slice(0, 5).map((s: { name: string; ms: number }) => `${s.name} ${s.ms}`).join(', ');
          console.log(`${build.label.padEnd(8)} ${cam.padEnd(9)} off=${(off || '-').padEnd(40)} p50 ${String(stats.frameMs.p50).padStart(5)} ms (${off ? `saves ${round(full - stats.frameMs.p50)}` : 'full'})  gpu>=${state.profiler.gpu.renderMs}r/${state.profiler.gpu.computeMs}c  draws ${state.profiler.drawCalls} tris ${(state.profiler.triangles / 1e6).toFixed(2)}M  [${sections}]${errors.length ? ` ERRORS ${errors[0]}` : ''}`);
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  });
  save(a, `attrib-${quality}`, { suite: 'attrib', env, results });
}

/** One frame's passes in order, and the textures alive, largest first. */
async function passes(a: Args) {
  const scenarios = SCENARIOS.filter((s) => (a.only ?? ['high-refn']).includes(s.id));
  await eachRun(a, async (build) => {
    const browser = await launch(false);
    try {
      for (const s of scenarios) {
        const { context, page } = await openPage(browser, `${build.url}/?${BASE}&${s.query}`, { count: true });
        await waitFrames(page, 30);
        await page.waitForTimeout(SETTLE_MS);
        await page.evaluate(() => ((window as any).__bench.gpu.capture = 'armed'));
        await page.waitForFunction(() => (window as any).__bench.gpu.captured);
        const r = await page.evaluate(() => {
          const g = (window as any).__bench.gpu;
          return { passes: g.captured, textures: [...g.liveTextures.values()].sort((x: any, y: any) => y.bytes - x.bytes) };
        });
        console.log(`\n== ${build.label} ${s.id}: ${r.passes.length} passes`);
        // Runs of the same pass collapse into one line.
        let prev = '';
        let n = 0;
        const flush = () => {
          if (n) console.log(`${n > 1 ? `${n}x `.padStart(5) : '     '}${prev}`);
        };
        for (const p of r.passes) {
          const line = p.type === 'render' ? `render  [${p.color.join(' | ')}]${p.depth ? ` depth[${p.depth}]` : ''} draws ${p.draws} tris ${p.triangles}` : `compute dispatches ${p.dispatches}`;
          if (line === prev) n++;
          else {
            flush();
            prev = line;
            n = 1;
          }
        }
        flush();
        console.log(`\n${r.textures.length} textures, ${round(r.textures.reduce((x: number, t: any) => x + t.bytes, 0) / 1048576, 1)} MB (estimate from format and size)`);
        for (const t of r.textures.slice(0, 40)) console.log(`  ${String(round(t.bytes / 1048576, 1)).padStart(7)} MB  ${t.format.padEnd(22)} ${t.size.join('x').padEnd(14)} mips ${t.mips} ${t.label}`);
        save(a, `passes-${build.label}-${s.id}`, r);
        await context.close();
      }
    } finally {
      await browser.close();
    }
  });
}

/** Records every render of the sky's environment map from now on (the recorder already notes the probe bakes). */
function watchEnvironment() {
  const w = window as any;
  const o = w.__oilrig;
  const b = w.__bench;
  const scene = o.camera.parent;
  b.envRenders = [];
  const render = o.renderer.render;
  o.renderer.render = function (this: any, target: any, ...rest: any[]) {
    // The environment map renders a scene of its own.
    if (target?.isScene && target !== scene) b.envRenders.push(performance.now());
    return render.call(this, target, ...rest);
  };
}

const REGEN_STEPS: Array<[number, string]> = [
  [20, 'storm'],
  [2, 'clear'],
  [7, 'fog'],
  [13, 'fair'],
  [18.5, 'rain'],
  [23, 'clear'],
  [5, 'overcast'],
  [11, 'fair'],
];
/** Probe re-bakes are at least 20 s apart, so each step gets longer than that. */
const REGEN_STEP_MS = 24_000;

/**
 * Regeneration: jumps the time of day and the weather, which rebuilds the ocean's spectrum,
 * re-renders the sky's environment map and re-bakes the light probes. Measures how long each
 * takes, what it does to the frames meanwhile, and what memory does over repeated rounds.
 */
async function regen(a: Args) {
  const results: any[] = [];
  let env: unknown = null;
  const rounds = a.rest[0] ? Number(a.rest[0]) : 1;
  const regenSteps = REGEN_STEPS.slice(0, a.rest[1] ? Number(a.rest[1]) : REGEN_STEPS.length);
  await eachRun(a, async (build, run) => {
    const browser = await launch(a.uncapped);
    env ??= environment(a.uncapped, browser);
    try {
      const { context, page, errors } = await openPage(browser, `${build.url}/?${BASE}&cam=deck&hour=11&weather=fair&q=high`, { count: true });
      await waitFrames(page, 30);
      await page.evaluate(watchEnvironment);
      // Past the first bake's 20 s window, so each step's bake starts with the step.
      await page.waitForTimeout(22_000);
      const memory = async () => ({ heap: await heap(page), processes: await processMemory(browser), state: await page.evaluate(readState) });
      const steps: any[] = [];
      const before = await memory();
      for (let cycle = 0; cycle < rounds; cycle++) {
        for (const [hour, weather] of regenSteps) {
          const t0: number = await page.evaluate(
            ([h, wx]) => {
              const w = window as any;
              w.__bench.bakes.length = 0;
              w.__bench.envRenders.length = 0;
              w.__bench.start();
              w.__oilrig.dbg.hour = h;
              w.__oilrig.dbg.weather = wx;
              return performance.now();
            },
            [hour, WEATHER[weather]] as const,
          );
          await page.waitForTimeout(REGEN_STEP_MS);
          const rec = await page.evaluate(() => {
            const b = (window as any).__bench;
            b.stop();
            return { t: b.t, cpu: b.cpu, bakes: b.bakes, envRenders: b.envRenders, gpuFrames: b.gpu.frames.map((f: any) => [f.draws, f.renderPasses, f.newBuffers, f.newTextures, f.newPipelines]) };
          });
          const stats = frameStats(rec.t, rec.cpu);
          const lastBake = rec.bakes.at(-1);
          const bakeEnd = lastBake ? lastBake[0] + lastBake[1] : t0;
          // Frames from the change until the probes are done: the regeneration.
          const during = rec.t.map((t: number, i: number) => (i > 0 && t <= bakeEnd + 50 ? t - rec.t[i - 1] : -1)).filter((v: number) => v >= 0);
          const sortedDuring = [...during].sort((x: number, y: number) => x - y);
          steps.push({
            round: cycle,
            hour,
            weather,
            regenerationMs: round0(bakeEnd - t0),
            bakeCalls: rec.bakes.length,
            bakeCpuMs: round(rec.bakes.reduce((x: number, v: number[]) => x + v[1], 0)),
            bakeCpuMaxMs: round(Math.max(0, ...rec.bakes.map((v: number[]) => v[1]))),
            envRenders: rec.envRenders.length,
            during: { frames: during.length, p50: round(quantile(sortedDuring, 0.5)), p95: round(quantile(sortedDuring, 0.95)), max: round(sortedDuring.at(-1) ?? 0), overBudget: during.filter((v: number) => v > OVER_BUDGET_MS).length, hitches: during.filter((v: number) => v > HITCH_MS).length },
            window: stats,
            maxDrawsInFrame: Math.max(...rec.gpuFrames.map((f: number[]) => f[0])),
            maxPassesInFrame: Math.max(...rec.gpuFrames.map((f: number[]) => f[1])),
            newPipelines: rec.gpuFrames.reduce((x: number, f: number[]) => x + f[4], 0),
            memory: await memory(),
          });
          const st = steps.at(-1);
          console.log(
            `${build.label.padEnd(8)} run ${run} round ${cycle} → ${String(hour).padStart(4)}h ${weather.padEnd(8)} regeneration ${st.regenerationMs} ms in ${st.bakeCalls} bakes (bake() ${st.bakeCpuMs} ms, max ${st.bakeCpuMaxMs}); frames meanwhile p50 ${st.during.p50} p95 ${st.during.p95} max ${st.during.max} ms, ${st.during.overBudget} over budget; heap ${st.memory.heap.usedMB} MB, GPU buffers ${round(st.memory.state.gpu.total.liveBufferBytes / 1048576, 1)} MB, textures ${st.memory.state.three.textures}, new pipelines ${st.newPipelines}`,
          );
        }
      }
      results.push({ build: build.label, run, before, steps, errors });
      await context.close();
    } finally {
      await browser.close();
    }
  });
  save(a, `regen-${a.uncapped ? 'uncapped' : 'capped'}`, { suite: 'regen', env, stepMs: REGEN_STEP_MS, results });
}
const round0 = (v: number) => Math.round(v);

/** Tears the whole page down and builds the world again, several times: memory must not creep. */
async function reload(a: Args) {
  const results: any[] = [];
  let env: unknown = null;
  const loads = a.rest[0] ? Number(a.rest[0]) : 6;
  await eachRun(a, async (build, run) => {
    const browser = await launch(false);
    env ??= environment(false, browser);
    try {
      const { context, page, errors } = await openPage(browser, `${build.url}/?${BASE}&${STARTUP_QUERY}`);
      const rows: any[] = [];
      for (let i = 0; i < loads; i++) {
        if (i > 0) await page.reload();
        await page.waitForFunction(() => (window as any).__bench?.marks.frame120, undefined, { timeout: 240_000 });
        await page.waitForTimeout(3000);
        const usableMs = await page.evaluate(() => Math.round((window as any).__bench.marks.frame3));
        const row = { load: i, usableMs, heap: await heap(page), processes: await processMemory(browser) };
        rows.push(row);
        console.log(`${build.label.padEnd(8)} run ${run} load ${i}: usable ${usableMs} ms, heap ${row.heap.usedMB} MB, renderer ${row.processes?.renderer?.footprintMB} MB (peak ${row.processes?.renderer?.peakMB}), gpu process ${row.processes?.gpu?.footprintMB} MB (peak ${row.processes?.gpu?.peakMB})`);
      }
      results.push({ build: build.label, run, rows, errors });
      await context.close();
    } finally {
      await browser.close();
    }
  });
  save(a, 'reload', { suite: 'reload', env, results });
}

/** Repeatable pictures: seeded random numbers, a clock that steps with the frames, frame SHOT_FRAMES. */
async function shots(a: Args) {
  const list = SHOTS.filter(([name]) => !a.only || a.only.includes(name));
  await eachRun(a, async (build, run) => {
    const dir = path.join(a.out, 'shots', `${build.label}${a.runs > 1 ? `-${run}` : ''}`);
    mkdirSync(dir, { recursive: true });
    const browser = await launch(false);
    try {
      for (const [name, query, camera] of list) {
        const { context, page, errors } = await openPage(browser, `${build.url}/?${BASE}&${query}`, { deterministic: true, freezeAt: SHOT_FRAMES, camera }, SHOT_VIEWPORT);
        // Polled on a timer: once frozen, the page's animation frames (which the default polling uses) are held.
        await page.waitForFunction(() => (window as any).__bench.frozen, undefined, { timeout: 240_000, polling: 100 });
        await page.addStyleTag({ content: '.hud,#loader{display:none!important}' });
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(dir, `${name}.png`) });
        console.log(`${build.label.padEnd(8)} ${name}${errors.length ? `  ERRORS: ${errors[0]}` : ''}`);
        await context.close();
      }
    } finally {
      await browser.close();
    }
  });
}

/** Compares two directories of screenshots: node scripts/bench.ts diff <dirA> <dirB> [--out dir]. */
async function diff(a: Args) {
  const [dirA, dirB] = a.rest;
  const names = readdirSync(dirA).filter((f) => f.endsWith('.png') && existsSync(path.join(dirB, f)));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const rows: any[] = [];
  const outDir = path.join(a.out, 'diff', `${path.basename(dirA)}-vs-${path.basename(dirB)}`);
  mkdirSync(outDir, { recursive: true });
  for (const name of names) {
    const b64 = (d: string) => readFileSync(path.join(d, name)).toString('base64');
    const r = await page.evaluate(
      async ([pa, pb]) => {
        const load = async (data: string) => {
          const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
          const c = new OffscreenCanvas(img.width, img.height);
          const g = c.getContext('2d')!;
          g.drawImage(img, 0, 0);
          return g.getImageData(0, 0, img.width, img.height);
        };
        const [x, y] = [await load(pa), await load(pb)];
        if (x.width !== y.width || x.height !== y.height) return { error: 'sizes differ' };
        const n = x.width * x.height;
        let sum = 0;
        let max = 0;
        let over8 = 0;
        let over32 = 0;
        const worst: number[][] = []; // [x, y, difference] of pixels over 8/255
        const out = new ImageData(x.width, x.height);
        for (let i = 0; i < n; i++) {
          const d = Math.max(Math.abs(x.data[i * 4] - y.data[i * 4]), Math.abs(x.data[i * 4 + 1] - y.data[i * 4 + 1]), Math.abs(x.data[i * 4 + 2] - y.data[i * 4 + 2]));
          sum += (Math.abs(x.data[i * 4] - y.data[i * 4]) + Math.abs(x.data[i * 4 + 1] - y.data[i * 4 + 1]) + Math.abs(x.data[i * 4 + 2] - y.data[i * 4 + 2])) / 3;
          if (d > max) max = d;
          if (d > 8) {
            over8++;
            if (worst.length < 4000) worst.push([i % x.width, Math.floor(i / x.width), d]);
          }
          if (d > 32) over32++;
          // Differences ×8 over a dimmed copy of the first picture.
          const v = Math.min(255, d * 8);
          out.data[i * 4] = Math.max(v, x.data[i * 4] * 0.25);
          out.data[i * 4 + 1] = x.data[i * 4 + 1] * 0.25;
          out.data[i * 4 + 2] = x.data[i * 4 + 2] * 0.25;
          out.data[i * 4 + 3] = 255;
        }
        const c = new OffscreenCanvas(x.width, x.height);
        c.getContext('2d')!.putImageData(out, 0, 0);
        const blob = await c.convertToBlob({ type: 'image/png' });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        worst.sort((p, q) => q[2] - p[2]);
        return { mean: sum / n, max, over8: over8, over8Pct: (100 * over8) / n, over32Pct: (100 * over32) / n, worst: worst.slice(0, 24), png: btoa(bin) };
      },
      [b64(dirA), b64(dirB)] as const,
    );
    if ('error' in r) {
      console.log(`${name.padEnd(28)} ${r.error}`);
      continue;
    }
    writeFileSync(path.join(outDir, name), Buffer.from(r.png!, 'base64'));
    rows.push({ name, mean: round(r.mean!, 3), max: r.max, over8: r.over8, over8Pct: round(r.over8Pct!, 3), over32Pct: round(r.over32Pct!, 3), worst: r.worst });
    // With `where`: the pixels that differ most, as x,y=difference, to see what they are.
    const where = a.rest.includes('where') && r.over8 ? `  ${r.over8} px: ${r.worst!.slice(0, 8).map(([px, py, d]) => `${px},${py}=${d}`).join(' ')}` : '';
    console.log(`${name.padEnd(28)} mean ${r.mean!.toFixed(3)}/255  max ${String(r.max).padStart(3)}  >8: ${r.over8Pct!.toFixed(3)}%  >32: ${r.over32Pct!.toFixed(3)}%${where}`);
  }
  await browser.close();
  writeFileSync(path.join(outDir, 'diff.json'), JSON.stringify({ a: dirA, b: dirB, rows }, null, 1));
  console.log(`mean of means ${round(mean(rows.map((r) => r.mean)), 3)}/255 over ${rows.length} pictures → ${outDir}`);
}

/** Switches one thing on or off in the running page (for the `ablate` suite); returns whether it knew the name. */
function toggle([name, on]: [string, boolean]) {
  const w = window as any;
  const o = w.__oilrig;
  const scene = o.camera.parent;
  const find = (pred: (c: any) => boolean) => {
    let hit: any = null;
    scene.traverse((c: any) => {
      if (!hit && pred(c)) hit = c;
    });
    return hit;
  };
  const st = (w.__ablate ??= { lights: new Map(), compute: o.renderer.compute, sky: find((c) => c.renderOrder === -1000), ocean: find((c) => c.name === 'ocean'), grass: find((c) => c.name === 'grass') });
  const { sky, ocean } = st;
  switch (name) {
    case 'none':
      return true;
    // Lamps that are switched off (intensity 0) take no part in the light clusters.
    case 'darkLampsOut':
      scene.traverse((c: any) => {
        if (!c.isPointLight) return;
        if (on && c.intensity <= 0) {
          st.lights.set(c, c.distance);
          c.distance = 1e-3;
        } else if (!on && st.lights.has(c)) c.distance = st.lights.get(c);
      });
      if (!on) st.lights.clear();
      return true;
    case 'skyLate':
      sky.renderOrder = on ? 9 : -1000;
      return true;
    case 'skyHidden':
      sky.visible = !on;
      return true;
    case 'oceanHidden':
      ocean.visible = !on;
      return true;
    // The ocean's simulation stops (its compute calls are the arrays of kernels).
    case 'oceanStatic':
      o.renderer.compute = on
        ? function (this: any, nodes: any, ...rest: any[]) {
            if (Array.isArray(nodes)) return undefined;
            return st.compute.call(this, nodes, ...rest);
          }
        : st.compute;
      return true;
    // Only the inner half of the ocean's rings (the outer half lies beyond ~1 km).
    case 'oceanInnerHalf':
      ocean.geometry.setDrawRange(0, on ? Math.floor(ocean.geometry.index.count / 6) * 3 : Infinity);
      return true;
    case 'oceanNoShadow':
      ocean.receiveShadow = !on;
      return true;
    case 'glassHidden':
      scene.traverse((c: any) => {
        if (c.isMesh && c.material?.transparent && c.material.isMeshPhysicalNodeMaterial) c.visible = !on;
      });
      return true;
    case 'grassHidden':
      if (st.grass) st.grass.visible = !on;
      return true;
    default:
      return false;
  }
}

/**
 * What a few things cost, switched on and off in one running page so each comparison is a few
 * seconds apart: node scripts/bench.ts ablate --build x=dir [--only scenario,…] toggle toggle …
 */
async function ablate(a: Args) {
  const scenarios = SCENARIOS.filter((s) => (a.only ?? ['high-refn', 'high-deck', 'high-interior', 'high-aerial']).includes(s.id));
  const toggles = ['none', ...(a.rest.length ? a.rest : ['darkLampsOut', 'skyLate', 'skyHidden', 'oceanStatic', 'oceanHidden', 'glassHidden', 'grassHidden'])];
  const reps = a.runs > 1 ? a.runs : 4;
  const results: any[] = [];
  await eachRun({ ...a, runs: 1 }, async (build) => {
    const browser = await launch(true);
    try {
      for (const s of scenarios) {
        const { context, page, errors } = await openPage(browser, `${build.url}/?${BASE}&${s.query}`);
        await waitFrames(page, 30);
        await page.waitForTimeout(SETTLE_MS);
        const samples: Record<string, number[]> = Object.fromEntries(toggles.map((t) => [t, []]));
        for (let rep = 0; rep < reps; rep++) {
          for (const t of toggles) {
            await page.evaluate(toggle, [t, true] as [string, boolean]);
            await page.waitForTimeout(1200);
            await page.evaluate(() => (window as any).__bench.start());
            await page.waitForTimeout((a.seconds ?? 2.5) * 1000);
            const rec = await page.evaluate(() => {
              const b = (window as any).__bench;
              b.stop();
              return { t: b.t, cpu: b.cpu };
            });
            samples[t].push(frameStats(rec.t, rec.cpu).frameMs.avg);
            await page.evaluate(toggle, [t, false] as [string, boolean]);
          }
        }
        console.log(`\n${build.label} ${s.id}${errors.length ? `  ERRORS: ${errors[0].slice(0, 160)}` : ''}`);
        for (const t of toggles) {
          const d = samples[t].map((v, i) => (100 * (v - samples.none[i])) / samples.none[i]);
          const sorted = [...d].sort((x, y) => x - y);
          console.log(`  ${t.padEnd(14)} ${mean(samples[t]).toFixed(2).padStart(6)} ms  ${t === 'none' ? '' : `${quantile(sorted, 0.5) >= 0 ? '+' : ''}${quantile(sorted, 0.5).toFixed(1)}%  [${sorted[0].toFixed(1)} … ${sorted.at(-1)!.toFixed(1)}]`}`);
        }
        results.push({ build: build.label, scenario: s.id, samples, errors });
        await context.close();
      }
    } finally {
      await browser.close();
    }
  });
  save(a, 'ablate', { suite: 'ablate', results });
}

/** JavaScript allocated per frame (V8's sampling heap profiler), and which functions allocate it. */
async function alloc(a: Args) {
  const scenarios = SCENARIOS.filter((s) => (a.only ?? ['high-deck']).includes(s.id));
  const results: any[] = [];
  await eachRun(a, async (build, run) => {
    const browser = await launch(false);
    try {
      for (const s of scenarios) {
        const { context, page } = await openPage(browser, `${build.url}/?${BASE}&${s.query}`);
        await waitFrames(page, 30);
        await page.waitForTimeout(SETTLE_MS);
        const cdp = await context.newCDPSession(page);
        await cdp.send('HeapProfiler.enable');
        await cdp.send('HeapProfiler.collectGarbage');
        await cdp.send('HeapProfiler.startSampling', { samplingInterval: 2048, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
        await page.evaluate(() => (window as any).__bench.start());
        await page.waitForTimeout((a.seconds ?? 10) * 1000);
        const frames: number = await page.evaluate(() => {
          const b = (window as any).__bench;
          b.stop();
          return b.t.length;
        });
        const { profile } = await cdp.send('HeapProfiler.stopSampling');
        const by = new Map<string, number>();
        let total = 0;
        const walk = (n: any) => {
          total += n.selfSize;
          if (n.selfSize) {
            const f = n.callFrame;
            const key = `${f.functionName || '(anonymous)'} ${String(f.url).replace(/^.*\//, '')}:${f.lineNumber + 1}`;
            by.set(key, (by.get(key) ?? 0) + n.selfSize);
          }
          for (const c of n.children ?? []) walk(c);
        };
        walk(profile.head);
        const top = [...by].sort((x, y) => y[1] - x[1]).slice(0, 14);
        results.push({ build: build.label, run, scenario: s.id, frames, bytesPerFrame: Math.round(total / frames), top });
        console.log(`${build.label.padEnd(8)} ${s.id.padEnd(20)} ${(total / frames / 1024).toFixed(2)} KB allocated per frame (${frames} frames)`);
        for (const [k, v] of top) console.log(`    ${(v / frames / 1024).toFixed(2).padStart(6)} KB  ${k}`);
        await context.close();
      }
    } finally {
      await browser.close();
    }
  });
  save(a, 'alloc', { suite: 'alloc', results });
}

/** Where the main thread's time goes: V8's sampling CPU profiler, self time per function and frame. */
async function cpu(a: Args) {
  const scenarios = SCENARIOS.filter((s) => (a.only ?? ['high-deck']).includes(s.id));
  const results: any[] = [];
  await eachRun(a, async (build, run) => {
    const browser = await launch(false);
    try {
      for (const s of scenarios) {
        const { context, page } = await openPage(browser, `${build.url}/?${BASE}&${s.query}`);
        await waitFrames(page, 30);
        await page.waitForTimeout(SETTLE_MS);
        const cdp = await context.newCDPSession(page);
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
        await cdp.send('Profiler.start');
        await page.evaluate(() => (window as any).__bench.start());
        await page.waitForTimeout((a.seconds ?? 10) * 1000);
        const frames: number = await page.evaluate(() => {
          const b = (window as any).__bench;
          b.stop();
          return b.t.length;
        });
        const { profile } = await cdp.send('Profiler.stop');
        const self = new Map<number, number>();
        const dts = profile.timeDeltas ?? [];
        (profile.samples ?? []).forEach((id: number, i: number) => self.set(id, (self.get(id) ?? 0) + (dts[i] ?? 0)));
        const by = new Map<string, number>();
        let total = 0;
        for (const n of profile.nodes) {
          const us = self.get(n.id) ?? 0;
          const f = n.callFrame;
          const key = `${f.functionName || '(anonymous)'} ${String(f.url).replace(/^.*\//, '')}:${f.lineNumber + 1}`;
          if (f.functionName === '(idle)' || f.functionName === '(program)' || f.functionName === '(root)') continue;
          total += us;
          by.set(key, (by.get(key) ?? 0) + us);
        }
        const top = [...by].sort((x, y) => y[1] - x[1]).slice(0, a.rest[0] ? Number(a.rest[0]) : 40);
        results.push({ build: build.label, run, scenario: s.id, frames, usPerFrame: Math.round(total / frames), top: top.map(([k, v]) => [k, Math.round(v / frames)]) });
        console.log(`${build.label} ${s.id}: ${(total / frames / 1000).toFixed(2)} ms of script per frame (${frames} frames)`);
        for (const [k, v] of top) console.log(`  ${(v / frames).toFixed(0).padStart(5)} µs  ${k}`);
        await context.close();
      }
    } finally {
      await browser.close();
    }
  });
  save(a, 'cpu', { suite: 'cpu', results });
}

/**
 * The main thread inside the animation callbacks, from a Chrome trace: wall time and CPU time
 * (the thread's own clock, so without waiting), and the garbage collections meanwhile.
 */
async function thread(a: Args) {
  const scenarios = SCENARIOS.filter((s) => (a.only ?? ['high-refn', 'high-deck', 'high-interior', 'high-swim']).includes(s.id));
  const results: any[] = [];
  // Under the cap the main thread works for a sixth of the time and macOS runs it slower for
  // it: the same callbacks then take half as long again. Busy neighbours keep the CPU at speed.
  const spinners = Array.from({ length: a.busy }, () => spawn(process.execPath, ['-e', 'for(;;);'], { stdio: 'ignore' }));
  try {
    await threadRuns(a, scenarios, results);
  } finally {
    for (const s of spinners) s.kill();
  }
  save(a, `thread-${a.uncapped ? 'uncapped' : 'capped'}${a.busy ? '-busy' : ''}`, { suite: 'thread', busy: a.busy, results });
}

async function threadRuns(a: Args, scenarios: Scenario[], results: any[]) {
  await eachRun(a, async (build, run) => {
    const browser = await launch(a.uncapped);
    try {
      for (const s of scenarios) {
        const { context, page, errors } = await openPage(browser, `${build.url}/?${BASE}&${s.query}`);
        await waitFrames(page, 30);
        await page.waitForTimeout(a.settle ?? SETTLE_MS);
        await browser.startTracing(page, { categories: ['devtools.timeline', 'v8', 'blink.user_timing'] });
        await page.evaluate(() => {
          performance.mark('bench:start');
          (window as any).__bench.start();
        });
        await page.waitForTimeout((a.seconds ?? 10) * 1000);
        const rec = await page.evaluate(() => {
          const b = (window as any).__bench;
          b.stop();
          performance.mark('bench:stop');
          return { frames: b.t.length, scriptMs: b.cpu.reduce((x: number, y: number) => x + y, 0) };
        });
        const trace = JSON.parse((await browser.stopTracing()).toString('utf8'));
        const events: any[] = trace.traceEvents ?? trace;
        const at = (name: string) => events.find((e) => e.name === name && String(e.cat).includes('blink.user_timing'))?.ts as number | undefined;
        const from = at('bench:start');
        const to = at('bench:stop');
        if (from === undefined || to === undefined) throw new Error('the trace has no bench:start / bench:stop marks');
        const inWindow = (e: any) => e.ph === 'X' && e.ts >= from && e.ts + (e.dur ?? 0) <= to;
        const fires = events.filter((e) => e.name === 'FireAnimationFrame' && inWindow(e));
        if (!fires.length) throw new Error('the trace has no FireAnimationFrame events');
        const main = `${fires[0].pid}:${fires[0].tid}`;
        const sum = (list: any[], key: string) => list.reduce((x, e) => x + (e[key] ?? 0), 0) / 1000;
        const hasThreadClock = fires.every((e) => typeof e.tdur === 'number');
        const gc = (name: string) => {
          const list = events.filter((e) => e.name === name && inWindow(e) && `${e.pid}:${e.tid}` === main);
          return { count: list.length, totalMs: round(sum(list, 'dur')), longestMs: round(Math.max(0, ...list.map((e) => (e.dur ?? 0) / 1000))) };
        };
        const row = {
          build: build.label,
          run,
          scenario: s.id,
          errors,
          frames: rec.frames,
          seconds: round((to - from) / 1e6),
          callbacks: fires.length,
          wallMs: round(sum(fires, 'dur') / rec.frames, 3),
          cpuMs: hasThreadClock ? round(sum(fires, 'tdur') / rec.frames, 3) : null,
          recorderMs: round(rec.scriptMs / rec.frames, 3),
          minorGC: gc('MinorGC'),
          majorGC: gc('MajorGC'),
        };
        results.push(row);
        console.log(
          `${build.label.padEnd(8)} run ${run} ${s.id.padEnd(22)} in animation callbacks per frame: ${row.wallMs} ms wall, ${row.cpuMs ?? 'n/a'} ms CPU (${row.callbacks} callbacks in ${row.frames} frames; recorder ${row.recorderMs} ms)  minor GC ${row.minorGC.count} in ${row.seconds} s, ${row.minorGC.totalMs} ms, longest ${row.minorGC.longestMs}  major GC ${row.majorGC.count}, ${row.majorGC.totalMs} ms`,
        );
        await context.close();
      }
    } finally {
      await browser.close();
    }
  });
}

/**
 * The before/after tables from a directory of results: node scripts/bench.ts report --out <dir>.
 * The first build given is the original, the second the final. Numbers are the median over runs
 * of each run's value; for uncapped frame time the median of the per-run (paired) changes is
 * printed under each table.
 */
async function report(a: Args) {
  const newest = (prefix: string) => {
    // The newest unlabelled file: `<suite>-<ISO time>.json`.
    const f = readdirSync(a.out).filter((x) => x.endsWith('.json') && /^\d{4}-/.test(x.slice(prefix.length + 1)) && x.startsWith(`${prefix}-`)).sort().at(-1);
    return f ? JSON.parse(readFileSync(path.join(a.out, f), 'utf8')) : null;
  };
  // Over runs: the middle value, or the mean of the middle two (two or four runs are common).
  const med = (v: number[]) => {
    const s = [...v].sort((x, y) => x - y);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  const lines: string[] = [];
  const fmt = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');
  const row = (metric: string, o: number, n: number, d = 2, spread = '') => {
    const abs = n - o;
    const pct = o !== 0 ? `${abs >= 0 ? '+' : ''}${((100 * abs) / o).toFixed(1)}%` : 'n/a';
    lines.push(`| ${metric} | ${fmt(o, d)} | ${fmt(n, d)} | ${abs >= 0 ? '+' : ''}${fmt(abs, d)} | ${pct} |${spread ? ` ${spread} |` : ''}`);
  };
  const head = (title: string, extra = '') => {
    lines.push('', `### ${title}`, '', `| Metric | Original | Final | Absolute change | Percentage change |${extra ? ` ${extra} |` : ''}`, `|---|---:|---:|---:|---:|${extra ? '---|' : ''}`);
  };
  // Original and final: the order the builds were given in. Files from before that was recorded:
  // the order within an even-numbered run (odd runs go the other way round).
  const pair = (file: any): string[] => {
    if (file.builds?.length) return file.builds;
    const even = file.results.filter((r: any) => r.run % 2 === 0);
    return [...new Set((even.length ? even : file.results).map((r: any) => r.build))] as string[];
  };
  // Anything that would make the comparison unfair goes at the top of the report.
  const problems: string[] = [];
  const check = (suite: string, results: any[]) => {
    for (const r of results) if (r.errors?.length) problems.push(`${suite}: ${r.build} ${r.scenario ?? r.mode ?? ''} run ${r.run}: ${r.errors.length} page errors, first: ${String(r.errors[0]).slice(0, 200)}`);
    const sizes = new Map<string, Set<string>>();
    for (const r of results) {
      const c = r.state?.canvas;
      if (!c || !r.scenario) continue;
      const key = `${c.width}x${c.height}@${c.pixelRatio} scale ${r.state.resolutionScale}`;
      (sizes.get(r.scenario) ?? sizes.set(r.scenario, new Set()).get(r.scenario)!).add(key);
    }
    for (const [sc, set] of sizes) if (set.size > 1) problems.push(`${suite}: ${sc} was not rendered at one size: ${[...set].join(' / ')}`);
  };

  for (const mode of ['capped', 'uncapped'] as const) {
    const t = newest(`timing-${mode}`);
    if (!t) continue;
    check(`timing ${mode}`, t.results);
    const [o, n] = pair(t);
    const scenarios = [...new Set(t.results.map((r: any) => r.scenario))] as string[];
    const runs = Math.max(...t.results.map((r: any) => r.run)) + 1;
    lines.push('', `## Frame pacing, ${mode === 'capped' ? '60 Hz cap' : 'no frame cap'} (${runs} runs per build, ${t.env.browser}, ${t.env.viewport})`);
    const metrics: Array<[string, (r: any) => number, number]> =
      mode === 'capped'
        ? [
            ['average FPS', (r) => r.stats.fps, 1],
            ['frame time, median (ms)', (r) => r.stats.frameMs.p50, 2],
            ['frame time, p95 (ms)', (r) => r.stats.frameMs.p95, 2],
            ['frame time, p99 (ms)', (r) => r.stats.frameMs.p99, 2],
            ['frames over the 16.7 ms budget (%)', (r) => r.stats.overBudgetPct, 2],
            ['hitches over 41.7 ms (per minute)', (r) => r.stats.hitchesPerMin, 2],
            ['time inside animation callbacks per frame, wall clock (ms)', (r) => r.stats.cpuMs.avg, 2],
          ]
        : [
            ['average FPS', (r) => r.stats.fps, 1],
            ['frame time, average (ms)', (r) => r.stats.frameMs.avg, 2],
            ['frame time, median (ms)', (r) => r.stats.frameMs.p50, 2],
            ['frame time, p95 (ms)', (r) => r.stats.frameMs.p95, 2],
            ['frame time, p99 (ms)', (r) => r.stats.frameMs.p99, 2],
            ['frames over the 16.7 ms budget (%)', (r) => r.stats.overBudgetPct, 2],
            ['hitches over 41.7 ms (per minute)', (r) => r.stats.hitchesPerMin, 2],
          ];
    for (const sc of scenarios) {
      const of = t.results.filter((r: any) => r.scenario === sc && r.build === o);
      const nf = t.results.filter((r: any) => r.scenario === sc && r.build === n);
      head(sc, 'Runs: original / final (min–max)');
      for (const [name, f, d] of metrics) {
        const ov = of.map(f);
        const nv = nf.map(f);
        row(name, med(ov), med(nv), d, `${fmt(Math.min(...ov), d)}–${fmt(Math.max(...ov), d)} / ${fmt(Math.min(...nv), d)}–${fmt(Math.max(...nv), d)}`);
      }
      const longest = (rows: any[]) => Math.max(...rows.map((r: any) => r.stats.frameMs.max));
      row('longest frame in any run (ms)', longest(of), longest(nf), 1, '');
      if (mode === 'uncapped') {
        const paired = nf.map((r: any) => {
          const b = of.find((x: any) => x.run === r.run);
          return b ? (100 * (r.stats.frameMs.avg - b.stats.frameMs.avg)) / b.stats.frameMs.avg : NaN;
        }).filter((v: number) => Number.isFinite(v));
        lines.push('', `Paired by run, average frame time changes by ${fmt(med(paired), 1)}% (runs: ${fmt(Math.min(...paired), 1)}% to ${fmt(Math.max(...paired), 1)}%).`);
      }
    }
  }

  const st = newest('startup');
  if (st) {
    check('startup', st.results);
    const [o, n] = pair(st);
    lines.push('', `## Startup (${st.query}; time from navigation start)`);
    for (const mode of ['warm', 'cold']) {
      const of = st.results.filter((r: any) => r.mode === mode && r.build === o);
      const nf = st.results.filter((r: any) => r.mode === mode && r.build === n);
      if (!of.length || !nf.length) continue;
      head(`${mode} start (${of.length} runs per build)`, 'Runs: original / final (min–max)');
      const step = (r: any, from: string, to: string) => {
        const at = (name: string) => r.steps.find(([, text]: [number, string]) => text.startsWith(name))?.[0];
        return at(to) - at(from);
      };
      const m: Array<[string, (r: any) => number]> = [
        ['usable scene: third frame (ms)', (r) => r.usableMs],
        ['first frame (ms)', (r) => r.firstFrameMs],
        ['120 frames (ms)', (r) => r.frame120Ms],
        ['light probes all baked (ms)', (r) => r.probesBakedMs],
        ['generating the world (ms)', (r) => step(r, 'Generating', 'Compiling')],
        ['compiling shaders (ms)', (r) => step(r, 'Compiling', 'Warming')],
        ['first frames behind the loader (ms)', (r) => step(r, 'Warming', 'Ready')],
        ['main-thread blocking until usable: long tasks over 50 ms, summed excess (ms)', (r) => r.blockingMs],
        ['longest main-thread task until usable (ms)', (r) => r.longestTaskMs],
        ...(mode === 'cold' ? ([['fragment shaders made new to the driver’s cache', (r: any) => r.perturbed]] as Array<[string, (r: any) => number]>) : []),
      ];
      for (const [name, f] of m) {
        const ov = of.map(f);
        const nv = nf.map(f);
        row(name, med(ov), med(nv), 0, `${fmt(Math.min(...ov), 0)}–${fmt(Math.max(...ov), 0)} / ${fmt(Math.min(...nv), 0)}–${fmt(Math.max(...nv), 0)}`);
      }
    }
  }

  for (const mode of ['capped', 'uncapped']) {
    const rg = newest(`regen-${mode}`);
    if (!rg) continue;
    check(`regen ${mode}`, rg.results);
    const [o, n] = pair(rg);
    const runsOf = (b: string) => rg.results.filter((r: any) => r.build === b).map((r: any) => r.steps);
    const os = runsOf(o).flat();
    const ns = runsOf(n).flat();
    lines.push('', `## Regeneration, ${mode === 'capped' ? '60 Hz cap' : 'no frame cap'} (time and weather jumps; ${os.length} per build)`);
    head('per jump: the sky’s environment map, the ocean’s spectrum and a full re-bake of the light probes');
    const m: Array<[string, (s: any) => number, number]> = [
      ['regeneration complete after (ms)', (s) => s.regenerationMs, 0],
      ['bake() calls', (s) => s.bakeCalls, 0],
      ['main-thread time in bake(), total (ms)', (s) => s.bakeCpuMs, 1],
      ['main-thread time in bake(), longest call (ms)', (s) => s.bakeCpuMaxMs, 1],
      ['frame time meanwhile, median (ms)', (s) => s.during.p50, 2],
      ['frame time meanwhile, median, above the median of the rest of the window (ms)', (s) => s.during.p50 - s.window.frameMs.p50, 2],
      ['frame time meanwhile, p95 (ms)', (s) => s.during.p95, 2],
      ['frame time meanwhile, longest (ms)', (s) => s.during.max, 2],
      ['frames over budget meanwhile', (s) => s.during.overBudget, 1],
      ['draw calls in the busiest frame', (s) => s.maxDrawsInFrame, 0],
    ];
    for (const [name, f, d] of m) row(name, med(os.map(f)), med(ns.map(f)), d);
    head('memory over the jumps (growth from the first to the last)');
    // Per run, then the median over runs.
    const end = (b: string, f: (s: any) => number) => med(runsOf(b).map((ss: any[]) => f(ss.at(-1))));
    const growth = (b: string, f: (s: any) => number) => med(runsOf(b).map((ss: any[]) => f(ss.at(-1)) - f(ss[0])));
    const mm: Array<[string, (s: any) => number, number]> = [
      ['JS heap after GC (MB)', (s) => s.memory.heap.usedMB, 2],
      ['GPU buffers alive (MB, measured sizes)', (s) => s.memory.state.gpu.total.liveBufferBytes / 1048576, 2],
      ['GPU textures alive (MB, estimate from format and size)', (s) => s.memory.state.gpu.total.liveTextureBytes / 1048576, 1],
      ['textures (three’s count)', (s) => s.memory.state.three.textures, 0],
      ['geometries (three’s count)', (s) => s.memory.state.three.geometries, 0],
      ['pipelines (three’s count)', (s) => s.memory.state.three.pipelines, 0],
    ];
    for (const [name, f, d] of mm) {
      row(`${name}, at the end`, end(o, f), end(n, f), d);
      row(`${name}, growth`, growth(o, f), growth(n, f), d);
    }
  }

  const ct = newest('count');
  if (ct) {
    check('count', ct.results);
    const [o, n] = pair(ct);
    lines.push('', '## Work per frame and resources (WebGPU calls counted in the page; medians over the frames of the window)');
    for (const sc of [...new Set(ct.results.map((r: any) => r.scenario))] as string[]) {
      const of = ct.results.find((r: any) => r.scenario === sc && r.build === o);
      const nf = ct.results.find((r: any) => r.scenario === sc && r.build === n);
      if (!of || !nf) continue;
      head(sc);
      const m: Array<[string, (r: any) => number, number]> = [
        ['draw calls per frame, all passes', (r) => r.summary.median.draws, 0],
        ['triangles per frame, all passes', (r) => r.summary.median.triangles, 0],
        ['render passes per frame', (r) => r.summary.median.renderPasses, 0],
        ['compute passes per frame', (r) => r.summary.median.computePasses, 0],
        ['compute dispatches per frame', (r) => r.summary.median.dispatches, 0],
        ['command buffers submitted per frame', (r) => r.summary.median.submits, 0],
        ['buffer uploads per frame (calls)', (r) => r.summary.median.writeBufferCalls, 0],
        ['buffer uploads per frame (KB)', (r) => r.summary.mean.writeBufferBytes / 1024, 1],
        ['texture uploads per frame (KB)', (r) => r.summary.mean.writeTextureBytes / 1024, 1],
        ['GPU buffers created per frame', (r) => r.summary.mean.newBuffers, 2],
        ['render pipelines created (GPU)', (r) => r.state.gpu.total.renderPipelines, 0],
        ['compute pipelines created (GPU)', (r) => r.state.gpu.total.computePipelines, 0],
        ['shader modules created (GPU)', (r) => r.state.gpu.total.shaderModules, 0],
        ['shader programs (three: vertex + fragment + compute)', (r) => r.state.three.vertexPrograms + r.state.three.fragmentPrograms + r.state.three.computePrograms, 0],
        ['geometries (three’s count)', (r) => r.state.three.geometries, 0],
        ['textures (three’s count)', (r) => r.state.three.textures, 0],
        ['GPU textures alive (count)', (r) => r.state.gpu.total.liveTextures, 0],
        ['GPU textures alive (MB, estimate from format and size)', (r) => r.state.gpu.total.liveTextureBytes / 1048576, 1],
        ['GPU textures, peak (MB, estimate)', (r) => r.state.gpu.total.peakTextureBytes / 1048576, 1],
        ['GPU buffers alive (MB, measured sizes)', (r) => r.state.gpu.total.liveBufferBytes / 1048576, 2],
        ['JS heap after GC (MB)', (r) => r.memory.heap.usedMB, 1],
        ['renderer process footprint (MB)', (r) => r.memory.processes?.renderer?.footprintMB ?? NaN, 0],
        ['renderer process footprint, peak (MB)', (r) => r.memory.processes?.renderer?.peakMB ?? NaN, 0],
        ['GPU process footprint (MB)', (r) => r.memory.processes?.gpu?.footprintMB ?? NaN, 0],
        // One browser per build for all scenarios, so this is the high-water mark of the scenarios so far.
        ['GPU process footprint, peak since the browser started (MB)', (r) => r.memory.processes?.gpu?.peakMB ?? NaN, 0],
      ];
      for (const [name, f, d] of m) row(name, f(of), f(nf), d);
    }
  }

  // `count --runs N --label mem`: the memory rows again, with their spread over runs.
  const cm = newest('count-mem');
  if (cm) {
    check('count (memory)', cm.results);
    const [o, n] = pair(cm);
    const runs = Math.max(...cm.results.map((r: any) => r.run)) + 1;
    lines.push('', `## Memory, repeated (${runs} runs per build, the builds taking turns to go first)`);
    for (const sc of [...new Set(cm.results.map((r: any) => r.scenario))] as string[]) {
      const of = cm.results.filter((r: any) => r.scenario === sc && r.build === o);
      const nf = cm.results.filter((r: any) => r.scenario === sc && r.build === n);
      if (!of.length || !nf.length) continue;
      head(sc, 'Runs: original / final (min–max)');
      const m: Array<[string, (r: any) => number, number]> = [
        ['JS heap after GC (MB)', (r) => r.memory.heap.usedMB, 1],
        ['renderer process footprint (MB)', (r) => r.memory.processes?.renderer?.footprintMB ?? NaN, 0],
        ['renderer process footprint, peak (MB)', (r) => r.memory.processes?.renderer?.peakMB ?? NaN, 0],
        ['GPU process footprint (MB)', (r) => r.memory.processes?.gpu?.footprintMB ?? NaN, 0],
        ['GPU textures alive (MB, estimate from format and size)', (r) => r.state.gpu.total.liveTextureBytes / 1048576, 1],
        ['GPU buffers alive (MB, measured sizes)', (r) => r.state.gpu.total.liveBufferBytes / 1048576, 2],
      ];
      for (const [name, f, d] of m) {
        const ov = of.map(f);
        const nv = nf.map(f);
        row(name, med(ov), med(nv), d, `${fmt(Math.min(...ov), d)}–${fmt(Math.max(...ov), d)} / ${fmt(Math.min(...nv), d)}–${fmt(Math.max(...nv), d)}`);
      }
    }
  }

  const al = newest('alloc');
  if (al) {
    const [o, n] = pair(al);
    lines.push('', '## JavaScript allocated per frame (V8 sampling heap profiler)');
    head('allocation');
    for (const sc of [...new Set(al.results.map((r: any) => r.scenario))] as string[]) {
      const f = (b: string) => med(al.results.filter((r: any) => r.scenario === sc && r.build === b).map((r: any) => r.bytesPerFrame / 1024));
      row(`${sc}: allocated per frame (KB)`, f(o), f(n), 1);
    }
  }

  const cp = newest('cpu');
  if (cp) {
    const [o, n] = pair(cp);
    lines.push('', '## Self time of JavaScript and WebGPU calls per frame (V8 sampling CPU profiler, 60 Hz cap; native time the profiler cannot attribute is left out)');
    head('self time');
    for (const sc of [...new Set(cp.results.map((r: any) => r.scenario))] as string[]) {
      const f = (b: string) => med(cp.results.filter((r: any) => r.scenario === sc && r.build === b).map((r: any) => r.usPerFrame / 1000));
      row(`${sc}: self time per frame (ms)`, f(o), f(n), 2);
    }
  }

  for (const mode of ['capped-busy', 'capped', 'uncapped']) {
    const th = newest(`thread-${mode}`);
    if (!th) continue;
    check(`thread ${mode}`, th.results);
    const [o, n] = pair(th);
    const runs = Math.max(...th.results.map((r: any) => r.run)) + 1;
    const title = mode === 'capped-busy' ? `60 Hz cap, ${th.busy ?? 'some'} other cores kept busy` : mode === 'capped' ? '60 Hz cap, machine otherwise idle' : 'no frame cap';
    lines.push('', `## Main thread inside the animation callbacks, ${title} (Chrome trace, ${runs} runs per build)`);
    // Without the cap the callbacks wait for the GPU process, at times polling: neither clock measures the work.
    if (mode === 'uncapped') lines.push('', 'Garbage collections only: without the cap the callbacks wait for the GPU process, sometimes polling, so neither their wall time nor their CPU time measures the work.');
    for (const sc of [...new Set(th.results.map((r: any) => r.scenario))] as string[]) {
      const of = th.results.filter((r: any) => r.scenario === sc && r.build === o);
      const nf = th.results.filter((r: any) => r.scenario === sc && r.build === n);
      if (!of.length || !nf.length) continue;
      head(sc, 'Runs: original / final (min–max)');
      const m: Array<[string, (r: any) => number, number]> = [
        ['CPU time per frame: the thread’s own clock (ms)', (r) => r.cpuMs ?? NaN, 2],
        ['wall time per frame (ms)', (r) => r.wallMs, 2],
        ['minor garbage collections per minute', (r) => (60 * r.minorGC.count) / r.seconds, 1],
        ['minor GC pause, total (ms per second)', (r) => r.minorGC.totalMs / r.seconds, 2],
        ['minor GC pause, longest (ms)', (r) => r.minorGC.longestMs, 2],
        ['major garbage collections per minute', (r) => (60 * r.majorGC.count) / r.seconds, 1],
        ['major GC pause on the main thread, longest (ms)', (r) => r.majorGC.longestMs, 2],
      ];
      for (const [name, f, d] of mode === 'uncapped' ? m.slice(2) : m) {
        const ov = of.map(f);
        const nv = nf.map(f);
        row(name, med(ov), med(nv), d, `${fmt(Math.min(...ov), d)}–${fmt(Math.max(...ov), d)} / ${fmt(Math.min(...nv), d)}–${fmt(Math.max(...nv), d)}`);
      }
    }
  }

  const rl = newest('reload');
  if (rl) {
    const [o, n] = pair(rl);
    lines.push('', '## Tearing the page down and building the world again (reloads in one tab)');
    head('memory after the first and the last load');
    const get = (b: string) => rl.results.filter((r: any) => r.build === b).map((r: any) => r.rows);
    const m: Array<[string, (row: any) => number]> = [
      ['JS heap after GC (MB)', (x) => x.heap.usedMB],
      ['renderer process footprint (MB)', (x) => x.processes?.renderer?.footprintMB ?? NaN],
      ['GPU process footprint (MB)', (x) => x.processes?.gpu?.footprintMB ?? NaN],
    ];
    for (const [name, f] of m) {
      row(`${name}, first load`, med(get(o).map((rows: any[]) => f(rows[0]))), med(get(n).map((rows: any[]) => f(rows[0]))), 1);
      row(`${name}, last load`, med(get(o).map((rows: any[]) => f(rows.at(-1)))), med(get(n).map((rows: any[]) => f(rows.at(-1)))), 1);
      row(`${name}, growth`, med(get(o).map((rows: any[]) => f(rows.at(-1)) - f(rows[0]))), med(get(n).map((rows: any[]) => f(rows.at(-1)) - f(rows[0]))), 1);
    }
  }

  if (problems.length) lines.unshift('## PROBLEMS', '', ...problems.map((p) => `- ${p}`), '');
  const text = lines.join('\n').trimStart();
  writeFileSync(path.join(a.out, 'report.md'), `${text}\n`);
  console.log(text);
  if (problems.length) {
    console.error(`\n${problems.length} problem(s): see the top of the report.`);
    process.exitCode = 1;
  }
}

const args = parseArgs();
const suites: Record<string, (a: Args) => Promise<void>> = { timing, startup, count, attrib, passes, regen, reload, shots, diff, ablate, alloc, cpu, thread, report, summary: async (a) => summarize(a.rest[0]) };
if (!suites[args.suite] || (!args.builds.length && !['diff', 'summary', 'report'].includes(args.suite))) {
  console.error(`usage: node scripts/bench.ts <${Object.keys(suites).join('|')}> --build label=dir [--build label=dir] [--runs N] [--uncapped] [--only ids] [--seconds N] [--out dir] [--label x] [--busy N]`);
  process.exit(1);
}
await suites[args.suite](args);
