import {
  ArrayCamera,
  HalfFloatType,
  NearestFilter,
  type Object3D,
  PerspectiveCamera,
  RenderTarget,
  type Scene,
  Vector3,
  Vector4,
  type WebGPURenderer,
} from 'three/webgpu';
import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js';
import { replaceSunLights, restoreSunLights } from 'three/addons/lighting/LightProbeGridUtils.js';
import { DIMS } from '@oilrig/shared';

// Each probe renders the scene six times (a cube map), all on the GPU: 15 a frame stalled
// the next frame about 100 ms. In the running game 4 a frame still made frames of 30–110 ms
// (1440p High); 1 keeps them near 11 ms (at most ~30 ms), and the whole grid takes 135 frames.
const PER_FRAME = 1;
const MIN_INTERVAL_MS = 20_000;
const BAKE = { cubemapSize: 16, near: 0.05, far: 80 };
/** three r187 captures 8 probes per render: 8 × 6 cube faces of one ArrayCamera. */
const PROBES_PER_CAPTURE = 8;

/** The parts of three's LightProbeGrid the precompile copies (private in r187). */
interface BakeInternals {
  _updateBounceGrid(renderer: WebGPURenderer, scene: Scene, pass: number, start: number): void;
  _bounceGrid: Object3D | null;
}

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
  private compileTarget: RenderTarget | null = null;

  constructor(renderer: WebGPURenderer, scene: Scene, hiddenDuringBake: Object3D[]) {
    this.renderer = renderer;
    this.scene = scene;
    this.hidden = hiddenDuringBake;
    const P = DIMS.PAVILION;
    // The whole room: since three r187 the grid lights only what is inside its box (there is
    // no falloff beyond it), and the probes sit half a cell in from the box's faces.
    const w = P.x1 - P.x0;
    const h = P.height;
    const d = P.z1 - P.z0;
    this.grid = new LightProbeGrid(w, h, d, 9, 3, 5);
    this.grid.position.set((P.x0 + P.x1) / 2, P.floor + P.height / 2, (P.z0 + P.z1) / 2);
    this.grid.updateBoundingBox();
    // Half of the 0.8 used up to r186: there the floor and ceiling lay 0.4 m outside the grid's
    // box, halfway through its 0.8 m falloff, so they got half the bounce light. Now they are
    // inside the box and get all of it.
    this.grid.intensity = 0.4;
    this.total = 9 * 3 * 5;
    scene.add(this.grid);
  }

  /**
   * Builds the bake's pipelines in the background, before the first bake. The bake lights the
   * scene differently (the sun swapped for a directional light, this grid hidden and an unlit
   * copy of it added for bounce light), so it needs pipelines of its own: built by the first
   * bake, one at a time, they froze a cold start for ~17 s. This copies three r187's capture
   * setup (see docs/startup-shader-compile.md); if three changes it, the bake compiles its own
   * pipelines again, slowly but correctly.
   */
  async compileAsync() {
    const size = BAKE.cubemapSize;
    this.compileTarget ??= new RenderTarget(6 * size, PROBES_PER_CAPTURE * size, {
      type: HalfFloatType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
    });
    const faces: PerspectiveCamera[] = [];
    for (let i = 0; i < PROBES_PER_CAPTURE * 6; i++) {
      const face = new PerspectiveCamera(90, 1, BAKE.near, BAKE.far);
      face.viewport = new Vector4((i % 6) * size, Math.floor(i / 6) * size, size, size);
      face.position.copy(this.grid.position);
      face.updateMatrixWorld();
      faces.push(face);
    }
    const grid = this.grid as unknown as BakeInternals;
    const visibility = this.hidden.map((o) => o.visible);
    for (const o of this.hidden) o.visible = false;
    const gridVisible = this.grid.visible;
    this.grid.visible = false;
    grid._updateBounceGrid(this.renderer, this.scene, 0, 0);
    const replaced = replaceSunLights(this.scene);
    const target = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.compileTarget);
    try {
      await this.renderer.compileAsync(this.scene, new ArrayCamera(faces));
    } finally {
      this.renderer.setRenderTarget(target);
      if (replaced) restoreSunLights(this.scene, replaced);
      grid._bounceGrid?.removeFromParent();
      this.grid.visible = gridVisible;
      this.hidden.forEach((o, i) => (o.visible = visibility[i]));
    }
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
      this.grid.bake(this.renderer, this.scene, { start, count, ...BAKE });
    } finally {
      this.hidden.forEach((o, i) => (o.visible = visibility[i]));
    }
    const bakeMs = performance.now() - t0;
    this.cursor += PER_FRAME;
    if (this.cursor >= this.total) this.cursor = -1;
    return `probe bake ${start}–${start + count} of ${this.total}, bake() ${bakeMs.toFixed(0)} ms`;
  }
}
