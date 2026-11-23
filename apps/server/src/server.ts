import { existsSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import RAPIER from '@dimforge/rapier3d-compat';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { parse as parseCookies } from 'hono/utils/cookie';
import { type WebSocket, WebSocketServer } from 'ws';
import { type ApiKeyInfo, CLOSE, ClientMessage } from '@oilrig/shared';
import { AgentError } from './agents/manager.ts';
import { createApiKey } from './api/keys.ts';
import { originPolicy } from './auth/origin.ts';
import { SESSION_COOKIE, authRoutes, parseSessionCookie, sessionCookie } from './auth/routes.ts';
import type { ServerConfig } from './config.ts';
import { Accounts } from './db/accounts.ts';
import { Database } from './db/database.ts';
import { SqlWorldStore } from './db/world-store.ts';
import { WorldRuntime } from './world/runtime.ts';
import type { Connection, Identity, Player } from './world/world.ts';

const MAX_MESSAGE_BYTES = 16 * 1024;
/** How often the server looks whether anyone still needs the world's clocks. */
const IDLE_CHECK_MS = 30_000;
/** How long sockets get to close when the server stops. */
const CLOSE_GRACE_MS = 2000;
/** Paths that are never answered with the game's page. */
const NOT_PAGES = /^\/(assets|sfx|models|api|auth|mcp|ws|healthz)(\/|$)/;

interface Socket {
  ws: WebSocket;
  conn: Connection;
  who: Identity;
  player: Player | null;
  strikes: number;
}

export interface RunningServer {
  url: string;
  port: number;
  /** The database, for tests that check what is stored. */
  db: Database;
  /** The world, once it has been built (it is on first need). */
  readonly runtime: WorldRuntime | null;
  readonly booted: boolean;
  /** Whether the world's clocks are running. */
  readonly running: boolean;
  /** What the idle timer does: stops the clocks when nobody needs them. */
  checkIdle(): void;
  close(): Promise<void>;
}

/** The whole server in one process: accounts under /auth, the game socket at /ws, the REST,
 * SSE and MCP API for AI agents, and the built client's files. */
export async function startServer(cfg: ServerConfig): Promise<RunningServer> {
  const db = new Database(cfg.dataDir);
  const store = new SqlWorldStore(db);
  const accounts = new Accounts(db);
  const origin = originPolicy(cfg.publicOrigin);
  const started = Date.now();
  const sockets = new Set<Socket>();
  let runtime: WorldRuntime | null = null;
  let booting: Promise<WorldRuntime> | null = null;
  let closing = false;

  // ---------- the world, built on first need ----------

  async function boot() {
    await RAPIER.init();
    const r = await WorldRuntime.create({ rapier: RAPIER, config: cfg.world, store, nameTaken: async (name) => accounts.isDisplayName(name) });
    r.events.onSubscribersChange = () => updateActivity();
    runtime = r;
    return r;
  }

  function ensureRuntime(): Promise<WorldRuntime> {
    if (runtime) return Promise.resolve(runtime);
    booting ??= boot().catch((err) => {
      // The next request tries again.
      booting = null;
      throw err;
    });
    return booting;
  }

  /** Starts the clocks when something needs them. */
  function updateActivity() {
    const r = runtime;
    if (closing || !r || !r.active) return;
    if (!r.running) r.start();
  }

  function checkIdle() {
    const r = runtime;
    if (closing || !r) return;
    if (r.active) {
      if (!r.running) r.start();
    } else if (r.running || r.events.subscribers > 0) {
      // Nobody aboard and nothing worth listening to: stop simulating.
      r.pause();
    }
  }

  // ---------- HTTP ----------

  const listKeys = (userId: string): ApiKeyInfo[] =>
    store.activeKeys(userId).map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, ratePerMinute: k.ratePerMinute, created: k.created, lastUsed: k.lastUsed }));

  const app = new Hono();

  // For the start screen: cheap, does not build the world.
  app.get('/healthz', (c) =>
    c.json({ ok: true, players: runtime?.world.humanCount ?? 0, agents: runtime?.agents.count ?? 0, uptimeSeconds: Math.round((Date.now() - started) / 1000) }),
  );

  app.route(
    '/auth',
    authRoutes({
      accounts,
      origin,
      signupsOpen: cfg.signupsOpen,
      keys: {
        list: listKeys,
        async create(userId, name) {
          try {
            const k = await createApiKey(store, userId, name);
            return { ok: true, key: k.key, info: listKeys(userId).find((i) => i.id === k.id)! };
          } catch (err) {
            if (err instanceof AgentError) return { ok: false, code: err.code, message: err.message };
            throw err;
          }
        },
        revoke(userId, keyId) {
          const ok = store.revokeApiKey(userId, keyId);
          if (ok) runtime?.agents.removeForKey(keyId);
          return ok;
        },
      },
      renamed(userId, name) {
        for (const s of sockets) if (s.who.userId === userId) s.who = { ...s.who, name };
        runtime?.world.rename(userId, name);
      },
    }),
  );

  // A WebSocket upgrade never reaches here (see `upgrade` below).
  app.get('/ws', (c) => c.text('Expected a WebSocket upgrade.', 426));

  const api = async (req: Request) => {
    const r = await ensureRuntime();
    const res = await r.api.fetch(req);
    updateActivity();
    return res;
  };
  app.all('/api/*', (c) => api(c.req.raw));
  app.all('/mcp', (c) => api(c.req.raw));

  if (existsSync(path.join(cfg.staticDir, 'index.html'))) {
    const root = cfg.staticDir;
    // Vite gives these files a content hash in their name, so one never changes.
    app.use('/assets/*', async (c, next) => {
      await next();
      if (c.res.status === 200) c.res.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    });
    // The pages name those files, so a browser must ask again before reusing one it has kept.
    app.use('*', async (c, next) => {
      await next();
      if (c.res.headers.get('Content-Type')?.startsWith('text/html')) c.res.headers.set('Cache-Control', 'no-cache');
    });
    app.use('/*', serveStatic({ root }));
    app.get('/signup', serveStatic({ root, path: 'signup.html' }));
    app.get('/viewer', serveStatic({ root, path: 'viewer.html' }));
    // Any other address is the game's page, except a file or an endpoint that does not exist.
    app.get('*', async (c, next) => (NOT_PAGES.test(c.req.path) ? next() : serveStatic({ root, path: 'index.html' })(c, next)));
  }

  const server = serve({ fetch: app.fetch, port: cfg.port, hostname: cfg.host });

  // ---------- WebSockets ----------

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  /** A renewed session's cookie, to go out with the answer to that upgrade. */
  const renewedCookies = new WeakMap<IncomingMessage, string>();
  wss.on('headers', (headers, req) => {
    const cookie = renewedCookies.get(req);
    if (cookie) headers.push(`Set-Cookie: ${cookie}`);
  });

  function refuse(socket: Duplex, status: number, text: string) {
    socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`);
  }

  async function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/ws') return refuse(socket, 404, 'Not Found');
    if (closing) return refuse(socket, 503, 'Service Unavailable');
    const requestOrigin = `http://${req.headers.host}`;
    if (!origin.same(req.headers.origin, requestOrigin)) return refuse(socket, 403, 'Forbidden');
    const id = parseSessionCookie(parseCookies(req.headers.cookie ?? '', SESSION_COOKIE)[SESSION_COOKIE]);
    const s = id ? await accounts.checkSession(id.userId, id.token) : null;
    if (!s) {
      // Browsers cannot read an HTTP error on a WebSocket upgrade, so a refusal is a socket that says why and closes.
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.on('error', () => ws.terminate());
        ws.send(JSON.stringify({ type: 'error', code: 'signed-out', message: 'Sign in to come aboard.' }));
        ws.close(CLOSE.unauthorized, 'signed out');
      });
      return;
    }
    // The page sends hello as soon as the socket opens, so the world is ready before it does.
    await ensureRuntime();
    if (closing || socket.destroyed) return socket.destroy();
    if (s.renewed) renewedCookies.set(req, sessionCookie(s.account.id, s.token, s.expires, origin.secure(requestOrigin)));
    wss.handleUpgrade(req, socket, head, (ws) => attach(ws, { userId: s.account.id, name: s.account.displayName }));
  }

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    // Node has stopped listening for this socket's errors and `ws` only starts once it takes
    // over: a connection reset while the session is checked or the world is built would
    // otherwise be an uncaught error.
    socket.on('error', () => socket.destroy());
    upgrade(req, socket, head).catch((err) => {
      console.error('[ws] upgrade failed', err);
      socket.destroy();
    });
  });

  function attach(ws: WebSocket, who: Identity) {
    const sendRaw = (json: string) => {
      if (ws.readyState === ws.OPEN) ws.send(json);
    };
    const s: Socket = {
      ws,
      who,
      player: null,
      strikes: 0,
      conn: {
        send: (m) => sendRaw(JSON.stringify(m)),
        sendRaw,
        close: (code, reason) => ws.close(code, reason),
      },
    };
    sockets.add(s);
    ws.on('message', (data, isBinary) => {
      const world = runtime?.world;
      if (isBinary || !world) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
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
      try {
        s.player = world.handle(s.conn, s.player, msg.data, s.who);
      } catch (err) {
        console.error('[world] handler error', err);
        s.conn.send({ type: 'error', code: 'server-error', message: 'Something went wrong.' });
      }
      updateActivity();
    });
    ws.on('close', () => {
      sockets.delete(s);
      if (s.player) runtime?.world.disconnect(s.player, s.conn);
    });
    // A message over the size limit lands here; ws then closes the socket with 1009.
    ws.on('error', () => {});
  }

  // ---------- running ----------

  await new Promise<void>((resolve, reject) => {
    if (server.listening) return resolve();
    server.once('listening', () => resolve());
    server.once('error', reject);
  });
  const port = (server.address() as AddressInfo).port;
  const idleTimer = setInterval(checkIdle, IDLE_CHECK_MS);

  async function close() {
    if (closing) return;
    closing = true;
    clearInterval(idleTimer);
    await booting?.catch(() => {});
    // Ends the event streams and settles requests waiting on an agent, so their responses finish.
    await runtime?.close();
    for (const ws of wss.clients) ws.close(1001, 'server stopping');
    const deadline = Date.now() + CLOSE_GRACE_MS;
    while (wss.clients.size > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      if ('closeIdleConnections' in server) server.closeIdleConnections();
      setTimeout(() => 'closeAllConnections' in server && server.closeAllConnections(), CLOSE_GRACE_MS).unref();
    });
    db.close();
  }

  return {
    url: `http://localhost:${port}`,
    port,
    db,
    get runtime() {
      return runtime;
    },
    get booted() {
      return runtime !== null;
    },
    get running() {
      return runtime?.running ?? false;
    },
    checkIdle,
    close,
  };
}
