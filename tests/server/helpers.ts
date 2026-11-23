import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll } from 'vitest';
import WebSocket from 'ws';
import { type Account, PROTOCOL_VERSION, type ServerMessage, type WelcomeMessage } from '@oilrig/shared';
import { type ServerVars, serverConfig } from '../../apps/server/src/config.ts';
import { type RunningServer, startServer } from '../../apps/server/src/server.ts';

// Each test file runs the real server on a free port, with its own empty database in a
// temporary directory, and talks to it over HTTP and WebSockets like a browser or an agent.

/** Sign-ups open; the drone stays away (off the pad) for the whole run. */
const TEST_VARS: ServerVars = { ALLOW_SIGNUPS: 'true', WEATHER_SEED: '5', DRONE_START_AWAY: 'true', DRONE_FIRST_ARRIVAL_MINUTES: '1440' };

/** Starts a server of its own (`DATA_DIR` defaults to memory, and no client is served unless `STATIC_DIR` is given). */
export const startTestServer = (vars: ServerVars = {}) =>
  startServer(serverConfig({ ...TEST_VARS, PORT: '0', DATA_DIR: ':memory:', STATIC_DIR: path.join(tmpdir(), 'oilrig-no-client'), ...vars }));

/** The file's server. */
export let server: RunningServer;
let dataDir: string;

beforeAll(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'oilrig-test-'));
  server = await startTestServer({ DATA_DIR: dataDir });
});

afterAll(async () => {
  await server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

/** Stops the server and starts it again on the same database, as a restart of the container does. */
export async function restart() {
  await server.close();
  server = await startTestServer({ DATA_DIR: dataDir });
}

let counter = 0;
/** A username nobody in this run has used yet. */
export const uniqueName = (base: string) => `${base.toLowerCase()}-${Date.now().toString(36)}${(counter++).toString(36)}`.slice(0, 24);

export function request(path: string, init: RequestInit & { cookie?: string; json?: unknown; server?: RunningServer } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.json);
  }
  return fetch(`${init.server?.url ?? server.url}${path}`, { ...init, headers, body });
}

/** The session cookie from a response, as a Cookie header value. */
export function cookieFrom(res: Response) {
  const set = res.headers.get('set-cookie') ?? '';
  const m = /oilrig_session=([^;]*)/.exec(set);
  return m ? `oilrig_session=${m[1]}` : '';
}

export interface Member {
  account: Account;
  cookie: string;
  username: string;
  password: string;
}

/** Signs up a new account (the test project sets ALLOW_SIGNUPS=true). */
export async function member(displayName: string, password = 'correct horse battery'): Promise<Member> {
  const username = uniqueName(displayName.replace(/[^a-z0-9]/gi, '') || 'user');
  const res = await request('/auth/signup', { method: 'POST', json: { username, displayName: `${displayName} ${username.slice(-4)}`, password } });
  if (res.status !== 201) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
  const { user } = (await res.json()) as { user: Account };
  return { account: user, cookie: cookieFrom(res), username, password };
}

export async function createKey(m: Member, name = 'tests') {
  const res = await request('/auth/keys', { method: 'POST', cookie: m.cookie, json: { name } });
  if (res.status !== 201) throw new Error(`key creation failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { key: string; info: { id: string } };
}

/** The server answered a WebSocket upgrade with an HTTP error. */
export class Refused extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`upgrade refused: ${status}`);
    this.status = status;
  }
}

/** A browser-like player: a WebSocket to the server with a typed inbox. */
export class Player {
  readonly ws: WebSocket;
  /** The Set-Cookie header that came with the upgrade, if any. */
  setCookie: string | null = null;
  readonly inbox: ServerMessage[] = [];
  readonly closed: Promise<{ code: number; reason: string }>;
  /** Resolves once the socket is open; rejects with the HTTP status of a refused upgrade. */
  private readonly opened: Promise<void>;
  private waiters: Array<{ pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    this.closed = new Promise((resolve) => ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() })));
    this.opened = new Promise((resolve, reject) => {
      ws.once('upgrade', (res) => (this.setCookie = res.headers['set-cookie']?.[0] ?? null));
      ws.once('open', () => resolve());
      ws.once('unexpected-response', (_req, res) => {
        res.resume();
        reject(new Refused(res.statusCode ?? 0));
      });
      ws.once('error', reject);
    });
    ws.on('message', (data) => {
      const m = JSON.parse(data.toString()) as ServerMessage;
      this.inbox.push(m);
      this.waiters = this.waiters.filter((w) => {
        if (!w.pred(m)) return true;
        w.resolve(m);
        return false;
      });
    });
  }

  /** Opens /ws with a member's cookie (or none). Throws `Refused` when the server answers with an HTTP error. */
  static async connect(cookie?: string, headers: Record<string, string> = {}, to: RunningServer = server) {
    const p = new Player(new WebSocket(`${to.url.replace('http', 'ws')}/ws`, { headers: { ...headers, ...(cookie ? { cookie } : {}) } }));
    await p.opened;
    return p;
  }

  /** The HTTP status of an upgrade the server refuses. */
  static async refused(cookie: string | undefined, headers: Record<string, string> = {}, to: RunningServer = server) {
    try {
      (await Player.connect(cookie, headers, to)).close();
    } catch (err) {
      if (err instanceof Refused) return err.status;
      throw err;
    }
    throw new Error('the socket opened');
  }

  /** Connects and joins, returning the welcome. */
  static async join(m: Member): Promise<[Player, WelcomeMessage]> {
    const p = await Player.connect(m.cookie);
    p.send({ type: 'hello', version: PROTOCOL_VERSION });
    return [p, await p.next('welcome')];
  }

  send(m: unknown) {
    this.ws.send(typeof m === 'string' ? m : JSON.stringify(m));
  }

  next<T extends ServerMessage['type']>(type: T, pred: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true, timeoutMs = 8000) {
    const match = (m: ServerMessage) => m.type === type && pred(m as Extract<ServerMessage, { type: T }>);
    const found = this.inbox.find(match);
    if (found) {
      this.inbox.splice(this.inbox.indexOf(found), 1);
      return Promise.resolve(found as Extract<ServerMessage, { type: T }>);
    }
    return new Promise<Extract<ServerMessage, { type: T }>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), timeoutMs);
      this.waiters.push({
        pred: match,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { type: T }>);
        },
      });
    });
  }

  close() {
    this.ws.close(1000);
  }
}

/** Reads an SSE stream into parsed events until `until` returns true. */
export async function readEvents(res: Response, until: (events: Array<{ id: string; event: string; data: any }>) => boolean, timeoutMs = 10_000) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: Array<{ id: string; event: string; data: any }> = [];
  let buf = '';
  const deadline = Date.now() + timeoutMs;
  while (!until(events) && Date.now() < deadline) {
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: true }>((r) => setTimeout(() => r({ value: undefined, done: true }), Math.max(0, deadline - Date.now()))),
    ]);
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const f: Record<string, string> = {};
      for (const line of block.split('\n')) {
        const m = /^(\w+): ?(.*)$/.exec(line);
        if (m) f[m[1]] = m[2];
      }
      if (f.event) events.push({ id: f.id, event: f.event, data: JSON.parse(f.data) });
    }
  }
  await reader.cancel();
  return events;
}
