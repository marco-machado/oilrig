import { describe, expect, it } from 'vitest';
import { Player, member, restart } from './helpers.ts';

// The server forgets everything in memory when it stops; what people changed is saved.

describe('world state across restarts', () => {
  it('keeps the clock, the weather mode, open doors and the chat', async () => {
    const m = await member('Keeper');
    const [p, w] = await Player.join(m);
    // Walk to the south door first: doors open only within reach.
    const to: [number, number, number] = [-6.5, 20.06, 4];
    const n = Math.ceil(Math.hypot(to[0] - w.pose.p[0], to[2] - w.pose.p[2]) / 0.075);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      p.send({ type: 'pose', seq: i, p: [w.pose.p[0] + (to[0] - w.pose.p[0]) * t, 20.06, w.pose.p[2] + (to[2] - w.pose.p[2]) * t], v: [1.5, 0, 0], yaw: 0, pitch: 0, grounded: true });
      await new Promise((r) => setTimeout(r, 50));
    }
    p.send({ type: 'door', id: 'door-south-1', open: true });
    await p.next('door', (d) => d.id === 'door-south-1' && d.open);
    p.send({ type: 'setenv', hour: 21, rate: 0, weather: 'fog' });
    const ctl = await p.next('envctl');
    p.send({ type: 'chat', text: 'Remember this.' });
    await p.next('chat', (c) => c.entry.text === 'Remember this.');
    p.close();
    await p.closed;

    await restart();

    const [again, w2] = await Player.join(m);
    expect(w2.clock).toEqual(ctl.clock);
    expect(w2.weatherMode).toBe('fog');
    expect(w2.doors['door-south-1']).toBe(true);
    expect(w2.chat.at(-1)).toMatchObject({ text: 'Remember this.', from: m.account.id });
    again.close();
  });
});
