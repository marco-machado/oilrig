import type { World } from '../world/world.ts';

// Numbered log of world events for the SSE stream. Clients that reconnect with
// Last-Event-ID get what they missed from a short ring buffer.
//
// Ids only ever grow, also across a restart of the world (which empties the buffer and would
// otherwise start counting at 1 again): each id is the time of the event in ms, or one more
// than the last id when two events share a millisecond. A client that reconnects with an id
// from before the restart is therefore sent everything logged since, not nothing.

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
  private readonly subs = new Map<(e: LoggedEvent) => void, (() => void) | undefined>();
  /** Called when a stream opens or closes (open streams keep the world running). */
  onSubscribersChange: ((count: number) => void) | null = null;
  /** Whether a new stream may open now (the runtime says no once nobody has been aboard for a long while). */
  accepting: () => boolean = () => true;

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
    const t = Date.now();
    this.seq = Math.max(this.seq + 1, t);
    const e: LoggedEvent = { id: this.seq, type, t, data };
    this.ring.push(e);
    if (this.ring.length > KEEP) this.ring.shift();
    for (const s of [...this.subs.keys()]) s(e);
  }

  /** Events after `lastId` still in the buffer. */
  since(lastId: number): LoggedEvent[] {
    return this.ring.filter((e) => e.id > lastId);
  }

  /** `onEnd` is called if the server ends the stream (see `end`). */
  subscribe(fn: (e: LoggedEvent) => void, onEnd?: () => void) {
    this.subs.set(fn, onEnd);
    this.onSubscribersChange?.(this.subs.size);
    return () => {
      if (this.subs.delete(fn)) this.onSubscribersChange?.(this.subs.size);
    };
  }

  /** Ends every open stream: the world is stopping because nobody needs it any more. */
  end() {
    const enders = [...this.subs.values()];
    this.subs.clear();
    for (const onEnd of enders) onEnd?.();
    if (enders.length) this.onSubscribersChange?.(0);
  }

  get subscribers() {
    return this.subs.size;
  }
}
