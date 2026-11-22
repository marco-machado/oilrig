import { DurableObject } from 'cloudflare:workers';
import type { Account } from '@oilrig/shared';
import { base64url, randomBytes, sha256Hex } from '../api/keys.ts';
import { hashPassword, verifyPassword } from '../auth/password.ts';
import { colorFor } from '../world/world.ts';

const DAY_MS = 24 * 3600_000;
/** How long a sign-in lasts without use. */
export const SESSION_MS = 30 * DAY_MS;
/** Wrong passwords in a row before sign-in is refused for LOCK_MS. */
const MAX_FAILURES = 5;
const LOCK_MS = 60_000;

export type SignIn =
  | { ok: true; token: string; account: Account; expires: number }
  | { ok: false; code: 'bad-credentials'; message: string }
  | { ok: false; code: 'locked'; message: string; retryAfterSeconds: number };

export type SessionCheck = { account: Account; token: string; expires: number; renewed: boolean } | null;

type ProfileRow = {
  user_id: string;
  username: string;
  display_name: string;
  created: number;
  password: string;
};

/** One account (named by its user id): profile, password hash, sessions and the sign-in throttle. */
export class UserDO extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS profile (
        user_id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        display_name TEXT NOT NULL,
        created REAL NOT NULL,
        password TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        hash TEXT PRIMARY KEY,
        created REAL NOT NULL,
        renewed REAL NOT NULL,
        expires REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS throttle (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        failures INTEGER NOT NULL,
        locked_until REAL NOT NULL
      );
    `);
  }

  private row(): ProfileRow | null {
    return this.sql.exec<ProfileRow>('SELECT * FROM profile').toArray()[0] ?? null;
  }

  private account(r: ProfileRow): Account {
    return { id: r.user_id, username: r.username, displayName: r.display_name, color: colorFor(r.user_id) };
  }

  /** Sets up a new account (the directory has already reserved its names). */
  async create(o: { userId: string; username: string; displayName: string; password: string }): Promise<Account> {
    if (this.row()) throw new Error('account already exists');
    const hash = await hashPassword(o.password);
    this.sql.exec(
      'INSERT INTO profile (user_id, username, display_name, created, password) VALUES (?, ?, ?, ?, ?)',
      o.userId,
      o.username,
      o.displayName,
      Date.now(),
      hash,
    );
    return this.account(this.row()!);
  }

  profile(): Account | null {
    const r = this.row();
    return r ? this.account(r) : null;
  }

  async signIn(password: string): Promise<SignIn> {
    const r = this.row();
    const bad = { ok: false, code: 'bad-credentials', message: 'Wrong username or password.' } as const;
    if (!r) return bad;
    const now = Date.now();
    const t = this.sql.exec<{ failures: number; locked_until: number }>('SELECT failures, locked_until FROM throttle').toArray()[0] ?? { failures: 0, locked_until: 0 };
    if (t.locked_until > now) {
      const retryAfterSeconds = Math.ceil((t.locked_until - now) / 1000);
      return { ok: false, code: 'locked', message: `Too many wrong passwords. Try again in ${retryAfterSeconds} s.`, retryAfterSeconds };
    }
    if (!(await verifyPassword(password, r.password))) {
      const failures = t.failures + 1;
      const locked = failures >= MAX_FAILURES;
      this.sql.exec(
        'INSERT INTO throttle (id, failures, locked_until) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET failures = excluded.failures, locked_until = excluded.locked_until',
        locked ? 0 : failures,
        locked ? now + LOCK_MS : 0,
      );
      return bad;
    }
    this.sql.exec('DELETE FROM throttle');
    this.sql.exec('DELETE FROM sessions WHERE expires <= ?', now);
    const { token, expires } = await this.newSession(now);
    return { ok: true, token, account: this.account(r), expires };
  }

  private async newSession(now: number) {
    const token = base64url(randomBytes(32));
    const expires = now + SESSION_MS;
    this.sql.exec('INSERT INTO sessions (hash, created, renewed, expires) VALUES (?, ?, ?, ?)', await sha256Hex(token), now, now, expires);
    return { token, expires };
  }

  /** The account a session token belongs to. A session is renewed at most once a day. */
  async checkSession(token: string): Promise<SessionCheck> {
    const r = this.row();
    if (!r) return null;
    const hash = await sha256Hex(token);
    const s = this.sql.exec<{ renewed: number; expires: number }>('SELECT renewed, expires FROM sessions WHERE hash = ?', hash).toArray()[0];
    const now = Date.now();
    if (!s || s.expires <= now) return null;
    if (now - s.renewed < DAY_MS) return { account: this.account(r), token, expires: s.expires, renewed: false };
    const expires = now + SESSION_MS;
    this.sql.exec('UPDATE sessions SET renewed = ?, expires = ? WHERE hash = ?', now, expires, hash);
    return { account: this.account(r), token, expires, renewed: true };
  }

  async signOut(token: string) {
    this.sql.exec('DELETE FROM sessions WHERE hash = ?', await sha256Hex(token));
  }

  /** Needs the current password. Every other session ends; the one making the change stays. */
  async changePassword(token: string, current: string, next: string): Promise<{ ok: true } | { ok: false; code: 'bad-password'; message: string }> {
    const r = this.row();
    if (!r || !(await verifyPassword(current, r.password))) return { ok: false, code: 'bad-password', message: 'Your current password is not right.' };
    this.sql.exec('UPDATE profile SET password = ?', await hashPassword(next));
    this.sql.exec('DELETE FROM sessions WHERE hash != ?', await sha256Hex(token));
    return { ok: true };
  }

  setDisplayName(name: string): Account | null {
    this.sql.exec('UPDATE profile SET display_name = ?', name);
    return this.profile();
  }
}
