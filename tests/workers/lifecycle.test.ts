import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { WorldDO } from '../../apps/server/src/do/world.ts';
import type { WorldRuntime } from '../../apps/server/src/world/runtime.ts';
import { Player, createKey, member, request } from './helpers.ts';

// The world runs only while something needs it, so the object can hibernate when the
// platform is empty; a heartbeat alarm keeps it in memory while agents walk unwatched.

const world = () => env.WORLD.getByName('world');
const state = () =>
  runInDurableObject(world(), async (instance: WorldDO, s) => {
    const runtime = (instance as unknown as { runtime: WorldRuntime | null }).runtime;
    return { booted: !!runtime, running: runtime?.running ?? false, alarm: await s.storage.getAlarm() };
  });

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

    await request(`/api/v1/avatars/${a.id}`, { method: 'DELETE', headers: auth });
    expect(await runDurableObjectAlarm(world())).toBe(true);
    expect(await state()).toMatchObject({ running: false, alarm: null });
  });
});
