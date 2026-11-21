import { Hono } from 'hono';
import { type Rapier, makeClock } from '@ocean-home/shared';
import { AgentManager } from '../agents/manager.ts';
import type { RecastImpl } from '../agents/navmesh.ts';
import { EventLog } from '../api/events.ts';
import { type KeyStore, RateLimiter } from '../api/keys.ts';
import { createMcpEndpoint } from '../api/mcp.ts';
import { type ApiEnv, apiAuth, createRestApi } from '../api/rest.ts';
import { ApiService } from '../api/service.ts';
import type { WorldConfig } from '../config.ts';
import type { WorldStore } from './store.ts';
import { World } from './world.ts';

export interface RuntimeOptions {
  rapier: Rapier;
  recast?: RecastImpl;
  config: WorldConfig;
  store: WorldStore & KeyStore;
  /** Whether a name belongs to a registered person (agents may not take it). */
  nameTaken?: (name: string) => Promise<boolean>;
}

/** Everything the world server runs: the world, its AI agents, and the REST, SSE and MCP API
 * (served under /api/v1 and /mcp, authenticated with users' API keys). */
export class WorldRuntime {
  readonly world: World;
  readonly agents: AgentManager;
  readonly events: EventLog;
  readonly api: Hono<ApiEnv>;

  private constructor(world: World, agents: AgentManager, store: KeyStore, nameTaken?: (name: string) => Promise<boolean>) {
    this.world = world;
    this.agents = agents;
    this.events = new EventLog(world);
    const service = new ApiService(world, agents, nameTaken);
    const auth = apiAuth(store, new RateLimiter());
    const mcp = createMcpEndpoint(service);
    this.api = new Hono<ApiEnv>();
    this.api.route('/api/v1', createRestApi(service, this.events, auth));
    this.api.all('/mcp', auth, (c) => mcp.fetch(c.req.raw, c.get('apiKey').id, c.req.header('authorization')!.replace(/^Bearer\s+/i, '')));
  }

  static async create(o: RuntimeOptions) {
    const c = o.config;
    const clock = makeClock({ realTime: c.realTime, dayLengthMinutes: c.dayLengthMinutes, offsetHours: c.timeOffsetHours });
    const world = World.create({ rapier: o.rapier, clock, weatherSeed: c.weatherSeed, store: o.store, drone: c.drone });
    const agents = await AgentManager.create(world, c.agents, o.recast);
    return new WorldRuntime(world, agents, o.store, o.nameTaken);
  }

  /** Something needs the world to keep running: people aboard, agents, or open event streams. */
  get active() {
    return this.world.humanCount > 0 || this.agents.count > 0 || this.events.subscribers > 0;
  }

  get running() {
    return this.world.running;
  }

  start() {
    this.world.start();
    this.agents.start();
  }

  /** Stops the clocks; agents and people's places are kept. */
  pause() {
    this.world.stop();
    this.agents.pause();
  }
}
