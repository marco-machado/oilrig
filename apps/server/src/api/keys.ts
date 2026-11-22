import { MAX_KEYS_PER_USER } from '@oilrig/shared';
import { AgentError } from '../agents/manager.ts';

// API keys look like `ork_<id>_<secret>` and belong to a user. Only a SHA-256 of the whole
// key is stored; the plaintext is shown once, when the key is created.

export const DEFAULT_RATE_PER_MINUTE = 120;

export type ApiKeyRow = {
  id: string;
  ownerId: string;
  name: string;
  prefix: string;
  ratePerMinute: number;
  created: number;
  lastUsed: number | null;
  revoked: number | null;
};

export interface KeyStore {
  addApiKey(k: { id: string; ownerId: string; name: string; hash: string; prefix: string; ratePerMinute: number }): void;
  apiKeyByHash(hash: string): ApiKeyRow | null;
  /** The owner's keys that are not revoked, oldest first. */
  activeKeys(ownerId: string): ApiKeyRow[];
  /** Revokes one of the owner's keys; false if there is no such active key. */
  revokeApiKey(ownerId: string, id: string): boolean;
  touchApiKey(id: string, at: number): void;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export function base64url(bytes: Uint8Array) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export async function sha256Hex(text: string) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}

export const hashKey = sha256Hex;

/** Creates a key for a user, up to MAX_KEYS_PER_USER active at a time. */
export async function createApiKey(store: KeyStore, ownerId: string, name: string) {
  if (store.activeKeys(ownerId).length >= MAX_KEYS_PER_USER) {
    throw new AgentError('too-many-keys', `You already have ${MAX_KEYS_PER_USER} keys. Revoke one first.`, 409);
  }
  const id = hex(randomBytes(4));
  const key = `ork_${id}_${base64url(randomBytes(24))}`;
  const ratePerMinute = DEFAULT_RATE_PER_MINUTE;
  store.addApiKey({ id, ownerId, name, hash: await hashKey(key), prefix: `ork_${id}`, ratePerMinute });
  return { id, key, name, prefix: `ork_${id}`, ratePerMinute };
}

/** Looks a bearer token up; revoked or unknown keys give null. */
export async function verifyApiKey(store: KeyStore, token: string): Promise<ApiKeyRow | null> {
  if (!/^ork_[0-9a-f]{8}_[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const row = store.apiKeyByHash(await hashKey(token));
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
