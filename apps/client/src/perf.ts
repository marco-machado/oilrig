import type { Light, Scene, WebGPURenderer } from 'three/webgpu';
import { readStored } from './storage.ts';

// Frame profiler. CPU time is measured per named section of the main loop with
// performance.now(); GPU time (longest pass per frame, a lower bound) comes from WebGPU
// timestamp queries (when the renderer was created with trackTimestamp); draw calls, triangles and resource counts from renderer.info.
// Everything is averaged over a rolling window so the overlay and tests read stable numbers.

const WINDOW = 240; // frames kept for percentiles and the graph

export interface PerfReport {
  fps: number;
  frameMs: { avg: number; p50: number; p95: number; p99: number; max: number };
  /** Frames over 33 ms in the window. */
  longFrames: number;
  cpuMs: number;
  /** Average CPU ms per section, largest first. */
  sections: Array<{ name: string; ms: number }>;
  /** Longest single GPU pass per frame (median over the last resolved batch): a lower bound, not a total. */
  gpu: { renderMs: number | null; computeMs: number | null; enabled: boolean };
  renderer: { drawCalls: number; triangles: number; points: number; lines: number; computeCalls: number; geometries: number; textures: number };
  heapMB: number | null;
  canvas: { width: number; height: number; pixelRatio: number };
  quality: string;
  /** Dynamic resolution: fraction of the preset's pixel ratio being rendered. */
  resolutionScale: number;
  frames: number;
  /** The last few frame gaps over HITCH_MS, newest last (the rolling window forgets them in seconds). */
  hitches: Hitch[];
}

/** A frame gap long enough to see as a freeze, with what the frame before it did. */
export interface Hitch {
  /** performance.now() when the gap ended (ms). */
  at: number;
  gapMs: number;
  /** CPU ms of the frame before the gap, by section, largest first. */
  sections: Array<{ name: string; ms: number }>;
  cpuMs: number;
  /** Render/compute pipelines three created in that frame (new shaders compile synchronously). */
  newPipelines: number;
  /** Material shaders three built (node graph to WGSL) in that frame, and the time they took. */
  nodeBuilds: number;
  nodeBuildMs: number;
  /** How many of those builds were for render objects three had built before (their cache key changed). */
  rebuilds: number;
  /** What else happened in that frame: a probe bake, a change in the set of visible lights. */
  notes: string[];
}

const HITCH_MS = 100;
const HITCHES_KEPT = 10;

export class Profiler {
  private readonly frameTimes = new Float32Array(WINDOW);
  private readonly cpuTimes = new Float32Array(WINDOW);
  private head = 0;
  private count = 0;
  private frameStart = 0;
  private lastFrameStart = 0;
  private readonly open = new Map<string, number>();
  private readonly acc = new Map<string, number>();
  private readonly avg = new Map<string, number>();
  private accFrames = 0;
  private gpuRender: number | null = null;
  private gpuCompute: number | null = null;
  private resolving = false;
  private renderer: WebGPURenderer | null = null;
  private quality = '';
  readonly gpuEnabled: boolean;
  frames = 0;
  resolutionScale = 1;
  /** renderer.info as it stood at the end of the last frame (three resets it when a frame starts). */
  private info = { drawCalls: 0, triangles: 0, points: 0, lines: 0, computeCalls: 0 };
  /** This frame's section times, kept until the next frame starts so a hitch can report them. */
  private readonly frameSections = new Map<string, number>();
  private lastCpu = 0;
  private pipelines = 0;
  private lastNewPipelines = 0;
  private readonly hitches: Hitch[] = [];
  private readonly frameNotes = new Set<string>();
  private scene: Scene | null = null;
  /** Ids of the scene's visible lights at the end of the last frame. */
  private lightIds: number[] | null = null;
  private builds = 0;
  private buildMs = 0;
  private lastBuilds = 0;
  private lastBuildMs = 0;
  private lastRebuilds = 0;
  /** Light-set cache keys three has built shaders for; a build with a new one means a new light set. */
  private readonly lightKeys = new Set<number>();
  private lastLightSet: Map<number, string> | null = null;
  /** Cache-key parts of the last build per mesh, keyed by material and render context. */
  private readonly keyParts = new WeakMap<object, Map<string, KeyParts>>();
  private rebuiltObjects = 0;
  /** This frame's rebuilds by which cache-key parts changed, e.g. "lights" → 23. */
  private readonly rebuildReasons = new Map<string, number>();
  private lastCompute: object | null = null;

  constructor(gpuEnabled: boolean) {
    this.gpuEnabled = gpuEnabled;
  }

  attach(renderer: WebGPURenderer, quality: string) {
    this.renderer = renderer;
    this.quality = quality;
    // A hidden tab gets no frames: a gap with this note is the browser pausing, not a stall.
    document.addEventListener('visibilitychange', () => this.note(`tab ${document.visibilityState}`));
    window.addEventListener('blur', () => this.note('window lost focus'));
    // Count shader builds: three rebuilds a material's node graph whenever its cache key
    // (light set, environment, fog...) changes, even when the resulting pipeline is cached.
    renderer.debug.onNodeBuilderCreated = (nodeBuilder, renderObject) => {
      // Why this build: a render object three has never built for, or an old one whose
      // cache key changed (light set / clustered-lighting compute / environment).
      const ro = renderObject as unknown as KeyedRenderObject;
      const builder = nodeBuilder as unknown as {
        build(): unknown;
        lightsNode?: { getCacheKey(force?: boolean): number; getLights(): Light[] } | null;
      };
      const build = builder.build.bind(builder);
      builder.build = () => {
        const t0 = performance.now();
        try {
          return build();
        } finally {
          this.builds++;
          this.buildMs += performance.now() - t0;
          this.trackRebuild(ro);
          // Compare the compute object itself (three recreates it when the cluster grid is
          // resized); reading its cache key here, mid-build, corrupts the shader being built.
          const compute = (builder.lightsNode as { _compute?: object | null } | null | undefined)?._compute ?? null;
          if (compute && compute !== this.lastCompute) {
            if (this.lastCompute) this.note('clustered-lighting compute recreated');
            this.lastCompute = compute;
          }
          const key = builder.lightsNode?.getCacheKey(true);
          if (key !== undefined && !this.lightKeys.has(key)) {
            const set = lightSet(builder.lightsNode!.getLights());
            if (this.lastLightSet) this.note(`new light set: ${diffLightSets(this.lastLightSet, set)}`);
            this.lightKeys.add(key);
            this.lastLightSet = set;
          }
        }
      };
    };
  }

  /**
   * When a render object's cache key changes three disposes it and builds a new one, so a
   * rebuild shows up as a new render object for the same mesh, material and render context.
   * Tallies which part of the key changed.
   */
  private trackRebuild(ro: KeyedRenderObject) {
    try {
      const parts: KeyParts = {
        material: ro.getMaterialCacheKey(),
        lights: ro.lightsNode?.getCacheKey(true) ?? 0,
        environment: ro._nodes.getEnvironmentNode(ro.scene)?.getCacheKey() ?? 0,
        fog: ro._nodes.getFogNode(ro.scene)?.getCacheKey() ?? 0,
        context: ro.renderer.contextNode.version,
      };
      let byMaterial = this.keyParts.get(ro.object);
      if (!byMaterial) this.keyParts.set(ro.object, (byMaterial = new Map()));
      const slot = `${ro.material.uuid}:${ro.renderContext.id}`;
      const prev = byMaterial.get(slot);
      byMaterial.set(slot, parts);
      if (!prev) return;
      this.rebuiltObjects++;
      const changed = (Object.keys(parts) as Array<keyof KeyParts>).filter((k) => parts[k] !== prev[k]);
      const why = changed.length ? changed.join('+') : 'same key';
      this.rebuildReasons.set(why, (this.rebuildReasons.get(why) ?? 0) + 1);
    } catch {
      // three internals changed shape; skip the diagnosis
    }
  }

  beginFrame() {
    const now = performance.now();
    if (this.lastFrameStart) {
      const gap = now - this.lastFrameStart;
      this.frameTimes[this.head] = gap;
      if (gap > HITCH_MS) this.recordHitch(now, gap);
    }
    this.frameSections.clear();
    this.frameNotes.clear();
    this.lastFrameStart = now;
    this.frameStart = now;
  }

  private recordHitch(at: number, gapMs: number) {
    const round = (v: number) => Math.round(v * 10) / 10;
    const hitch: Hitch = {
      at: Math.round(at),
      gapMs: round(gapMs),
      sections: [...this.frameSections].map(([name, ms]) => ({ name, ms: round(ms) })).sort((a, b) => b.ms - a.ms).slice(0, 5),
      cpuMs: round(this.lastCpu),
      newPipelines: this.lastNewPipelines,
      nodeBuilds: this.lastBuilds,
      nodeBuildMs: round(this.lastBuildMs),
      rebuilds: this.lastRebuilds,
      notes: [...this.frameNotes],
    };
    this.hitches.push(hitch);
    if (this.hitches.length > HITCHES_KEPT) this.hitches.shift();
    const notes = hitch.notes.length ? `, ${hitch.notes.join(', ')}` : '';
    const sections = hitch.sections.map((s) => `${s.name} ${s.ms}`).join(', ');
    // console.log, not warn: Chrome attaches a long stack trace to warnings, which buries the line.
    console.log(`[perf] ${hitch.gapMs} ms frame gap: CPU ${hitch.cpuMs} ms [${sections}], ${hitch.newPipelines} new pipelines, ${hitch.nodeBuilds} shader builds (${hitch.nodeBuildMs} ms, ${hitch.rebuilds} for existing objects)${notes}`);
  }

  /** Tags the current frame, so a hitch after it says what else happened. */
  note(tag: string) {
    this.frameNotes.add(tag);
  }

  /** Notes every frame whose set of visible lights differs from the frame before. */
  watchLights(scene: Scene) {
    this.scene = scene;
  }

  private checkLights() {
    if (!this.scene) return;
    const ids: number[] = [];
    this.scene.traverseVisible((o) => {
      if ((o as Light).isLight) ids.push(o.id);
    });
    const prev = this.lightIds;
    this.lightIds = ids;
    if (!prev || (prev.length === ids.length && prev.every((id, i) => id === ids[i]))) return;
    const added = ids.filter((id) => !prev.includes(id)).length;
    const removed = prev.filter((id) => !ids.includes(id)).length;
    this.note(`lights changed (+${added} −${removed}, ${ids.length} visible)`);
  }

  private add(name: string, ms: number) {
    this.acc.set(name, (this.acc.get(name) ?? 0) + ms);
    this.frameSections.set(name, (this.frameSections.get(name) ?? 0) + ms);
  }

  begin(name: string) {
    this.open.set(name, performance.now());
  }

  end(name: string) {
    const t0 = this.open.get(name);
    if (t0 === undefined) return;
    this.add(name, performance.now() - t0);
  }

  /** Times a function as one section. */
  time<T>(name: string, fn: () => T): T {
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      this.add(name, performance.now() - t0);
    }
  }

  endFrame() {
    const cpu = performance.now() - this.frameStart;
    const ri = this.renderer?.info;
    if (ri) {
      this.info.drawCalls = ri.render.drawCalls;
      this.info.triangles = ri.render.triangles;
      this.info.points = ri.render.points;
      this.info.lines = ri.render.lines;
      this.info.computeCalls = ri.compute.frameCalls;
    }
    this.checkLights();
    this.lastCpu = cpu;
    this.lastBuilds = this.builds;
    this.lastBuildMs = this.buildMs;
    this.builds = 0;
    this.buildMs = 0;
    this.lastRebuilds = this.rebuiltObjects;
    this.rebuiltObjects = 0;
    for (const [why, n] of this.rebuildReasons) this.note(`rebuilt for ${why} ×${n}`);
    this.rebuildReasons.clear();
    const pipelines = pipelineCount(this.renderer);
    this.lastNewPipelines = Math.max(0, pipelines - this.pipelines);
    this.pipelines = pipelines;
    this.cpuTimes[this.head] = cpu;
    this.head = (this.head + 1) % WINDOW;
    this.count = Math.min(this.count + 1, WINDOW);
    this.frames++;
    this.accFrames++;
    // Fold the section sums into averages about twice a second.
    if (this.accFrames >= 30) {
      for (const [k, v] of this.acc) this.avg.set(k, v / this.accFrames);
      this.acc.clear();
      this.accFrames = 0;
    }
    if (this.gpuEnabled && this.renderer && !this.resolving && this.frames % 10 === 0) {
      const r = this.renderer;
      this.resolving = true;
      // three's resolve returns the sum of a frame's pass durations, but on this hardware the
      // passes' begin→end intervals overlap (21 passes of ~7 ms each in a 15 ms frame), so the
      // sum overcounts many times. Read the per-pass timings it keeps instead.
      Promise.all([r.resolveTimestampsAsync('render'), r.resolveTimestampsAsync('compute')])
        .then(() => {
          this.gpuRender = longestPass(r, 'render') ?? this.gpuRender;
          this.gpuCompute = longestPass(r, 'compute') ?? this.gpuCompute;
        })
        .catch(() => undefined)
        .finally(() => {
          this.resolving = false;
        });
    }
  }

  /** Frame times of the window, oldest first (ms). */
  history(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.count; i++) out.push(this.frameTimes[(this.head - this.count + i + WINDOW) % WINDOW]);
    return out;
  }

  report(): PerfReport {
    const ft = this.history().filter((v) => v > 0);
    const sorted = [...ft].sort((a, b) => a - b);
    const q = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0);
    const avg = ft.length ? ft.reduce((a, b) => a + b, 0) / ft.length : 0;
    let cpu = 0;
    for (let i = 0; i < this.count; i++) cpu += this.cpuTimes[i];
    const info = this.renderer?.info;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const canvas = this.renderer?.domElement;
    const round = (v: number) => Math.round(v * 100) / 100;
    return {
      fps: avg ? round(1000 / avg) : 0,
      frameMs: { avg: round(avg), p50: round(q(0.5)), p95: round(q(0.95)), p99: round(q(0.99)), max: round(sorted.at(-1) ?? 0) },
      longFrames: ft.filter((v) => v > 33.4).length,
      cpuMs: round(this.count ? cpu / this.count : 0),
      sections: [...this.avg].map(([name, ms]) => ({ name, ms: round(ms) })).sort((a, b) => b.ms - a.ms),
      gpu: { renderMs: this.gpuRender === null ? null : round(this.gpuRender), computeMs: this.gpuCompute === null ? null : round(this.gpuCompute), enabled: this.gpuEnabled },
      renderer: {
        ...this.info,
        geometries: info?.memory.geometries ?? 0,
        textures: info?.memory.textures ?? 0,
      },
      heapMB: mem ? round(mem.usedJSHeapSize / 1048576) : null,
      canvas: { width: canvas?.width ?? 0, height: canvas?.height ?? 0, pixelRatio: round(this.renderer?.getPixelRatio() ?? 1) },
      quality: this.quality,
      resolutionScale: this.resolutionScale,
      frames: this.frames,
      hitches: [...this.hitches],
    };
  }
}

/**
 * Longest single pass of each frame in the last resolved timestamp batch, median over the
 * batch's frames (some frames in a batch are only partly captured). Reads three's
 * per-pass map, keyed `r:<call>:<context>:f<frame>` (or `c:` for compute).
 */
function longestPass(renderer: WebGPURenderer, type: 'render' | 'compute'): number | null {
  const pools = (renderer.backend as unknown as { timestampQueryPool?: Record<string, { timestamps: Map<string, number> } | undefined> }).timestampQueryPool;
  const timestamps = pools?.[type]?.timestamps;
  if (!timestamps || timestamps.size === 0) return null;
  const perFrame = new Map<string, number>();
  for (const [uid, ms] of timestamps) {
    const frame = uid.slice(uid.lastIndexOf(':f') + 2);
    perFrame.set(frame, Math.max(perFrame.get(frame) ?? 0, ms));
  }
  const maxima = [...perFrame.values()].sort((a, b) => a - b);
  return maxima[Math.floor(maxima.length / 2)];
}

/** Lights by id, described as `Type#id` plus `(shadow)` when it casts shadows: what three's light-set key hashes. */
function lightSet(lights: Light[]): Map<number, string> {
  return new Map(lights.map((l) => [l.id, `${l.name || l.type}#${l.id}${l.castShadow ? '(shadow)' : ''}`]));
}

function diffLightSets(a: Map<number, string>, b: Map<number, string>): string {
  const parts: string[] = [];
  for (const [id, d] of b) if (a.get(id) !== d) parts.push(`+${d}`);
  for (const [id, d] of a) if (b.get(id) !== d) parts.push(`−${d}`);
  return parts.join(' ') || 'same lights, other order';
}

/** Pipelines three has created so far (its cache only grows until objects are disposed). */
function pipelineCount(renderer: WebGPURenderer | null): number {
  const p = (renderer as unknown as { _pipelines?: { caches?: Map<string, unknown> } } | null)?._pipelines;
  return p?.caches?.size ?? 0;
}

const GPU_KEY = 'oilrig.gpuTiming';

/** GPU timing needs timestamp queries from the start; it is on with ?perf or when the overlay was left open. */
export function gpuTimingWanted(): boolean {
  if (new URLSearchParams(location.search).has('perf')) return true;
  try {
    return readStored(GPU_KEY) === '1';
  } catch {
    return false;
  }
}

export function setGpuTimingWanted(on: boolean) {
  try {
    if (on) localStorage.setItem(GPU_KEY, '1');
    else localStorage.removeItem(GPU_KEY);
  } catch {
    // storage unavailable
  }
}

interface KeyParts {
  material: string;
  lights: number;
  environment: number;
  fog: number;
  context: number;
}

/** The parts of three's RenderObject (internal) that make up its cache key. */
interface KeyedRenderObject {
  object: object;
  material: { uuid: string };
  scene: Scene;
  renderContext: { id: number };
  lightsNode: { getCacheKey(force?: boolean): number } | null;
  renderer: { contextNode: { version: number } };
  _nodes: {
    getEnvironmentNode(scene: Scene): { getCacheKey(): number } | null;
    getFogNode(scene: Scene): { getCacheKey(): number } | null;
  };
  getMaterialCacheKey(): string;
}
