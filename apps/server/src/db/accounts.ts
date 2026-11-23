import { type Account, displayKey } from '@oilrig/shared';
import { base64url, randomBytes, sha256Hex } from '../api/keys.ts';
import { hashPassword, verifyPassword } from '../auth/password.ts';
import { colorFor } from '../world/world.ts';
import type { Database } from './database.ts';

const DAY_MS = 24 * 3600_000;
/** How long a sign-in lasts without use. */
export const SESSION_MS = 30 * DAY_MS;
/** Wrong passwords in a row before sign-in is refused for LOCK_MS. */
const MAX_FAILURES = 5;
const LOCK_MS = 60_000;

export type SignUp = { ok: true; account: Account } | { ok: false; code: 'username-taken' | 'name-taken'; message: string };
export type Rename = { ok: true; account: Account } | { ok: false; code: 'name-taken' | 'unknown-user'; message: string };

export type SignIn =
  | { ok: true; token: string; account: Account; expires: number }
  | { ok: false; code: 'bad-credentials'; message: string }
  | { ok: false; code: 'locked'; message: string; retryAfterSeconds: number };

export type SessionCheck = { account: Account; token: string; expires: number; renewed: boolean } | null;

type UserRow = {
  user_id: string;
  username: string;
  display_name: string;
  password: string;
  failures: number;
  locked_until: number;
};

const USERNAME_TAKEN = { ok: false, code: 'username-taken', message: 'That username is taken.' } as const;
const NAME_TAKEN = { ok: false, code: 'name-taken', message: 'Someone already uses that display name.' } as const;
const BAD_CREDENTIALS = { ok: false, code: 'bad-credentials', message: 'Wrong username or password.' } as const;

const account = (r: UserRow): Account => ({ id: r.user_id, username: r.username, displayName: r.display_name, color: colorFor(r.user_id) });

/** Accounts: usernames and display names (both unique), password hashes, the sign-in throttle
 * and sessions.
 *
 * Hashing is asynchronous and requests interleave, so each method does its hashing first and
 * then reads the rows again and writes without awaiting in between: what it decides on is what
 * is in the database at that moment. */
export class Accounts {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        display_key TEXT NOT NULL UNIQUE,
        created REAL NOT NULL,
        password TEXT NOT NULL,
        failures INTEGER NOT NULL DEFAULT 0,
        locked_until REAL NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sessions (
        hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created REAL NOT NULL,
        renewed REAL NOT NULL,
        expires REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
    `);
  }

  private row(userId: string) {
    return this.db.get<UserRow>('SELECT * FROM users WHERE user_id = ?', userId);
  }

  private taken(username: string, displayName: string) {
    if (this.lookup(username)) return USERNAME_TAKEN;
    if (this.isDisplayName(displayName)) return NAME_TAKEN;
    return null;
  }

  /** Creates an account. `username` is already lower-case. */
  async signUp(o: { username: string; displayName: string; password: string }): Promise<SignUp> {
    const early = this.taken(o.username, o.displayName);
    if (early) return early;
    const hash = await hashPassword(o.password);
    const late = this.taken(o.username, o.displayName);
    if (late) return late;
    const userId = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
    this.db.run(
      'INSERT INTO users (user_id, username, display_name, display_key, created, password) VALUES (?, ?, ?, ?, ?, ?)',
      userId,
      o.username,
      o.displayName,
      displayKey(o.displayName),
      Date.now(),
      hash,
    );
    return { ok: true, account: account(this.row(userId)!) };
  }

  /** The user id behind a username. */
  lookup(username: string): string | null {
    return this.db.get<{ user_id: string }>('SELECT user_id FROM users WHERE username = ?', username.toLowerCase())?.user_id ?? null;
  }

  profile(userId: string): Account | null {
    const r = this.row(userId);
    return r ? account(r) : null;
  }

  /** Whether a name is a registered display name (compared the way uniqueness is). */
  isDisplayName(name: string): boolean {
    return this.db.get('SELECT 1 FROM users WHERE display_key = ?', displayKey(name)) !== null;
  }

  rename(userId: string, displayName: string): Rename {
    const key = displayKey(displayName);
    const owner = this.db.get<{ user_id: string }>('SELECT user_id FROM users WHERE display_key = ?', key);
    if (owner && owner.user_id !== userId) return NAME_TAKEN;
    const changed = this.db.run('UPDATE users SET display_name = ?, display_key = ? WHERE user_id = ?', displayName, key, userId);
    return changed > 0 ? { ok: true, account: account(this.row(userId)!) } : { ok: false, code: 'unknown-user', message: 'No such account.' };
  }

  private locked(r: UserRow, now: number): SignIn | null {
    if (r.locked_until <= now) return null;
    const retryAfterSeconds = Math.ceil((r.locked_until - now) / 1000);
    return { ok: false, code: 'locked', message: `Too many wrong passwords. Try again in ${retryAfterSeconds} s.`, retryAfterSeconds };
  }

  async signIn(userId: string, password: string): Promise<SignIn> {
    const before = this.row(userId);
    if (!before) return BAD_CREDENTIALS;
    const early = this.locked(before, Date.now());
    if (early) return early;
    const right = await verifyPassword(password, before.password);
    const token = base64url(randomBytes(32));
    const hash = await sha256Hex(token);

    // Other sign-ins may have finished meanwhile: count this one against what is there now.
    const r = this.row(userId);
    if (!r) return BAD_CREDENTIALS;
    const now = Date.now();
    const late = this.locked(r, now);
    if (late) return late;
    if (!right || r.password !== before.password) {
      const failures = r.failures + 1;
      const lock = failures >= MAX_FAILURES;
      this.db.run('UPDATE users SET failures = ?, locked_until = ? WHERE user_id = ?', lock ? 0 : failures, lock ? now + LOCK_MS : 0, userId);
      return BAD_CREDENTIALS;
    }
    const expires = now + SESSION_MS;
    this.db.transaction(() => {
      this.db.run('UPDATE users SET failures = 0, locked_until = 0 WHERE user_id = ?', userId);
      this.db.run('DELETE FROM sessions WHERE user_id = ? AND expires <= ?', userId, now);
      this.db.run('INSERT INTO sessions (hash, user_id, created, renewed, expires) VALUES (?, ?, ?, ?, ?)', hash, userId, now, now, expires);
    });
    return { ok: true, token, account: account(r), expires };
  }

  /** The account a session token belongs to. A session is renewed at most once a day. */
  async checkSession(userId: string, token: string): Promise<SessionCheck> {
    const hash = await sha256Hex(token);
    const r = this.row(userId);
    if (!r) return null;
    const s = this.db.get<{ renewed: number; expires: number }>('SELECT renewed, expires FROM sessions WHERE hash = ? AND user_id = ?', hash, userId);
    const now = Date.now();
    if (!s || s.expires <= now) return null;
    if (now - s.renewed < DAY_MS) return { account: account(r), token, expires: s.expires, renewed: false };
    const expires = now + SESSION_MS;
    this.db.run('UPDATE sessions SET renewed = ?, expires = ? WHERE hash = ? AND user_id = ?', now, expires, hash, userId);
    return { account: account(r), token, expires, renewed: true };
  }

  async signOut(userId: string, token: string) {
    this.db.run('DELETE FROM sessions WHERE hash = ? AND user_id = ?', await sha256Hex(token), userId);
  }

  /** Needs the current password. The account's other sessions end; the one making the change stays. */
  async changePassword(userId: string, token: string, current: string, next: string): Promise<{ ok: true } | { ok: false; code: 'bad-password'; message: string }> {
    const bad = { ok: false, code: 'bad-password', message: 'Your current password is not right.' } as const;
    const before = this.row(userId);
    if (!before || !(await verifyPassword(current, before.password))) return bad;
    const password = await hashPassword(next);
    const keep = await sha256Hex(token);
    // Only the first of two changes made at once goes through: the second no longer knows the password.
    if (this.row(userId)?.password !== before.password) return bad;
    this.db.transaction(() => {
      this.db.run('UPDATE users SET password = ? WHERE user_id = ?', password, userId);
      this.db.run('DELETE FROM sessions WHERE user_id = ? AND hash != ?', userId, keep);
    });
    return { ok: true };
  }
}
