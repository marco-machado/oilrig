import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Vec3 } from '@ocean-home/shared';
import { startServer, type RunningServer } from '../apps/server/src/server.ts';
import { mulberry } from './helpers.ts';
import { WsClient } from './wsclient.ts';

let server: RunningServer;

beforeAll(async () => {
  server = await startServer({
    port: 0,
    host: '127.0.0.1',
    joinPassword: null,
    dayLengthMinutes: 120,
    realTime: false,
    timeOffsetHours: 0,
    weatherSeed: 5,
    dbPath: ':memory:',
    staticDir: null,
  });
});

afterAll(async () => {
  await server.close();
});

class Client extends WsClient {
  constructor() {
    super(server.port);
  }
}

/** Walks in small legal steps (1.5 m/s at 20 Hz) and returns the final point. */
async function walkTo(c: Client, from: Vec3, to: Vec3) {
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

describe('server', () => {
  it('survives a barrage of malformed messages and keeps serving', async () => {
    const c = new Client();
    await c.opened();
    const rand = mulberry(77);
    const junk = () => {
      const r = rand();
      if (r < 0.15) return '{not json';
      if (r < 0.3) return JSON.stringify({ type: 'pose', p: [NaN, 'x', null] });
      if (r < 0.45) return JSON.stringify({ type: 'chat', text: 'x'.repeat(5000) });
      if (r < 0.6) return JSON.stringify({ type: ['hello'], name: { a: 1 } });
      if (r < 0.7) return JSON.stringify({ type: 'door', id: 42, open: 'yes' });
      if (r < 0.8) return JSON.stringify([1, 2, 3]);
      if (r < 0.9) return JSON.stringify({ type: 'hello', version: 999, name: '' });
      return Buffer.from([0xff, 0x00, 0x13]).toString('latin1');
    };
    for (let i = 0; i < 40; i++) c.send(junk());
    await c.next('error');
    c.close();

    const ok = new Client();
    const welcome = await ok.join('After the storm');
    expect(welcome.you.name).toBe('After the storm');
    ok.send({ type: 'ping', t: 1 });
    expect((await ok.next('pong')).t).toBe(1);
    const res = await fetch(`${server.url}/healthz`);
    expect((await res.json()).ok).toBe(true);
    ok.close();
  });

  it('shares movement, chat and doors between two players, and restores a session on reconnect', async () => {
    const a = new Client();
    const b = new Client();
    const wa = await a.join('Ana');
    await b.join('Bruno');
    await a.next('join', (m) => m.player.name === 'Bruno');

    // Ana walks toward the living-room door; Bruno sees her move.
    const end = await walkTo(a, wa.pose.p, [-6.5, 20.06, 4]);
    const snap = await b.next('snapshot', (m) => m.players.some((p) => p.id === wa.you.id && Math.abs(p.p[2] - end[2]) < 0.05));
    expect(snap.players.find((p) => p.id === wa.you.id)!.p[0]).toBeCloseTo(-6.5, 1);

    // Chat reaches the other player.
    a.send({ type: 'chat', text: 'Sunset on the terrace?' });
    const chat = await b.next('chat');
    expect(chat.entry).toMatchObject({ from: wa.you.id, name: 'Ana', text: 'Sunset on the terrace?' });

    // Ana opens the door she is standing at; Bruno sees it open.
    a.send({ type: 'door', id: 'door-south-1', open: true });
    expect(await b.next('door')).toMatchObject({ id: 'door-south-1', open: true, by: wa.you.id });

    // Bruno is far away and cannot open the east door.
    b.send({ type: 'door', id: 'door-east', open: true });
    expect((await b.next('error')).code).toBe('too-far');

    // Ana drops and comes back with her session: same id, same place.
    a.close();
    expect((await b.next('leave')).id).toBe(wa.you.id);
    const again = new Client();
    const wa2 = await again.join('Ana', wa.session);
    expect(wa2.you.id).toBe(wa.you.id);
    expect(wa2.pose.p[2]).toBeCloseTo(4, 1);
    expect(wa2.doors['door-south-1']).toBe(true);
    expect(wa2.chat.some((c) => c.text === 'Sunset on the terrace?')).toBe(true);
    expect((await b.next('join')).player.id).toBe(wa.you.id);
    again.close();
    b.close();
  });

  it('corrects an impossible move back to the last accepted position', async () => {
    const c = new Client();
    const w = await c.join('Speedy');
    c.send({ type: 'pose', seq: 1, p: [40, 20, 0], v: [0, 0, 0], yaw: 0, pitch: 0, grounded: true });
    const fix = await c.next('correct');
    expect(fix.p).toEqual(w.pose.p);
    c.close();
  });
});
