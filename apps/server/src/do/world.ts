import { DurableObject } from 'cloudflare:workers';
import { type ApiKeyInfo, ClientMessage } from '@ocean-home/shared';
import { AgentError } from '../agents/manager.ts';
import { createApiKey } from '../api/keys.ts';
import { worldConfig } from '../config.ts';
import { loadRapier, recastImpl } from '../wasm/workerd.ts';
import { WorldRuntime } from '../world/runtime.ts';
import type { Connection, Identity, Player } from '../world/world.ts';
import { SqlWorldStore } from './sql-store.ts';

const MAX_MESSAGE_BYTES = 16 * 1024;
/** While the world runs, an alarm this often keeps the object in memory (timers alone do not)
 * and notices when nobody needs it any more. */
const HEARTBEAT_MS = 30_000;
/** Header the Worker sets on /ws with who the signed-in person is. */
export const IDENTITY_HEADER = 'x-oh-identity';

interface Socket {
  conn: Connection;
  player: Player | null;
  strikes: number;
}

/** The world server: one instance, named "world". People connect over WebSockets (the Worker
 * vouches for who they are); AI agents use the REST, SSE and MCP API with users' keys. Chat
 * lives here too, since it goes out over the same sockets and to the agents. */
export class WorldDO extends DurableObject<Env> {
  private readonly store: SqlWorldStore;
  private runtime: WorldRuntime | null = null;
  private booting: Promise<WorldRuntime> | null = null;
  private readonly sockets = new Map<WebSocket, Socket>();
  private readonly started = Date.now();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new SqlWorldStore(ctx.storage.sql);
  }

  /** Builds the physics world, navmesh and API on first need. */
  private ensureRuntime(): Promise<WorldRuntime> {
    if (this.runtime) return Promise.resolve(this.runtime);
    this.booting ??= this.ctx.blockConcurrencyWhile(async () => {
      const directory = this.env.DIRECTORY.getByName('directory');
      const runtime = await WorldRuntime.create({
        rapier: await loadRapier(),
        recast: recastImpl,
        config: worldConfig(this.env),
        store: this.store,
        nameTaken: (name) => directory.isDisplayName(name),
      });
      runtime.events.onSubscribersChange = () => void this.updateActivity();
      this.runtime = runtime;
      return runtime;
    });
    return this.booting;
  }

  /** Starts the clocks when something needs them, and keeps the heartbeat alarm set. */
  private async updateActivity() {
    const r = this.runtime;
    if (!r || !r.active) return;
    if (!r.running) r.start();
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
  }

  async alarm() {
    const r = this.runtime;
    if (!r) return;
    if (r.active) {
      if (!r.running) r.start();
      await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
    } else {
      // Nobody aboard and nothing listening: stop, so the object can hibernate.
      r.pause();
    }
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/ws') return this.acceptSocket(req);
    const runtime = await this.ensureRuntime();
    const res = await runtime.api.fetch(req);
    await this.updateActivity();
    return res;
  }

  // ---------- WebSockets ----------

  private async acceptSocket(req: Request): Promise<Response> {
    if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket upgrade.', { status: 426 });
    const raw = req.headers.get(IDENTITY_HEADER);
    if (!raw) return new Response('Not signed in.', { status: 401 });
    const who = JSON.parse(decodeURIComponent(raw)) as Identity;
    await this.ensureRuntime();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [who.userId]);
    server.serializeAttachment(who);
    return new Response(null, { status: 101, webSocket: client });
  }

  private socket(ws: WebSocket): Socket {
    let s = this.sockets.get(ws);
    if (!s) {
      s = {
        conn: {
          send: (m) => this.sendTo(ws, JSON.stringify(m)),
          sendRaw: (json) => this.sendTo(ws, json),
          close: (code, reason) => {
            try {
              ws.close(code, reason);
            } catch {
              // already closed
            }
          },
        },
        player: null,
        strikes: 0,
      };
      this.sockets.set(ws, s);
    }
    return s;
  }

  private sendTo(ws: WebSocket, json: string) {
    try {
      ws.send(json);
    } catch {
      // closing
    }
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    if (typeof data !== 'string') return;
    const runtime = await this.ensureRuntime();
    const known = this.sockets.has(ws);
    const s = this.socket(ws);
    if (data.length > MAX_MESSAGE_BYTES) {
      s.conn.close(1009, 'message too big');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      parsed = undefined;
    }
    const msg = ClientMessage.safeParse(parsed);
    if (!msg.success) {
      s.strikes += 1;
      s.conn.send({ type: 'error', code: 'bad-message', message: 'Message rejected.' });
      if (s.strikes > 50) s.conn.close(1008, 'too many bad messages');
      return;
    }
    if (!known && msg.data.type !== 'hello') {
      // The world restarted under a live socket: have the client reconnect and join again.
      s.conn.close(1012, 'world restarted');
      return;
    }
    const who = ws.deserializeAttachment() as Identity;
    try {
      s.player = runtime.world.handle(s.conn, s.player, msg.data, who);
    } catch (err) {
      console.error('[world] handler error', err);
      s.conn.send({ type: 'error', code: 'server-error', message: 'Something went wrong.' });
    }
    await this.updateActivity();
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    this.dropSocket(ws);
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      // already closed
    }
  }

  async webSocketError(ws: WebSocket) {
    this.dropSocket(ws);
  }

  private dropSocket(ws: WebSocket) {
    const s = this.sockets.get(ws);
    this.sockets.delete(ws);
    if (s?.player && this.runtime) this.runtime.world.disconnect(s.player, s.conn);
  }

  // ---------- RPC (from the Worker) ----------

  /** For the start screen: cheap, does not boot the world. */
  health() {
    const r = this.runtime;
    return { ok: true, players: r?.world.humanCount ?? 0, agents: r?.agents.count ?? 0, uptimeSeconds: Math.round((Date.now() - this.started) / 1000) };
  }

  /** A display name changed: people aboard see it at once, and a reconnect uses it. */
  rename(userId: string, name: string) {
    for (const ws of this.ctx.getWebSockets(userId)) ws.serializeAttachment({ ...(ws.deserializeAttachment() as Identity), name });
    this.runtime?.world.rename(userId, name);
  }

  listKeys(userId: string): ApiKeyInfo[] {
    return this.store.activeKeys(userId).map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, ratePerMinute: k.ratePerMinute, created: k.created, lastUsed: k.lastUsed }));
  }

  async createKey(userId: string, name: string): Promise<{ ok: true; key: string; info: ApiKeyInfo } | { ok: false; code: string; message: string }> {
    try {
      const k = await createApiKey(this.store, userId, name);
      return { ok: true, key: k.key, info: this.listKeys(userId).find((i) => i.id === k.id)! };
    } catch (err) {
      if (err instanceof AgentError) return { ok: false, code: err.code, message: err.message };
      throw err;
    }
  }

  /** Revokes a key; its avatars leave at once. */
  revokeKey(userId: string, keyId: string): boolean {
    const ok = this.store.revokeApiKey(userId, keyId);
    if (ok) this.runtime?.agents.removeForKey(keyId);
    return ok;
  }
}
