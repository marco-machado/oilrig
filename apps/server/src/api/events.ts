import type { World } from '../world/world.ts';

// Numbered log of world events for the SSE stream. Clients that reconnect with
// Last-Event-ID get what they missed from a short ring buffer.

export type WorldEventType = 'join' | 'leave' | 'chat' | 'door' | 'weather' | 'drone' | 'elevator';

export interface LoggedEvent {
  id: number;
  type: WorldEventType;
  t: number;
  data: unknown;
}

const KEEP = 500;

export class EventLog {
  private seq = 0;
  private readonly ring: LoggedEvent[] = [];
  private readonly subs = new Set<(e: LoggedEvent) => void>();
  /** Called when a stream opens or closes (open streams keep the world running). */
  onSubscribersChange: ((count: number) => void) | null = null;

  constructor(world: World) {
    world.on('join', (p) => this.push('join', p));
    world.on('leave', (p) => this.push('leave', p));
    world.on('chat', (e) => this.push('chat', e));
    world.on('door', (d) => this.push('door', d));
    world.on('weather', (w) => this.push('weather', w));
    world.on('drone', (s) => this.push('drone', { phase: s.phase, since: s.t0, until: Number.isFinite(s.until) ? s.until : null, bearing: Math.round(s.bearing) }));
    world.on('elevator', (s) => this.push('elevator', { from: s.from, to: s.to, since: s.t0 }));
  }

  private push(type: WorldEventType, data: unknown) {
    const e: LoggedEvent = { id: ++this.seq, type, t: Date.now(), data };
    this.ring.push(e);
    if (this.ring.length > KEEP) this.ring.shift();
    for (const s of this.subs) s(e);
  }

  /** Events after `lastId` still in the buffer. */
  since(lastId: number): LoggedEvent[] {
    return this.ring.filter((e) => e.id > lastId);
  }

  subscribe(fn: (e: LoggedEvent) => void) {
    this.subs.add(fn);
    this.onSubscribersChange?.(this.subs.size);
    return () => {
      if (this.subs.delete(fn)) this.onSubscribersChange?.(this.subs.size);
    };
  }

  get subscribers() {
    return this.subs.size;
  }
}
