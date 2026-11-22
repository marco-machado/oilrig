import { DurableObject } from 'cloudflare:workers';
import { displayKey } from '@oilrig/shared';

export type Registration = { ok: true; userId: string } | { ok: false; code: 'username-taken' | 'name-taken'; message: string };
export type Rename = { ok: true } | { ok: false; code: 'name-taken' | 'unknown-user'; message: string };

const NAME_TAKEN = 'Someone already uses that display name.';

/** The registry of accounts (one instance, named "directory"): keeps usernames and display
 * names unique and finds a user's id from their username. Each user's own data lives in their
 * UserDO. */
export class DirectoryDO extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        display_key TEXT NOT NULL UNIQUE,
        created REAL NOT NULL
      );
    `);
  }

  /** Reserves a username and display name for a new account. `username` is already lower-case. */
  register(username: string, displayName: string): Registration {
    if (this.lookup(username)) return { ok: false, code: 'username-taken', message: 'That username is taken.' };
    if (this.isDisplayName(displayName)) return { ok: false, code: 'name-taken', message: NAME_TAKEN };
    const userId = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
    this.sql.exec(
      'INSERT INTO users (user_id, username, display_name, display_key, created) VALUES (?, ?, ?, ?, ?)',
      userId,
      username,
      displayName,
      displayKey(displayName),
      Date.now(),
    );
    return { ok: true, userId };
  }

  /** Undoes a registration whose account could not be created. */
  release(userId: string) {
    this.sql.exec('DELETE FROM users WHERE user_id = ?', userId);
  }

  lookup(username: string): string | null {
    const row = this.sql.exec<{ user_id: string }>('SELECT user_id FROM users WHERE username = ?', username.toLowerCase()).toArray()[0];
    return row?.user_id ?? null;
  }

  rename(userId: string, displayName: string): Rename {
    const key = displayKey(displayName);
    const owner = this.sql.exec<{ user_id: string }>('SELECT user_id FROM users WHERE display_key = ?', key).toArray()[0];
    if (owner && owner.user_id !== userId) return { ok: false, code: 'name-taken', message: NAME_TAKEN };
    const r = this.sql.exec('UPDATE users SET display_name = ?, display_key = ? WHERE user_id = ?', displayName, key, userId);
    return r.rowsWritten > 0 ? { ok: true } : { ok: false, code: 'unknown-user', message: 'No such account.' };
  }

  /** Whether a name is a registered display name (compared the way uniqueness is). */
  isDisplayName(name: string): boolean {
    return this.sql.exec('SELECT 1 FROM users WHERE display_key = ?', displayKey(name)).toArray().length > 0;
  }
}
