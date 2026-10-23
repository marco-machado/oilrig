import { type Object3D, type Scene, Vector3, type WebGPURenderer } from 'three/webgpu';
import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js';
import { LightProbeGridNode } from 'three/addons/tsl/lighting/LightProbeGridNode.js';
import { DIMS } from '@ocean-home/shared';

// Each probe renders the scene six times (a cube map), all on the GPU: 15 a frame stalled
// the next frame about 100 ms. In the running game 4 a frame still made frames of 30–110 ms
// (1440p High); 1 keeps them near 11 ms (at most ~30 ms), and the whole grid takes 135 frames.
const PER_FRAME = 1;
const MIN_INTERVAL_MS = 20_000;

/**
 * Bounce light inside the pavilion from a grid of irradiance probes. The grid is
 * re-baked a few probes per frame whenever the sun has moved or the sky changed, so
 * the cost is spread out and no single frame stalls.
 */
export class InteriorLight {
  private readonly grid: LightProbeGrid;
  private readonly renderer: WebGPURenderer;
  private readonly scene: Scene;
  private readonly hidden: Object3D[];
  private cursor = -1;
  private readonly total: number;
  private readonly lastSun = new Vector3(0, -1, 0);
  private lastCloud = -1;
  private lastBake = -Infinity;

  constructor(renderer: WebGPURenderer, scene: Scene, hiddenDuringBake: Object3D[]) {
    this.renderer = renderer;
    this.scene = scene;
    this.hidden = hiddenDuringBake;
    // bake() registers the grid's light node, but shaders are pre-compiled before the
    // first bake; without this they are built with no bounce light at all.
    if (renderer.library.getLightNodeClass(LightProbeGrid) === null) {
      renderer.library.addLight(LightProbeGridNode, LightProbeGrid);
    }
    const P = DIMS.PAVILION;
    const w = P.x1 - P.x0 - 1;
    const h = P.height - 0.8;
    const d = P.z1 - P.z0 - 1;
    this.grid = new LightProbeGrid(w, h, d, 9, 3, 5);
    this.grid.position.set((P.x0 + P.x1) / 2, P.floor + P.height / 2, (P.z0 + P.z1) / 2);
    this.grid.updateBoundingBox();
    this.grid.falloff = 0.8;
    this.grid.intensity = 0.8;
    this.total = 9 * 3 * 5;
    scene.add(this.grid);
  }

  /** Describes the probes baked this frame (range and time), or null when none were. */
  update(sunDir: Vector3, cloudCover: number): string | null {
    const now = performance.now();
    if (this.cursor < 0) {
      const moved = this.lastSun.angleTo(sunDir) > 0.05 || Math.abs(this.lastCloud - cloudCover) > 0.1;
      if (!moved || now - this.lastBake < MIN_INTERVAL_MS) return null;
      this.lastSun.copy(sunDir);
      this.lastCloud = cloudCover;
      this.lastBake = now;
      this.cursor = 0;
    }
    const start = this.cursor;
    const count = Math.min(PER_FRAME, this.total - start);
    const visibility = this.hidden.map((o) => o.visible);
    for (const o of this.hidden) o.visible = false;
    const t0 = performance.now();
    try {
      this.grid.bake(this.renderer, this.scene, { start, count, cubemapSize: 16, near: 0.05, far: 80 });
    } finally {
      this.hidden.forEach((o, i) => (o.visible = visibility[i]));
    }
    const bakeMs = performance.now() - t0;
    this.cursor += PER_FRAME;
    if (this.cursor >= this.total) this.cursor = -1;
    return `probe bake ${start}–${start + count} of ${this.total}, bake() ${bakeMs.toFixed(0)} ms`;
  }
}
