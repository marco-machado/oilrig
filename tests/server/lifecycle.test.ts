import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { connect } from 'node:net';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@oilrig/shared';
import { Player, createKey, member, readEvents, request, restart, server, startTestServer } from './helpers.ts';

// The world is built on first need and simulates only while something needs it: a timer
// (`checkIdle`, every 30 s in a running server) stops the clocks once the platform is empty.

const state = () => ({ booted: server.booted, running: server.running });

/** Makes the world believe the last person or avatar left a day ago. */
const longAgo = () => {
  (server.runtime as unknown as { lastPresence: number }).lastPresence -= 24 * 3600_000;
};

/** Takes an avatar off the platform. */
const remove = async (id: string, auth: Record<string, string>) =>
  void (await (await request(`/api/v1/avatars/${id}`, { method: 'DELETE', headers: auth })).arrayBuffer());

describe('world lifecycle', () => {
  it('does not boot for /healthz, runs while someone is aboard, and stops when everyone has gone', async () => {
    await request('/healthz');
    expect(state()).toMatchObject({ booted: false, running: false });

    const m = await member('Visitor');
    const [p] = await Player.join(m);
    expect(state()).toMatchObject({ booted: true, running: true });

    // Still aboard: the check leaves it running.
    server.checkIdle();
    expect(state()).toMatchObject({ running: true });

    p.close();
    await p.closed;
    await new Promise((r) => setTimeout(r, 100));
    server.checkIdle();
    expect(state()).toMatchObject({ running: false });
  });

  it('keeps running for an agent nobody watches, and stops once it leaves', async () => {
    const { key } = await createKey(await member('Agent owner'));
    const auth = { authorization: `Bearer ${key}` };
    const a = (await (await request('/api/v1/avatars', { method: 'POST', headers: auth, json: { name: 'Lonely' } })).json()) as { id: string };
    expect(state()).toMatchObject({ running: true });
    server.checkIdle();
    expect(state()).toMatchObject({ running: true });

    await remove(a.id, auth);
    server.checkIdle();
    expect(state()).toMatchObject({ running: false });
  });

  it('an event stream with nobody left to watch is closed after a while, and does not keep the world running', async () => {
    const { key } = await createKey(await member('Listener'));
    const auth = { authorization: `Bearer ${key}` };
    // Nobody aboard, but someone was a moment ago: a stream opens and the world runs for it.
    const sse = await request('/api/v1/events', { headers: auth });
    expect(sse.status).toBe(200);
    expect(state()).toMatchObject({ running: true });
    server.checkIdle();
    expect(state()).toMatchObject({ running: true });

    // Much later, still nobody: the check stops the world and ends the stream.
    longAgo();
    server.checkIdle();
    expect(state()).toMatchObject({ running: false });
    const reader = sse.body!.getReader();
    let text = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    expect(text).toContain(': nobody aboard');

    // Reconnecting gets "nothing to stream" (an EventSource stops there) and starts nothing.
    expect((await request('/api/v1/events', { headers: auth })).status).toBe(204);
    expect(state()).toMatchObject({ running: false });

    // Nor does a restart of the world make it listen again: it remembers how long it has been empty.
    await restart();
    expect((await request('/api/v1/events', { headers: auth })).status).toBe(204);
    expect(state()).toMatchObject({ running: false });

    // Once someone is aboard there is something to watch again.
    const a = (await (await request('/api/v1/avatars', { method: 'POST', headers: auth, json: { name: 'Back' } })).json()) as { id: string };
    const again = await request('/api/v1/events', { headers: auth });
    expect(again.status).toBe(200);
    await again.body!.cancel();
    await remove(a.id, auth);
    server.checkIdle();
  });

  it('event ids keep growing across a restart, so a reconnect with an old id is sent what happened since', async () => {
    const { key } = await createKey(await member('Replayer'));
    const auth = { authorization: `Bearer ${key}` };
    const spawn = async (name: string) => ((await (await request('/api/v1/avatars', { method: 'POST', headers: auth, json: { name } })).json()) as { id: string }).id;
    const joined = (name: string) => (es: Array<{ event: string; data: { name?: string } }>) => es.some((e) => e.event === 'join' && e.data.name === name);

    // Several events before the restart; remember the id of the last one.
    for (const name of ['One', 'Two', 'Three']) await remove(await spawn(name), auth);
    const last = await spawn('Before');
    const before = await readEvents(await request('/api/v1/events', { headers: { ...auth, 'last-event-id': '0' } }), joined('Before'));
    const lastId = Number(before.at(-1)!.id);
    expect(before.length).toBeGreaterThan(6);
    await remove(last, auth);

    // The world stops, restarts and has forgotten its log.
    longAgo();
    server.checkIdle();
    await restart();
    await spawn('After');

    // The old id is not ahead of the new log: what happened since the restart is replayed.
    const after = await readEvents(await request('/api/v1/events', { headers: { ...auth, 'last-event-id': String(lastId) } }), joined('After'));
    expect(joined('After')(after)).toBe(true);
    for (const e of after) expect(Number(e.id)).toBeGreaterThan(lastId);
    const [mine] = (await (await request('/api/v1/avatars', { headers: auth })).json() as { avatars: Array<{ id: string }> }).avatars;
    await remove(mine.id, auth);
    longAgo();
    server.checkIdle();
  });

  it('stops within the grace period with a stream open and an agent on its way, and a new server finds what was saved', async () => {
    const { key } = await createKey(await member('Stopper'));
    const auth = { authorization: `Bearer ${key}` };
    const a = (await (await request('/api/v1/avatars', { method: 'POST', headers: auth, json: { name: 'Walker', place: 'terrace' } })).json()) as { id: string };
    const sse = await request('/api/v1/events', { headers: auth });
    const walking = request(`/api/v1/avatars/${a.id}/actions`, { method: 'POST', headers: auth, json: { action: { type: 'move_to', place: 'helipad' } } });
    const [person] = await Player.join(await member('Aboard'));
    await new Promise((r) => setTimeout(r, 300));

    const t0 = Date.now();
    await restart();
    expect(Date.now() - t0).toBeLessThan(4000);
    // The request waiting on the walk was answered, the stream ended and the socket was closed.
    expect((await walking).status).toBe(200);
    expect(await sse.text()).toContain(': nobody aboard');
    expect((await person.closed).code).toBe(1001);
    expect((await request('/healthz')).status).toBe(200);
    expect(state()).toMatchObject({ booted: false });
  });
});

describe('a connection that drops', () => {
  it('while the world is being built for its socket does not take the server down', async () => {
    const cold = await startTestServer();
    try {
      const res = await request('/auth/signup', { server: cold, method: 'POST', json: { username: `drop-${Date.now().toString(36)}`, displayName: 'Dropper', password: 'long enough' } });
      const cookie = /oilrig_session=[^;]*/.exec(res.headers.get('set-cookie')!)![0];
      for (let i = 0; i < 3; i++) {
        const socket = connect(cold.port, 'localhost');
        await new Promise((r) => socket.once('connect', r));
        socket.on('error', () => {});
        socket.write(`GET /ws HTTP/1.1\r\nHost: localhost:${cold.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nCookie: ${cookie}\r\n\r\n`);
        // Reset, not closed, while the server is still answering.
        await new Promise((r) => setTimeout(r, 5 * i));
        socket.resetAndDestroy();
      }
      await new Promise((r) => setTimeout(r, 1500));
      expect((await request('/healthz', { server: cold })).status).toBe(200);
      const p = await Player.connect(cookie, {}, cold);
      p.send({ type: 'hello', version: PROTOCOL_VERSION });
      await p.next('welcome');
      p.close();
    } finally {
      await cold.close();
    }
  });
});

describe('the built client', () => {
  it('serves each page at its address, the game for unknown ones, and 404 for missing files and endpoints', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'oilrig-client-'));
    for (const page of ['index', 'signup', 'viewer']) writeFileSync(path.join(dir, `${page}.html`), `<title>${page}</title>`);
    mkdirSync(path.join(dir, 'assets'));
    writeFileSync(path.join(dir, 'assets', 'main-abc123.js'), 'export {};');
    const site = await startTestServer({ STATIC_DIR: dir });
    try {
      const get = (p: string) => request(p, { server: site });
      for (const [address, page] of [['/', 'index'], ['/signup', 'signup'], ['/signup.html', 'signup'], ['/viewer', 'viewer'], ['/some/room', 'index']]) {
        const res = await get(address);
        expect(res.status, address).toBe(200);
        expect(res.headers.get('content-type'), address).toMatch(/text\/html/);
        expect(res.headers.get('cache-control'), address).toBe('no-cache');
        expect(await res.text(), address).toBe(`<title>${page}</title>`);
      }
      const asset = await get('/assets/main-abc123.js');
      expect(asset.headers.get('cache-control')).toMatch(/immutable/);
      expect(asset.headers.get('content-type')).toMatch(/javascript/);
      for (const missing of ['/assets/gone-000000.js', '/sfx/nothing.ogg', '/auth/nothing', '/api/nothing']) {
        const res = await get(missing);
        expect(res.status, missing).toBe(404);
        expect(res.headers.get('cache-control'), missing).toBeNull();
        await res.arrayBuffer();
      }
    } finally {
      await site.close();
    }
  });
});
