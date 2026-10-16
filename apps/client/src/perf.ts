import type { WebGPURenderer } from 'three/webgpu';

// Frame profiler. CPU time is measured per named section of the main loop with
// performance.now(); GPU time comes from WebGPU timestamp queries (when the renderer was
// created with trackTimestamp); draw calls, triangles and resource counts from renderer.info.
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
  gpu: { renderMs: number | null; computeMs: number | null; enabled: boolean };
  renderer: { drawCalls: number; triangles: number; points: number; lines: number; computeCalls: number; geometries: number; textures: number };
  heapMB: number | null;
  canvas: { width: number; height: number; pixelRatio: number };
  quality: string;
  /** Dynamic resolution: fraction of the preset's pixel ratio being rendered. */
  resolutionScale: number;
  frames: number;
}

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

  constructor(gpuEnabled: boolean) {
    this.gpuEnabled = gpuEnabled;
  }

  attach(renderer: WebGPURenderer, quality: string) {
    this.renderer = renderer;
    this.quality = quality;
  }

  beginFrame() {
    const now = performance.now();
    if (this.lastFrameStart) {
      this.frameTimes[this.head] = now - this.lastFrameStart;
    }
    this.lastFrameStart = now;
    this.frameStart = now;
  }

  begin(name: string) {
    this.open.set(name, performance.now());
  }

  end(name: string) {
    const t0 = this.open.get(name);
    if (t0 === undefined) return;
    this.acc.set(name, (this.acc.get(name) ?? 0) + performance.now() - t0);
  }

  /** Times a function as one section. */
  time<T>(name: string, fn: () => T): T {
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      this.acc.set(name, (this.acc.get(name) ?? 0) + performance.now() - t0);
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
      Promise.all([r.resolveTimestampsAsync('render'), r.resolveTimestampsAsync('compute')])
        .then(([render, compute]) => {
          if (typeof render === 'number') this.gpuRender = render;
          if (typeof compute === 'number') this.gpuCompute = compute;
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
    };
  }
}

const GPU_KEY = 'ocean-home.gpuTiming';

/** GPU timing needs timestamp queries from the start; it is on with ?perf or when the overlay was left open. */
export function gpuTimingWanted(): boolean {
  if (new URLSearchParams(location.search).has('perf')) return true;
  try {
    return localStorage.getItem(GPU_KEY) === '1';
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
