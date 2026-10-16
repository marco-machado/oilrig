import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiKey } from '../apps/server/src/api/keys.ts';
import { type RunningServer, startServer } from '../apps/server/src/server.ts';
import { TEST_SERVER_CONFIG } from './helpers.ts';
import { WsClient } from './wsclient.ts';

// The REST + SSE API against a running server, with a browser-like WebSocket player
// watching the same world.

let server: RunningServer;
let key: string;

beforeAll(async () => {
  server = await startServer(TEST_SERVER_CONFIG);
  key = createApiKey(server.store, 'tests', 600).key;
});

afterAll(async () => {
  await server.close();
});

function api(p: string, init: RequestInit & { key?: string | null } = {}) {
  const headers = new Headers(init.headers);
  const k = init.key === undefined ? key : init.key;
  if (k) headers.set('authorization', `Bearer ${k}`);
  if (init.body) headers.set('content-type', 'application/json');
  return fetch(`${server.url}/api/v1${p}`, { ...init, headers });
}

const post = (p: string, body: unknown, k?: string) => api(p, { method: 'POST', body: JSON.stringify(body), key: k });

/** Reads an SSE stream into parsed events until `until` returns true. */
async function readEvents(res: Response, until: (events: Array<{ id: string; event: string; data: any }>) => boolean, timeoutMs = 8000) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: Array<{ id: string; event: string; data: any }> = [];
  let buf = '';
  const deadline = Date.now() + timeoutMs;
  while (!until(events) && Date.now() < deadline) {
    const { value, done } = await Promise.race([reader.read(), new Promise<{ value: undefined; done: true }>((r) => setTimeout(() => r({ value: undefined, done: true }), deadline - Date.now()))]);
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

describe('REST API', () => {
  it('rejects missing, malformed and revoked keys; the OpenAPI document is public and complete', async () => {
    expect((await api('/world', { key: null })).status).toBe(401);
    expect((await api('/world', { key: 'ohk_nothing' })).status).toBe(401);
    const k = createApiKey(server.store, 'short-lived');
    expect((await api('/world', { key: k.key })).status).toBe(200);
    server.store.revokeApiKey(k.id);
    const r = await api('/world', { key: k.key });
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toMatch(/Bearer/);

    const doc = await (await api('/openapi.json', { key: null })).json();
    expect(doc.openapi).toBe('3.1.0');
    for (const p of ['/world', '/places', '/avatars', '/avatars/{id}/actions', '/avatars/{id}/perception', '/avatars/{id}/chat', '/events']) {
      expect(Object.keys(doc.paths), p).toContain(p);
    }
    expect(doc.components.securitySchemes.ApiKey.scheme).toBe('bearer');
  });

  it('never stores a key in plain text', () => {
    const k = createApiKey(server.store, 'secretive');
    const rows = JSON.stringify(server.store.dumpApiKeyTable());
    const secret = k.key.split('_').slice(2).join('_');
    expect(rows).not.toContain(secret);
    expect(rows).toContain(k.id);
  });

  it('rate-limits each key on its own', async () => {
    const slow = createApiKey(server.store, 'slow', 20); // bursts of 10
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) statuses.push((await api('/places', { key: slow.key })).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(10)).toContain(429);
    const limited = await api('/places', { key: slow.key });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    // Another key is unaffected.
    expect((await api('/places')).status).toBe(200);
  });

  it('spawns an avatar a browser player sees, walks it with move_to, and streams the events', async () => {
    const sse = await api('/events');
    expect(sse.headers.get('content-type')).toMatch(/text\/event-stream/);
    const person = new WsClient(server.port);
    await person.join('Marina');

    const spawned = await post('/avatars', { name: 'Navigator', place: 'terrace' });
    expect(spawned.status).toBe(201);
    const avatar = await spawned.json();
    const joined = await person.next('join', (m) => m.player.id === avatar.id);
    expect(joined.player).toMatchObject({ name: 'Navigator', kind: 'agent' });

    const moved = await post(`/avatars/${avatar.id}/actions`, { action: { type: 'move_to', place: 'pool-deck' } });
    const outcome = await moved.json();
    expect(outcome.status).toBe('arrived');
    const pool = (await (await api('/places')).json()).places.find((p: { id: string }) => p.id === 'pool-deck');
    expect(Math.hypot(outcome.avatar.position[0] - pool.position[0], outcome.avatar.position[2] - pool.position[2])).toBeLessThan(0.6);
    // The browser sees it there too.
    await person.next('snapshot', (m) => m.players.some((p) => p.id === avatar.id && Math.hypot(p.p[0] - pool.position[0], p.p[2] - pool.position[2]) < 0.7));

    const said = await post(`/avatars/${avatar.id}/chat`, { text: 'Water looks lovely.' });
    expect(said.status).toBe(200);
    expect((await person.next('chat')).entry).toMatchObject({ from: avatar.id, text: 'Water looks lovely.' });

    const events = await readEvents(sse, (es) => es.some((e) => e.event === 'chat'));
    const kinds = events.map((e) => e.event);
    expect(kinds).toContain('join');
    expect(kinds.indexOf('join')).toBeLessThan(kinds.indexOf('chat'));
    const ids = events.map((e) => Number(e.id));
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);

    // Reconnecting with Last-Event-ID replays what came after it.
    const replay = await readEvents(await api('/events', { headers: { 'last-event-id': String(ids[0]) } }), (es) => es.some((e) => e.event === 'chat'));
    expect(replay.map((e) => Number(e.id))).toEqual(ids.slice(1).filter((i) => i <= Number(replay.at(-1)!.id)));
    person.close();
  });

  it('reports perception, keeps avatars private to their key, and explains bad requests', async () => {
    const a = await (await post('/avatars', { name: 'Looker', place: 'living-room' })).json();
    const p = await (await api(`/avatars/${a.id}/perception`)).json();
    expect(p.self.area.id).toBe('living-room');
    expect(Array.isArray(p.visible)).toBe(true);

    const other = createApiKey(server.store, 'someone else');
    const stolen = await post(`/avatars/${a.id}/actions`, { action: { type: 'stop' } }, other.key);
    expect(stolen.status).toBe(404);

    const bad = await post(`/avatars/${a.id}/actions`, { action: { type: 'fly', to: 'moon' } });
    expect(bad.status).toBe(422);
    expect((await bad.json()).error.message).toMatch(/action/);

    const farDoor = await post(`/avatars/${a.id}/actions`, { action: { type: 'interact', target: 'door-east' } });
    expect(farDoor.status).toBe(422);
    expect((await farDoor.json()).error.message).toMatch(/too far/i);

    expect((await api(`/avatars/${a.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await api(`/avatars/${a.id}`)).status).toBe(404);
  });

  it('the keys CLI creates, lists and revokes keys in the server database', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ocean-keys-'));
    const env = { ...process.env, DB_PATH: path.join(dir, 'keys.db') };
    const cli = (...args: string[]) => execFileSync(process.execPath, ['apps/server/src/cli/keys.ts', ...args], { env, encoding: 'utf8' });
    try {
      const created = JSON.parse(cli('create', 'cli-bot', '--rate', '30', '--json'));
      expect(created.key).toMatch(/^ohk_/);
      const listed = JSON.parse(cli('list', '--json'));
      expect(listed).toEqual([expect.objectContaining({ id: created.id, name: 'cli-bot', ratePerMinute: 30, revoked: null })]);
      const other = await startServer({ ...TEST_SERVER_CONFIG, dbPath: env.DB_PATH });
      try {
        const ok = await fetch(`${other.url}/api/v1/world`, { headers: { authorization: `Bearer ${created.key}` } });
        expect(ok.status).toBe(200);
        cli('revoke', created.id);
        const no = await fetch(`${other.url}/api/v1/world`, { headers: { authorization: `Bearer ${created.key}` } });
        expect(no.status).toBe(401);
      } finally {
        await other.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
