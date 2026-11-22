import { env, runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { type Member, Player, createKey, member, readEvents, request } from './helpers.ts';

// The REST + SSE API with users' keys, while a browser-like player watches the same world.

let owner: Member;
let key: string;

beforeAll(async () => {
  owner = await member('Owner');
  key = (await createKey(owner)).key;
});

function api(p: string, init: RequestInit & { key?: string | null; json?: unknown } = {}) {
  const headers = new Headers(init.headers);
  const k = init.key === undefined ? key : init.key;
  if (k) headers.set('authorization', `Bearer ${k}`);
  return request(`/api/v1${p}`, { ...init, headers });
}

const post = (p: string, json: unknown, k?: string) => api(p, { method: 'POST', json, key: k });

describe('REST API', () => {
  it('rejects missing, malformed and revoked keys; the OpenAPI document is public and complete', async () => {
    expect((await api('/world', { key: null })).status).toBe(401);
    expect((await api('/world', { key: 'ork_nothing' })).status).toBe(401);
    const k = await createKey(owner, 'short-lived');
    expect((await api('/world', { key: k.key })).status).toBe(200);
    expect((await request(`/auth/keys/${k.info.id}`, { method: 'DELETE', cookie: owner.cookie })).status).toBe(200);
    const r = await api('/world', { key: k.key });
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toMatch(/Bearer/);
    expect(((await r.json()) as { error: { message: string } }).error.message).toMatch(/Account panel/);

    const doc = (await (await api('/openapi.json', { key: null })).json()) as { openapi: string; paths: object; components: { securitySchemes: { ApiKey: { scheme: string } } } };
    expect(doc.openapi).toBe('3.1.0');
    for (const p of ['/world', '/places', '/avatars', '/avatars/{id}/actions', '/avatars/{id}/perception', '/avatars/{id}/chat', '/events']) {
      expect(Object.keys(doc.paths), p).toContain(p);
    }
    expect(doc.components.securitySchemes.ApiKey.scheme).toBe('bearer');
  });

  it('never stores a key in plain text', async () => {
    const k = await createKey(owner, 'secretive');
    const rows = await runInDurableObject(env.WORLD.getByName('world'), (_, state) => JSON.stringify(state.storage.sql.exec('SELECT * FROM api_keys').toArray()));
    expect(rows).not.toContain(k.key.split('_').slice(2).join('_'));
    expect(rows).toContain(k.info.id);
    expect(rows).toContain(owner.account.id);
  });

  it('rate-limits each key on its own (120/min, bursts of 30)', async () => {
    const other = await member('Burst');
    const burst = (await createKey(other, 'burst')).key;
    const statuses: number[] = [];
    for (let i = 0; i < 34; i++) statuses.push((await api('/places', { key: burst })).status);
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(30)).toContain(429);
    const limited = await api('/places', { key: burst });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await api('/places')).status).toBe(200);
  });

  it('spawns an avatar a browser player sees, walks it with move_to, and streams the events', async () => {
    const sse = await api('/events');
    expect(sse.headers.get('content-type')).toMatch(/text\/event-stream/);
    const [person] = await Player.join(await member('Marina'));

    const spawned = await post('/avatars', { name: 'Navigator', place: 'terrace' });
    expect(spawned.status).toBe(201);
    const avatar = (await spawned.json()) as { id: string };
    expect((await person.next('join', (m) => m.player.id === avatar.id)).player).toMatchObject({ name: 'Navigator', kind: 'agent' });

    const outcome = (await (await post(`/avatars/${avatar.id}/actions`, { action: { type: 'move_to', place: 'pool-deck' } })).json()) as {
      status: string;
      avatar: { position: number[] };
    };
    expect(outcome.status).toBe('arrived');
    const pool = ((await (await api('/places')).json()) as { places: Array<{ id: string; position: number[] }> }).places.find((p) => p.id === 'pool-deck')!;
    expect(Math.hypot(outcome.avatar.position[0] - pool.position[0], outcome.avatar.position[2] - pool.position[2])).toBeLessThan(0.6);
    await person.next('snapshot', (m) => m.players.some((p) => p.id === avatar.id && Math.hypot(p.p[0] - pool.position[0], p.p[2] - pool.position[2]) < 0.7));

    expect((await post(`/avatars/${avatar.id}/chat`, { text: 'Water looks lovely.' })).status).toBe(200);
    expect((await person.next('chat', (m) => m.entry.from === avatar.id)).entry.text).toBe('Water looks lovely.');

    const events = await readEvents(sse, (es) => es.some((e) => e.event === 'chat' && e.data.text === 'Water looks lovely.'));
    const kinds = events.map((e) => e.event);
    expect(kinds).toContain('join');
    expect(kinds.indexOf('join')).toBeLessThan(kinds.lastIndexOf('chat'));
    const ids = events.map((e) => Number(e.id));
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);

    const replay = await readEvents(await api('/events', { headers: { 'last-event-id': String(ids[0]) } }), (es) => es.some((e) => e.event === 'chat' && e.data.text === 'Water looks lovely.'));
    expect(replay.map((e) => Number(e.id))).toEqual(ids.slice(1).filter((i) => i <= Number(replay.at(-1)!.id)));
    expect((await api(`/avatars/${avatar.id}`, { method: 'DELETE' })).status).toBe(200);
    person.close();
  });

  it('reports perception, keeps avatars private to their key, and explains bad requests', async () => {
    const a = (await (await post('/avatars', { name: 'Looker', place: 'living-room' })).json()) as { id: string };
    const p = (await (await api(`/avatars/${a.id}/perception`)).json()) as { self: { area: { id: string } }; visible: unknown };
    expect(p.self.area.id).toBe('living-room');
    expect(Array.isArray(p.visible)).toBe(true);

    const other = await createKey(await member('Stranger'), 'someone else');
    expect((await post(`/avatars/${a.id}/actions`, { action: { type: 'stop' } }, other.key)).status).toBe(404);

    const bad = await post(`/avatars/${a.id}/actions`, { action: { type: 'fly', to: 'moon' } });
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { error: { message: string } }).error.message).toMatch(/action/);

    const farDoor = await post(`/avatars/${a.id}/actions`, { action: { type: 'interact', target: 'door-east' } });
    expect(farDoor.status).toBe(422);
    expect(((await farDoor.json()) as { error: { message: string } }).error.message).toMatch(/too far/i);

    expect((await api(`/avatars/${a.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await api(`/avatars/${a.id}`)).status).toBe(404);
  });

  it("refuses an agent name that is a registered person's display name", async () => {
    const r = await post('/avatars', { name: owner.account.displayName.toUpperCase() });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('name-taken');
  });

  it("revoking a key sends that key's avatars away at once", async () => {
    const k = await createKey(owner, 'revoke me');
    const [person] = await Player.join(await member('Witness'));
    const a = (await (await post('/avatars', { name: 'Ephemeral' }, k.key)).json()) as { id: string };
    await person.next('join', (m) => m.player.id === a.id);
    expect((await request(`/auth/keys/${k.info.id}`, { method: 'DELETE', cookie: owner.cookie })).status).toBe(200);
    expect((await person.next('leave', (m) => m.id === a.id)).id).toBe(a.id);
    person.close();
  });
});
