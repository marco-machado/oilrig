import { describe, expect, it } from 'vitest';
import { CLOSE, PROTOCOL_VERSION, type Vec3 } from '@ocean-home/shared';
import { Player, member, request } from './helpers.ts';

// The game socket through the Worker into the World DO, as browsers use it.

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Walks in small legal steps (1.5 m/s at 20 Hz) and returns the final point. */
async function walkTo(c: Player, from: Vec3, to: Vec3) {
  const dist = Math.hypot(to[0] - from[0], to[2] - from[2]);
  const n = Math.max(1, Math.ceil(dist / 0.075));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const p: Vec3 = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
    c.send({ type: 'pose', seq: i, p, v: [1.5, 0, 0], yaw: 0, pitch: 0, grounded: true });
    await new Promise((r) => setTimeout(r, 50));
  }
  return to;
}

describe('world socket', () => {
  it('refuses a socket without a session (4401) and one from another site (403)', async () => {
    const anon = await Player.connect();
    expect((await anon.next('error')).code).toBe('signed-out');
    expect((await anon.closed).code).toBe(CLOSE.unauthorized);

    const m = await member('Origin');
    const cross = await request('/ws', { headers: { upgrade: 'websocket', origin: 'https://evil.example' }, cookie: m.cookie });
    expect(cross.status).toBe(403);
  });

  it('survives a barrage of malformed messages and keeps serving', async () => {
    const m = await member('Storm');
    const c = await Player.connect(m.cookie);
    const rand = mulberry(77);
    const junk = () => {
      const r = rand();
      if (r < 0.15) return '{not json';
      if (r < 0.3) return JSON.stringify({ type: 'pose', p: [NaN, 'x', null] });
      if (r < 0.45) return JSON.stringify({ type: 'chat', text: 'x'.repeat(5000) });
      if (r < 0.6) return JSON.stringify({ type: ['hello'], name: { a: 1 } });
      if (r < 0.7) return JSON.stringify({ type: 'door', id: 42, open: 'yes' });
      if (r < 0.8) return JSON.stringify([1, 2, 3]);
      if (r < 0.9) return JSON.stringify({ type: 'hello', version: 999 });
      return String.fromCharCode(0xff, 0x00, 0x13);
    };
    for (let i = 0; i < 40; i++) c.send(junk());
    await c.next('error');
    c.close();

    const [ok, welcome] = await Player.join(m);
    expect(welcome.you).toMatchObject({ id: m.account.id, name: m.account.displayName, kind: 'human' });
    ok.send({ type: 'ping', t: 1 });
    expect((await ok.next('pong')).t).toBe(1);
    expect(((await (await request('/healthz')).json()) as { ok: boolean }).ok).toBe(true);
    ok.close();
  });

  it('shares movement, chat and doors between two people, and puts them back where they were on reconnect', async () => {
    const ana = await member('Ana');
    const bruno = await member('Bruno');
    const [a, wa] = await Player.join(ana);
    const [b] = await Player.join(bruno);
    await a.next('join', (m) => m.player.id === bruno.account.id);

    const end = await walkTo(a, wa.pose.p, [-6.5, 20.06, 4]);
    const snap = await b.next('snapshot', (m) => m.players.some((p) => p.id === ana.account.id && Math.abs(p.p[2] - end[2]) < 0.05));
    expect(snap.players.find((p) => p.id === ana.account.id)!.p[0]).toBeCloseTo(-6.5, 1);

    a.send({ type: 'chat', text: 'Sunset on the terrace?' });
    const chat = await b.next('chat', (m) => m.entry.from === ana.account.id);
    expect(chat.entry).toMatchObject({ name: ana.account.displayName, text: 'Sunset on the terrace?' });

    a.send({ type: 'door', id: 'door-south-1', open: true });
    expect(await b.next('door', (m) => m.id === 'door-south-1')).toMatchObject({ open: true, by: ana.account.id });

    b.send({ type: 'door', id: 'door-east', open: true });
    expect((await b.next('error')).code).toBe('too-far');

    // Ana drops and comes back: same id, same place, the door and the chat still there.
    a.close();
    expect((await b.next('leave', (m) => m.id === ana.account.id)).id).toBe(ana.account.id);
    const [again, wa2] = await Player.join(ana);
    expect(wa2.you.id).toBe(ana.account.id);
    expect(wa2.pose.p[2]).toBeCloseTo(4, 1);
    expect(wa2.doors['door-south-1']).toBe(true);
    expect(wa2.chat.some((c) => c.text === 'Sunset on the terrace?')).toBe(true);
    expect((await b.next('join', (m) => m.player.id === ana.account.id)).player.id).toBe(ana.account.id);

    // Close the door again for the other tests.
    again.send({ type: 'door', id: 'door-south-1', open: false });
    await b.next('door', (m) => m.id === 'door-south-1' && !m.open);
    again.close();
    b.close();
  });

  it('corrects an impossible move back to the last accepted position', async () => {
    const [c, w] = await Player.join(await member('Speedy'));
    c.send({ type: 'pose', seq: 1, p: [40, 20, 0], v: [0, 0, 0], yaw: 0, pitch: 0, grounded: true });
    expect((await c.next('correct')).p).toEqual(w.pose.p);
    c.close();
  });

  it('newest connection wins: the older one is told and closed, nobody sees a leave', async () => {
    const watcher = await member('Watcher');
    const twin = await member('Twin');
    const [w] = await Player.join(watcher);
    const [first] = await Player.join(twin);
    await w.next('join', (m) => m.player.id === twin.account.id);

    const [second, welcome] = await Player.join(twin);
    expect(welcome.you.id).toBe(twin.account.id);
    expect((await first.next('error')).code).toBe('replaced');
    expect((await first.closed).code).toBe(CLOSE.replaced);

    // The new connection is the player now: it moves, chats, and the watcher sees it.
    second.send({ type: 'chat', text: 'Still me.' });
    expect((await w.next('chat', (m) => m.entry.from === twin.account.id)).entry.text).toBe('Still me.');
    await new Promise((r) => setTimeout(r, 300));
    expect(w.inbox.some((m) => m.type === 'leave' && m.id === twin.account.id)).toBe(false);
    second.close();
    w.close();
  });

  it('a new display name shows for everyone at once; old chat lines keep the old one', async () => {
    const lia = await member('Lia');
    const ref = await member('Ref');
    const [l] = await Player.join(lia);
    const [r] = await Player.join(ref);
    l.send({ type: 'chat', text: 'Before.' });
    await r.next('chat', (m) => m.entry.text === 'Before.');

    const name = `Lia New ${Date.now() % 10000}`;
    const res = await request('/auth/me', { method: 'PATCH', cookie: lia.cookie, json: { displayName: name } });
    expect(res.status).toBe(200);
    expect((await r.next('player', (m) => m.player.id === lia.account.id)).player.name).toBe(name);
    expect((await l.next('player', (m) => m.player.id === lia.account.id)).player.name).toBe(name);

    l.send({ type: 'chat', text: 'After.' });
    expect((await r.next('chat', (m) => m.entry.text === 'After.')).entry.name).toBe(name);
    l.close();
    const [l2, w2] = await Player.join({ ...lia });
    expect(w2.you.name).toBe(name);
    const lines = w2.chat.filter((c) => c.from === lia.account.id);
    expect(lines.find((c) => c.text === 'Before.')!.name).toBe(lia.account.displayName);
    expect(lines.find((c) => c.text === 'After.')!.name).toBe(name);
    l2.close();
    r.close();

    // Someone else's name is taken.
    expect((await request('/auth/me', { method: 'PATCH', cookie: ref.cookie, json: { displayName: name.toLowerCase() } })).status).toBe(409);
  });

  it('speaks protocol version 3 only', async () => {
    const m = await member('Old');
    const c = await Player.connect(m.cookie);
    c.send({ type: 'hello', version: PROTOCOL_VERSION - 1, name: 'Old client' });
    expect((await c.next('error')).code).toBe('bad-message');
    c.close();
  });
});
