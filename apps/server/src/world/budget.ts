import { type ClientMessage, NET } from '@ocean-home/shared';

type Kind = ClientMessage['type'];

/** How often one person may send each kind of message: `perSecond` sustained, `burst` at once.
 * Poses and chat have their own limits in the world; `hello` is only ever handled once. */
const LIMITS: Partial<Record<Kind, { perSecond: number; burst: number }>> = {
  // Each change is written to storage and announced to everyone aboard.
  setenv: { perSecond: 0.5, burst: 4 },
  door: { perSecond: 3, burst: 6 },
  elevator: { perSecond: 2, burst: 4 },
  board: { perSecond: 1, burst: 3 },
  unboard: { perSecond: 1, burst: 3 },
  respawn: { perSecond: 0.5, burst: 3 },
  // The client pings every two seconds.
  ping: { perSecond: 2, burst: 6 },
  // The pilot's stream, at the rate poses are sent.
  drone: { perSecond: NET.poseHz * 2, burst: NET.poseHz * 2 },
};

/** Kinds a person triggers by hand: they are told when one is dropped. */
const TELL = new Set<Kind>(['setenv', 'door', 'elevator', 'board', 'unboard']);

/** One person's message allowances: a token bucket per kind of message. */
export class MessageBudget {
  private readonly buckets = new Map<Kind, { tokens: number; at: number }>();
  private toldAt = -Infinity;

  /** Whether a message of this kind may be handled now (and counts it if so). */
  take(kind: Kind, now: number): boolean {
    const limit = LIMITS[kind];
    if (!limit) return true;
    const b = this.buckets.get(kind) ?? { tokens: limit.burst, at: now };
    b.tokens = Math.min(limit.burst, b.tokens + (Math.max(0, now - b.at) / 1000) * limit.perSecond);
    b.at = now;
    this.buckets.set(kind, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /** Whether to tell the person a message was dropped: for what they did by hand, once a second at most. */
  shouldTell(kind: Kind, now: number): boolean {
    if (!TELL.has(kind) || now - this.toldAt < 1000) return false;
    this.toldAt = now;
    return true;
  }
}
