import { NavMeshQuery, type NavMesh, type Obstacle, type TileCache, init as initRecast } from '@recast-navigation/core';
import { generateTileCache } from '@recast-navigation/generators';
import { PLAYER, type StaticWorld, type Vec3, droneBodyBoxes, staticTriangles } from '@ocean-home/shared';

// Navigation mesh for AI agents, generated from the same colliders the character
// controller collides with. Doorways are left open (agents open doors as they reach
// them), the parked drone is a dynamic obstacle, and the elevator is left out (agents take
// the stairs).

const CS = 0.1;
const CH = 0.05;
export const AGENT_RADIUS = 0.4;
const BOUNDS: [Vec3, Vec3] = [
  [-36, 0.5, -26],
  [60, 26, 30],
];

export interface PathResult {
  /** Corner points, starting at the start position. */
  points: Vec3[];
  /** The path ends where asked (false: it ends at the closest reachable point). */
  complete: boolean;
  length: number;
}

export type RecastImpl = Parameters<typeof initRecast>[0];

let recastReady: Promise<void> | null = null;

export class NavigationMesh {
  readonly navMesh: NavMesh;
  readonly query: NavMeshQuery;
  private readonly tileCache: TileCache;
  private drone: Obstacle[] = [];

  private constructor(navMesh: NavMesh, tileCache: TileCache) {
    this.navMesh = navMesh;
    this.tileCache = tileCache;
    this.query = new NavMeshQuery(navMesh);
  }

  /** `impl`: the Recast WASM module factory (Workers pass a precompiled one; default: the inline build). */
  static async build(sw: StaticWorld, impl?: RecastImpl): Promise<NavigationMesh> {
    recastReady ??= initRecast(impl);
    await recastReady;
    const soup = staticTriangles(sw, (info) => !info.doorId && info.kind !== 'drone' && info.kind !== 'elevator-car');
    const result = generateTileCache(soup.positions, soup.indices, {
      bounds: [BOUNDS[0] as [number, number, number], BOUNDS[1] as [number, number, number]],
      cs: CS,
      ch: CH,
      tileSize: 48,
      expectedLayersPerTile: 8,
      maxObstacles: 32,
      walkableSlopeAngle: 46,
      walkableHeight: Math.ceil(PLAYER.height / CH),
      walkableClimb: Math.floor(0.16 / CH),
      walkableRadius: Math.ceil(AGENT_RADIUS / CS),
      maxSimplificationError: 1.1,
      detailSampleDist: 6,
      detailSampleMaxError: 1,
    });
    if (!result.success) throw new Error(`navmesh generation failed: ${result.error}`);
    const nm = new NavigationMesh(result.navMesh, result.tileCache);
    nm.flush();
    return nm;
  }

  private flush() {
    for (let i = 0; i < 64; i++) if (this.tileCache.update(this.navMesh).upToDate) break;
  }

  /** Blocks (or frees) the area taken by the parked drone. */
  setDrone(stand: { position: Vec3; yaw: number } | null) {
    for (const o of this.drone) this.tileCache.removeObstacle(o);
    this.drone = [];
    if (stand !== null) {
      // Only the cabin: the rotor ducts are overhead, and people walk under them.
      for (const box of droneBodyBoxes(stand.position, stand.yaw).slice(0, 1)) {
        const r = this.tileCache.addBoxObstacle(
          { x: box.center[0], y: box.center[1] - box.half[1] - 0.2, z: box.center[2] },
          { x: box.half[0] + 0.1, y: box.half[1] + 0.4, z: box.half[2] + 0.1 },
          box.yaw,
        );
        if (r.success) this.drone.push(r.obstacle);
      }
    }
    this.flush();
  }

  /** Closest point on the navmesh, searching ±horizontal metres sideways and ±vertical up/down. */
  snap(p: Vec3, horizontal = 2, vertical = 1.5): Vec3 | null {
    const r = this.query.findClosestPoint({ x: p[0], y: p[1], z: p[2] }, { halfExtents: { x: horizontal, y: vertical, z: horizontal } });
    if (!r.success || !r.polyRef) return null;
    return [r.point.x, r.point.y, r.point.z];
  }

  path(from: Vec3, to: Vec3): PathResult | null {
    const start = this.snap(from, 1.5, 1.2);
    const end = this.snap(to, 6, 1.5);
    if (!start || !end) return null;
    const r = this.query.computePath(
      { x: start[0], y: start[1], z: start[2] },
      { x: end[0], y: end[1], z: end[2] },
      { halfExtents: { x: 0.5, y: 1, z: 0.5 }, maxPathPolys: 1024, maxStraightPathPoints: 512 },
    );
    if (!r.success || r.path.length === 0) return null;
    const points: Vec3[] = r.path.map((v) => [v.x, v.y, v.z]);
    const last = points[points.length - 1];
    const complete = Math.hypot(last[0] - to[0], last[2] - to[2]) < 0.75 && Math.abs(last[1] - to[1]) < 1;
    let length = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      length += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    }
    return { points, complete, length };
  }
}
