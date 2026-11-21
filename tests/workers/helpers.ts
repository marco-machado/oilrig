import { SELF } from 'cloudflare:test';
import { type Account, PROTOCOL_VERSION, type ServerMessage, type WelcomeMessage } from '@ocean-home/shared';

// Requests go through the real Worker (SELF): routing, cookies, the Durable Objects.

export const ORIGIN = 'http://localhost';

let counter = 0;
/** A username nobody in this run has used yet. */
export const uniqueName = (base: string) => `${base.toLowerCase()}-${Date.now().toString(36)}${(counter++).toString(36)}`.slice(0, 24);

export function request(path: string, init: RequestInit & { cookie?: string; json?: unknown } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.json);
  }
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers, body });
}

/** The session cookie from a response, as a Cookie header value. */
export function cookieFrom(res: Response) {
  const set = res.headers.get('set-cookie') ?? '';
  const m = /oh_session=([^;]*)/.exec(set);
  return m ? `oh_session=${m[1]}` : '';
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

/** A browser-like player: a WebSocket through the Worker with a typed inbox. */
export class Player {
  readonly ws: WebSocket;
  readonly inbox: ServerMessage[] = [];
  readonly closed: Promise<{ code: number; reason: string }>;
  private waiters: Array<{ pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    this.closed = new Promise((resolve) => ws.addEventListener('close', (e) => resolve({ code: e.code, reason: e.reason })));
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(String(e.data)) as ServerMessage;
      this.inbox.push(m);
      this.waiters = this.waiters.filter((w) => {
        if (!w.pred(m)) return true;
        w.resolve(m);
        return false;
      });
    });
  }

  /** Opens /ws with a member's cookie (or none). */
  static async connect(cookie?: string, headers: Record<string, string> = {}) {
    const res = await request('/ws', { headers: { upgrade: 'websocket', ...headers }, cookie });
    if (!res.webSocket) throw new Error(`no socket: ${res.status} ${await res.text()}`);
    res.webSocket.accept();
    return new Player(res.webSocket);
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
