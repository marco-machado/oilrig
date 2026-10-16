import { existsSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { WebSocketServer, type WebSocket } from 'ws';
import { ClientMessage, makeClock } from '@ocean-home/shared';
import type { ServerConfig } from './config.ts';
import { Store } from './db.ts';
import { type Connection, type Player, World } from './world/world.ts';

const MAX_MESSAGE_BYTES = 16 * 1024;

export interface RunningServer {
  url: string;
  port: number;
  world: World;
  close(): Promise<void>;
}

export async function startServer(cfg: ServerConfig): Promise<RunningServer> {
  const store = new Store(cfg.dbPath);
  const clock = makeClock({ realTime: cfg.realTime, dayLengthMinutes: cfg.dayLengthMinutes, offsetHours: cfg.timeOffsetHours });
  const world = await World.create({ clock, weatherSeed: cfg.weatherSeed, joinPassword: cfg.joinPassword, store });
  world.start();
  const started = Date.now();

  const app = new Hono();
  app.get('/healthz', (c) => c.json({ ok: true, players: world.playerCount, uptimeSeconds: Math.round((Date.now() - started) / 1000) }));
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
    async close() {
      world.stop();
      for (const c of wss.clients) c.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    },
  };
}
