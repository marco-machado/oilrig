import type { Vec3 } from '@ocean-home/shared';
import type { World } from '../world/world.ts';
import { AGENT_DT, Agent, type TaskResult, yawOfHeading } from './agent.ts';
import { NavigationMesh, type RecastImpl } from './navmesh.ts';
import { type Perception, type PerceptionContext, Sight, perceivables, perceive } from './perception.ts';

export interface AgentLimits {
  perKey: number;
  total: number;
  /** Agents with no API activity for this long leave on their own. */
  idleMs: number;
}

export class AgentError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409 | 422 | 429;
  constructor(code: string, message: string, status: AgentError['status'] = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface AvatarStatus {
  id: string;
  name: string;
  position: Vec3;
  heading: number;
  task: string | null;
  lastResult: TaskResult | null;
  joinedAt: number;
}

/** Runs every AI agent: spawning, the fixed-rate simulation loop, idle clean-up. */
export class AgentManager {
  readonly world: World;
  readonly nav: NavigationMesh;
  private readonly agents = new Map<string, Agent>();
  private readonly limits: AgentLimits;
  private readonly ctx: PerceptionContext;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private acc = 0;

  private constructor(world: World, nav: NavigationMesh, limits: AgentLimits) {
    this.world = world;
    this.nav = nav;
    this.limits = limits;
    this.ctx = { world, sight: new Sight(world), objects: perceivables(world.layout) };
    world.on('chat', (e) => {
      for (const a of this.agents.values()) a.hear(e);
    });
    world.on('drone', (s) => {
      if (s.phase === 'landed') this.nav.setDrone({ position: s.from, yaw: s.padYaw });
      else this.nav.setDrone(null);
    });
    world.on('displaced', (p) => {
      const a = this.agents.get(p.info.id);
      if (a) a.teleport(p.pose.p);
    });
  }

  /** `recast`: the Recast WASM module factory (Workers pass a precompiled one). */
  static async create(world: World, limits: Partial<AgentLimits> = {}, recast?: RecastImpl) {
    const nav = await NavigationMesh.build(world.sw, recast);
    const s = world.drone.state;
    if (world.sw.droneParked) nav.setDrone({ position: s.from, yaw: s.padYaw });
    return new AgentManager(world, nav, { perKey: 3, total: 24, idleMs: 30 * 60_000, ...limits });
  }

  /** Runs the simulation loop. Safe to call twice. */
  start() {
    if (this.timer) return;
    this.last = performance.now();
    this.acc = 0;
    this.timer = setInterval(() => this.tick(), 1000 / 30);
  }

  /** Stops the loop; agents stay where they are. */
  pause() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Stops the loop and sends every agent away. */
  stop() {
    this.pause();
    for (const a of [...this.agents.values()]) this.remove(a);
  }

  /** Sends away every avatar a key brought aboard (the key was revoked). */
  removeForKey(keyId: string) {
    for (const a of this.forKey(keyId)) this.remove(a);
  }

  /** Advances the simulation by real elapsed time in fixed steps. */
  private tick() {
    const now = performance.now();
    this.acc += Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    while (this.acc >= AGENT_DT) {
      this.acc -= AGENT_DT;
      this.step(AGENT_DT);
    }
    const wall = Date.now();
    for (const a of [...this.agents.values()]) {
      if (wall - a.lastActivity > this.limits.idleMs) this.remove(a);
    }
  }

  step(dt: number) {
    for (const a of this.agents.values()) a.step(dt);
  }

  get count() {
    return this.agents.size;
  }

  forKey(keyId: string): Agent[] {
    return [...this.agents.values()].filter((a) => a.keyId === keyId).sort((a, b) => a.created - b.created);
  }

  spawn(keyId: string, name: string, placeId?: string): Agent {
    if (this.forKey(keyId).length >= this.limits.perKey) {
      throw new AgentError('too-many-avatars', `This key already has ${this.limits.perKey} avatars aboard. Make one leave first.`, 409);
    }
    if (this.agents.size >= this.limits.total) throw new AgentError('world-full', 'The platform is full of agents right now.', 409);
    const layout = this.world.layout;
    let at = layout.spawn.position;
    if (placeId) {
      const place = layout.places.find((p) => p.id === placeId);
      if (!place) throw new AgentError('unknown-place', `No place called "${placeId}". Use list_places.`, 404);
      at = place.position;
    }
    // Do not spawn inside someone: step aside along a small spiral if needed.
    const spot = this.freeSpot(at);
    const player = this.world.addAgent(name, spot, layout.spawn.yaw);
    const agent = new Agent(this.world, this.nav, player, keyId);
    this.agents.set(agent.id, agent);
    return agent;
  }

  private freeSpot(at: Vec3): Vec3 {
    const taken = this.world.online().map((p) => p.pose.p);
    for (let i = 0; i < 12; i++) {
      const a = i * 2.4;
      const r = i === 0 ? 0 : 0.8 + i * 0.25;
      const p: Vec3 = [at[0] + Math.cos(a) * r, at[1], at[2] + Math.sin(a) * r];
      const snapped = this.nav.snap(p, 0.6, 1);
      if (!snapped) continue;
      if (taken.every((q) => Math.hypot(q[0] - snapped[0], q[2] - snapped[2]) > 0.9)) return [snapped[0], at[1], snapped[2]];
    }
    return at;
  }

  /** The key's avatar by id, or its most recent one when no id is given. */
  get(keyId: string, id?: string): Agent {
    if (id) {
      const a = this.agents.get(id);
      if (!a || a.keyId !== keyId) throw new AgentError('unknown-avatar', `No avatar ${id} belongs to this key.`, 404);
      a.touch();
      return a;
    }
    const mine = this.forKey(keyId);
    const a = mine[mine.length - 1];
    if (!a) throw new AgentError('not-joined', 'You have no avatar aboard. Call join_world first.', 404);
    a.touch();
    return a;
  }

  remove(a: Agent) {
    if (!this.agents.has(a.id)) return;
    this.agents.delete(a.id);
    a.dispose();
    this.world.removeAgent(a.player);
  }

  status(a: Agent): AvatarStatus {
    const p = a.position;
    return {
      id: a.id,
      name: a.name,
      position: [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100, Math.round(p[2] * 100) / 100],
      heading: Math.round(a.heading),
      task: a.currentTask,
      lastResult: a.previousResult,
      joinedAt: a.created,
    };
  }

  perceive(a: Agent): Perception {
    return perceive(this.ctx, { id: a.id, position: a.position, yaw: a.yaw }, { name: a.name, task: a.currentTask, surface: a.motor.groundSurface() ?? null });
  }

  /** Resolves a move target: a place id, an object id (furniture, door, landmark), an avatar, or coordinates. */
  resolveTarget(a: Agent, target: { place?: string; position?: Vec3; object?: string; avatar?: string }): { point: Vec3; label: string } {
    const layout = this.world.layout;
    if (target.position) return { point: target.position, label: `(${target.position.map((v) => v.toFixed(1)).join(', ')})` };
    if (target.place) {
      const place = layout.places.find((p) => p.id === target.place);
      if (place) return { point: place.position, label: place.name };
      // Accept an object id given as a place, too.
      return this.resolveTarget(a, { object: target.place });
    }
    if (target.avatar) {
      const p = this.world.online().find((q) => q.info.id === target.avatar || q.info.name.toLowerCase() === target.avatar!.toLowerCase());
      if (!p) throw new AgentError('unknown-avatar', `Nobody called "${target.avatar}" is aboard.`, 404);
      return { point: p.pose.p, label: p.info.name };
    }
    if (target.object) {
      const o = this.ctx.objects.find((q) => q.id === target.object);
      if (!o) throw new AgentError('unknown-target', `No place or object called "${target.object}".`, 404);
      const p = o.points[0];
      // Stand beside it: the closest walkable point within a couple of metres, at its floor level.
      const floor: Vec3 = [p[0], p[1] - 0.5, p[2]];
      return { point: this.nav.snap(floor, 3, 1.5) ?? floor, label: o.name };
    }
    throw new AgentError('no-target', 'Give a place, object, avatar or position.', 422);
  }

  /** Point an agent can face: object, avatar or place by id. */
  locate(id: string): Vec3 | null {
    const o = this.ctx.objects.find((q) => q.id === id);
    if (o) return o.points[0];
    if (id === 'drone') return this.world.dronePose().position;
    const p = this.world.online().find((q) => q.info.id === id || q.info.name.toLowerCase() === id.toLowerCase());
    if (p) return p.pose.p;
    const place = this.world.layout.places.find((q) => q.id === id);
    return place?.position ?? null;
  }

  turnYaw(a: Agent, o: { degrees?: number; heading?: number; face?: string }): number {
    if (o.face) {
      const p = this.locate(o.face);
      if (!p) throw new AgentError('unknown-target', `Nothing called "${o.face}" to face.`, 404);
      const [x, , z] = a.position;
      return Math.atan2(-(p[0] - x), -(p[2] - z));
    }
    if (o.heading !== undefined) return yawOfHeading(o.heading);
    if (o.degrees !== undefined) return a.yaw - (o.degrees * Math.PI) / 180;
    throw new AgentError('no-turn', 'Give degrees, heading or face.', 422);
  }
}
