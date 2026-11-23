// `pnpm smoke`: checks a running server end to end, the way a browser and an agent use it.
// Meant for a deployment (through its proxy, over HTTPS), where the tests cannot reach.
//
//   SMOKE_URL=https://rig.example.com SMOKE_USER=marco SMOKE_PASSWORD=… pnpm smoke
//   SMOKE_URL=https://localhost pnpm smoke        no account given: signs one up (sign-ups must be open)
//
// It signs in, opens the game socket and comes aboard, creates an API key, reads the event
// stream while an avatar spawns and speaks, calls an MCP tool, then removes the avatar and
// revokes the key. With SMOKE_KEEP=1 the key and a chat line are left behind, and
// SMOKE_COOKIE / SMOKE_KEY check that an earlier run's session and key still work.

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, type ServerMessage } from '@oilrig/shared';

const base = (process.env.SMOKE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const origin = new URL(base).origin;
const keep = process.env.SMOKE_KEEP === '1';

function step(name: string, detail = '') {
  console.log(`ok  ${name}${detail ? `  (${detail})` : ''}`);
}

function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

/** Fails with the response's own text unless it has the expected status. */
async function expectStatus(res: Response, status: number, what: string) {
  if (res.status !== status) throw new Error(`${what} failed: ${res.status} ${await res.text()}`);
}

async function call(path: string, init: RequestInit & { cookie?: string; key?: string; json?: unknown } = {}) {
  const headers = new Headers(init.headers);
  // As a page of the site would send it: the server refuses other origins.
  headers.set('origin', origin);
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.key) headers.set('authorization', `Bearer ${init.key}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.json);
  }
  return fetch(`${base}${path}`, { ...init, headers, body });
}

const cookieFrom = (res: Response) => /oilrig_session=[^;]*/.exec(res.headers.get('set-cookie') ?? '')?.[0] ?? '';

async function signIn() {
  if (process.env.SMOKE_COOKIE) return process.env.SMOKE_COOKIE;
  const password = process.env.SMOKE_PASSWORD ?? 'smoke test passphrase';
  let res: Response;
  if (process.env.SMOKE_USER) {
    res = await call('/auth/signin', { method: 'POST', json: { username: process.env.SMOKE_USER, password } });
  } else {
    const stamp = Date.now().toString(36);
    res = await call('/auth/signup', { method: 'POST', json: { username: `smoke-${stamp}`, displayName: `Smoke ${stamp}`, password } });
  }
  await expectStatus(res, process.env.SMOKE_USER ? 200 : 201, 'sign-in');
  const set = res.headers.get('set-cookie') ?? '';
  check(!base.startsWith('https:') || /; Secure/i.test(set), 'the session cookie is not Secure over HTTPS (is PUBLIC_ORIGIN set?)');
  return cookieFrom(res);
}

/** Opens the game socket and comes aboard; resolves with the welcome. */
function comeAboard(cookie: string) {
  return new Promise<{ ws: WebSocket; welcome: Extract<ServerMessage, { type: 'welcome' }> }>((resolve, reject) => {
    const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws`, { headers: { cookie, origin } });
    const timer = setTimeout(() => reject(new Error('no welcome within 20 s')), 20_000);
    ws.once('open', () => ws.send(JSON.stringify({ type: 'hello', version: PROTOCOL_VERSION })));
    ws.once('unexpected-response', (_req, res) => reject(new Error(`socket refused: HTTP ${res.statusCode}`)));
    ws.once('error', reject);
    ws.on('message', (data) => {
      const m = JSON.parse(data.toString()) as ServerMessage;
      if (m.type === 'error') reject(new Error(`socket error: ${m.code} ${m.message}`));
      if (m.type !== 'welcome') return;
      clearTimeout(timer);
      resolve({ ws, welcome: m });
    });
  });
}

/** Reads an event stream until an event satisfies `until`; fails if nothing arrives in time. */
async function readUntil(res: Response, until: (event: string, data: string) => boolean, timeoutMs = 15_000) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const timer = setTimeout(() => void reader.cancel(), timeoutMs);
  let buf = '';
  let seen = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`the event stream ended or stalled after ${seen} events (is the proxy buffering it?)`);
      buf += decoder.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const event = /^event: (.*)$/m.exec(block)?.[1];
        if (!event) continue;
        seen += 1;
        if (until(event, /^data: (.*)$/m.exec(block)?.[1] ?? '')) return seen;
      }
    }
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
  }
}

const health = await call('/healthz');
check(health.ok, `/healthz answered ${health.status}`);
step('healthz', JSON.stringify(await health.json()));

const page = await call('/signup');
check(page.ok && /text\/html/.test(page.headers.get('content-type') ?? ''), `/signup answered ${page.status}`);
step('pages are served');

const cookie = await signIn();
const me = (await (await call('/auth/me', { cookie })).json()) as { user: { id: string; displayName: string } | null };
check(me.user, 'the session cookie was not accepted');
step('signed in', me.user.displayName);

const { ws, welcome } = await comeAboard(cookie);
step('came aboard over the socket', `${welcome.chat.length} chat lines kept, doors ${JSON.stringify(welcome.doors)}`);
if (process.env.SMOKE_EXPECT_CHAT) {
  check(welcome.chat.some((c) => c.text === process.env.SMOKE_EXPECT_CHAT), `the chat line "${process.env.SMOKE_EXPECT_CHAT}" was not kept`);
  step('chat was kept');
}

let key = process.env.SMOKE_KEY;
let keyId: string | undefined;
if (!key) {
  const made = await call('/auth/keys', { method: 'POST', cookie, json: { name: 'smoke' } });
  await expectStatus(made, 201, 'key creation');
  const body = (await made.json()) as { key: string; info: { id: string } };
  key = body.key;
  keyId = body.info.id;
}
step(process.env.SMOKE_KEY ? 'the earlier API key still works' : 'created an API key', `${(await call('/api/v1/world', { key })).status}`);

const stream = await call('/api/v1/events', { key });
check(stream.status === 200, `/api/v1/events answered ${stream.status}`);
const spawned = await call('/api/v1/avatars', { method: 'POST', key, json: { name: `Smoke ${Date.now().toString(36)}`, place: 'terrace' } });
await expectStatus(spawned, 201, 'spawning an avatar');
const avatar = (await spawned.json()) as { id: string };
const line = `smoke ${new Date().toISOString()}`;
check((await call(`/api/v1/avatars/${avatar.id}/chat`, { method: 'POST', key, json: { text: line } })).ok, 'the avatar could not speak');
const events = await readUntil(stream, (event, data) => event === 'chat' && data.includes(line));
step('events arrive as they happen', `${events} events`);

const mcp = new Client({ name: 'oilrig-smoke', version: '1.0.0' });
await mcp.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${key}` } } }));
const status = await mcp.callTool({ name: 'get_world_status', arguments: {} });
check(!status.isError, 'the MCP tool call failed');
await mcp.close();
step('MCP tool call', String((status.content as Array<{ text: string }>)[0].text.split('\n')[0]));

check((await call(`/api/v1/avatars/${avatar.id}`, { method: 'DELETE', key })).ok, 'the avatar could not be removed');
ws.close();
if (keep) {
  console.log(`\nSMOKE_COOKIE='${cookie}' SMOKE_KEY='${key}' SMOKE_EXPECT_CHAT='${line}'`);
} else if (keyId) {
  check((await call(`/auth/keys/${keyId}`, { method: 'DELETE', cookie })).ok, 'the key could not be revoked');
  step('revoked the key');
}
console.log('\nall good');
