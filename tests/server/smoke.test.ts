import { describe, expect, it } from 'vitest';
import { request, server } from './helpers.ts';

describe('server', () => {
  it('answers /healthz without booting the world', async () => {
    const r = await request('/healthz');
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, players: 0, agents: 0 });
    expect(server.booted).toBe(false);
  });
});
