import { createHash, randomBytes } from 'node:crypto';
import type { ApiKeyRow, Store } from '../db.ts';

// API keys look like `ohk_<id>_<secret>`. Only a SHA-256 of the whole key is stored; the
// plaintext is shown once, when the key is created.

export const DEFAULT_RATE_PER_MINUTE = 120;

export function hashKey(key: string) {
  return createHash('sha256').update(key).digest('hex');
}

export function createApiKey(store: Store, name: string, ratePerMinute = DEFAULT_RATE_PER_MINUTE) {
  const id = randomBytes(4).toString('hex');
  const secret = randomBytes(24).toString('base64url');
  const key = `ohk_${id}_${secret}`;
  store.addApiKey({ id, name, hash: hashKey(key), prefix: `ohk_${id}`, ratePerMinute: Math.max(1, Math.round(ratePerMinute)) });
  return { id, key, name, ratePerMinute };
}

/** Looks a bearer token up; revoked or unknown keys give null. */
export function verifyApiKey(store: Store, token: string): ApiKeyRow | null {
  if (!/^ohk_[0-9a-f]{8}_[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const row = store.apiKeyByHash(hashKey(token));
  if (!row || row.revoked) return null;
  return row;
}

/** Token bucket per key: `ratePerMinute` sustained, bursts up to a quarter of that (min 10). */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  take(id: string, ratePerMinute: number, now = Date.now()): { ok: true; remaining: number } | { ok: false; retryAfterSeconds: number } {
    const capacity = Math.max(10, Math.round(ratePerMinute / 4));
    const perMs = ratePerMinute / 60_000;
    const b = this.buckets.get(id) ?? { tokens: capacity, at: now };
    b.tokens = Math.min(capacity, b.tokens + (now - b.at) * perMs);
    b.at = now;
    this.buckets.set(id, b);
    if (b.tokens < 1) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - b.tokens) / perMs / 1000)) };
    b.tokens -= 1;
    return { ok: true, remaining: Math.floor(b.tokens) };
  }
}
