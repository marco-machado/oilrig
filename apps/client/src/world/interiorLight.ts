import { type Object3D, type Scene, Vector3, type WebGPURenderer } from 'three/webgpu';
import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js';
import { DIMS } from '@ocean-home/shared';

const PER_FRAME = 15;
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

  update(sunDir: Vector3, cloudCover: number) {
    const now = performance.now();
    if (this.cursor < 0) {
      const moved = this.lastSun.angleTo(sunDir) > 0.05 || Math.abs(this.lastCloud - cloudCover) > 0.1;
      if (!moved || now - this.lastBake < MIN_INTERVAL_MS) return;
      this.lastSun.copy(sunDir);
      this.lastCloud = cloudCover;
      this.lastBake = now;
      this.cursor = 0;
    }
    const visibility = this.hidden.map((o) => o.visible);
    for (const o of this.hidden) o.visible = false;
    try {
      this.grid.bake(this.renderer, this.scene, {
        start: this.cursor,
        count: Math.min(PER_FRAME, this.total - this.cursor),
        cubemapSize: 16,
        near: 0.05,
        far: 80,
      });
    } finally {
      this.hidden.forEach((o, i) => (o.visible = visibility[i]));
    }
    this.cursor += PER_FRAME;
    if (this.cursor >= this.total) this.cursor = -1;
  }
}
