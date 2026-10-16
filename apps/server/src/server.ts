import { existsSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { WebSocketServer, type WebSocket } from 'ws';
import { ClientMessage, makeClock } from '@ocean-home/shared';
import { AgentManager } from './agents/manager.ts';
import { EventLog } from './api/events.ts';
import { RateLimiter } from './api/keys.ts';
import { createMcpEndpoint } from './api/mcp.ts';
import { type ApiEnv, apiAuth, createRestApi } from './api/rest.ts';
import { ApiService } from './api/service.ts';
import type { ServerConfig } from './config.ts';
import { Store } from './db.ts';
import { type Connection, type Player, World } from './world/world.ts';

const MAX_MESSAGE_BYTES = 16 * 1024;

export interface RunningServer {
  url: string;
  port: number;
  world: World;
  agents: AgentManager;
  store: Store;
  close(): Promise<void>;
}

export async function startServer(cfg: ServerConfig): Promise<RunningServer> {
  const store = new Store(cfg.dbPath);
  const clock = makeClock({ realTime: cfg.realTime, dayLengthMinutes: cfg.dayLengthMinutes, offsetHours: cfg.timeOffsetHours });
  const world = await World.create({ clock, weatherSeed: cfg.weatherSeed, joinPassword: cfg.joinPassword, store, drone: cfg.drone });
  world.start();
  const agents = await AgentManager.create(world, cfg.agents);
  agents.start();
  const started = Date.now();

  // External API: REST + SSE under /api/v1, MCP at /mcp. Both use bearer API keys.
  const service = new ApiService(world, agents);
  const events = new EventLog(world);
  const auth = apiAuth(store, new RateLimiter());
  const mcp = createMcpEndpoint(service);

  const app = new Hono<ApiEnv>();
  app.route('/api/v1', createRestApi(service, events, auth));
  app.all('/mcp', auth, (c) => mcp.fetch(c.req.raw, c.get('apiKey').id, c.req.header('authorization')!.replace(/^Bearer\s+/i, '')));
  app.get('/healthz', (c) => c.json({ ok: true, players: world.humanCount, agents: world.agentCount, uptimeSeconds: Math.round((Date.now() - started) / 1000) }));
  if (cfg.staticDir && existsSync(cfg.staticDir)) {
    const root = cfg.staticDir;
    app.use('/*', serveStatic({ root }));
    app.get('*', serveStatic({ root, path: 'index.html' }));
  }

  const server = serve({ fetch: app.fetch, port: cfg.port, hostname: cfg.host });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => attach(ws));
  });

  function attach(ws: WebSocket) {
    const conn: Connection = {
      send: (m) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
      },
      sendRaw: (json) => {
        if (ws.readyState === ws.OPEN) ws.send(json);
      },
      close: (code, reason) => ws.close(code, reason),
    };
    let player: Player | null = null;
    let strikes = 0;
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        parsed = undefined;
      }
      const msg = ClientMessage.safeParse(parsed);
      if (!msg.success) {
        strikes += 1;
        conn.send({ type: 'error', code: 'bad-message', message: 'Message rejected.' });
        if (strikes > 50) ws.close(1008, 'too many bad messages');
        return;
      }
      try {
        player = world.handle(conn, player, msg.data);
      } catch (err) {
        console.error('[world] handler error', err);
        conn.send({ type: 'error', code: 'server-error', message: 'Something went wrong.' });
      }
    });
    ws.on('close', () => {
      if (player) world.disconnect(player);
    });
    ws.on('error', () => ws.terminate());
  }

  await new Promise<void>((resolve) => {
    if (server.listening) resolve();
    else server.once('listening', () => resolve());
  });
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://localhost:${port}`,
    port,
    world,
    agents,
    store,
    async close() {
      agents.stop();
      await mcp.close();
      world.stop();
      for (const c of wss.clients) c.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    },
  };
}
