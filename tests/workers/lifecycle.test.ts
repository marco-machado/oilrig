import { env, evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { WorldDO } from '../../apps/server/src/do/world.ts';
import type { WorldRuntime } from '../../apps/server/src/world/runtime.ts';
import { Player, createKey, member, readEvents, request } from './helpers.ts';

// The world runs only while something needs it, so the object can hibernate when the
// platform is empty; a heartbeat alarm keeps it in memory while agents walk unwatched.

const world = () => env.WORLD.getByName('world');
const state = () =>
  runInDurableObject(world(), async (instance: WorldDO, s) => {
    const runtime = (instance as unknown as { runtime: WorldRuntime | null }).runtime;
    return { booted: !!runtime, running: runtime?.running ?? false, alarm: await s.storage.getAlarm() };
  });

/** Makes the world believe the last person or avatar left a day ago. */
const longAgo = () =>
  runInDurableObject(world(), (instance: WorldDO) => {
    const runtime = (instance as unknown as { runtime: { lastPresence: number } }).runtime;
    runtime.lastPresence -= 24 * 3600_000;
  });

/** Takes an avatar off the platform. The response is read to the end: an unread one keeps
 * the world referenced, and it could not be restarted below. */
const remove = async (id: string, auth: Record<string, string>) =>
  void (await (await request(`/api/v1/avatars/${id}`, { method: 'DELETE', headers: auth })).arrayBuffer());

describe('world lifecycle', () => {
  it('does not boot for /healthz, runs while someone is aboard, and stops when everyone has gone', async () => {
    await request('/healthz');
    expect(await state()).toMatchObject({ booted: false, running: false, alarm: null });

    const m = await member('Visitor');
    const [p] = await Player.join(m);
    expect(await state()).toMatchObject({ booted: true, running: true });
    expect((await state()).alarm).not.toBeNull();

    // Still aboard: the heartbeat keeps going.
    expect(await runDurableObjectAlarm(world())).toBe(true);
    expect(await state()).toMatchObject({ running: true });
    expect((await state()).alarm).not.toBeNull();

    p.close();
    await p.closed;
    await new Promise((r) => setTimeout(r, 100));
    expect(await runDurableObjectAlarm(world())).toBe(true);
    expect(await state()).toMatchObject({ running: false, alarm: null });
  });

  it('keeps running for an agent nobody watches, and stops once it leaves', async () => {
    const { key } = await createKey(await member('Agent owner'));
    const auth = { authorization: `Bearer ${key}` };
    const a = (await (await request('/api/v1/avatars', { method: 'POST', headers: auth, json: { name: 'Lonely' } })).json()) as { id: string };
    expect(await state()).toMatchObject({ running: true });
    expect(await runDurableObjectAlarm(world())).toBe(true);
    expect(await state()).toMatchObject({ running: true });

    await remove(a.id, auth);
    expect(await runDurableObjectAlarm(world())).toBe(true);
    expect(await state()).toMatchObject({ running: false, alarm: null });
  });

  it('an event stream with nobody left to watch is closed after a while, and does not keep the world running', async () => {
    const { key } = await createKey(await member('Listener'));
    const auth = { authorization: `Bearer ${key}` };
    // Nobody aboard, but someone was a moment ago: a stream opens and the world runs for it.
    const sse = await request('/api/v1/events', { headers: auth });
    expect(sse.status).toBe(200);
    expect(await state()).toMatchObject({ running: true });
    expect(await runDurableObjectAlarm(world())).toBe(true);
    expect(await state()).toMatchObject({ running: true });

    // Much later, still nobody: the heartbeat stops the world and ends the stream.
    await longAgo();
    expect(await runDurableObjectAlarm(world())).toBe(true);
    expect(await state()).toMatchObject({ running: false, alarm: null });
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
    expect(await state()).toMatchObject({ running: false, alarm: null });

    // Nor does a restart of the world make it listen again: it remembers how long it has been empty.
    await evictDurableObject(world(), { webSockets: 'close' });
    expect((await request('/api/v1/events', { headers: auth })).status).toBe(204);
    expect(await state()).toMatchObject({ running: false, alarm: null });

    // Once someone is aboard there is something to watch again.
    const a = (await (await request('/api/v1/avatars', { method: 'POST', headers: auth, json: { name: 'Back' } })).json()) as { id: string };
    const again = await request('/api/v1/events', { headers: auth });
    expect(again.status).toBe(200);
    await again.body!.cancel();
    await remove(a.id, auth);
    expect(await runDurableObjectAlarm(world())).toBe(true);
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
    await longAgo();
    expect(await runDurableObjectAlarm(world())).toBe(true);
    await evictDurableObject(world(), { webSockets: 'close' });
    await spawn('After');

    // The old id is not ahead of the new log: what happened since the restart is replayed.
    const after = await readEvents(await request('/api/v1/events', { headers: { ...auth, 'last-event-id': String(lastId) } }), joined('After'));
    expect(joined('After')(after)).toBe(true);
    for (const e of after) expect(Number(e.id)).toBeGreaterThan(lastId);
    const [mine] = (await (await request('/api/v1/avatars', { headers: auth })).json() as { avatars: Array<{ id: string }> }).avatars;
    await remove(mine.id, auth);
    await longAgo();
    expect(await runDurableObjectAlarm(world())).toBe(true);
  });
});
