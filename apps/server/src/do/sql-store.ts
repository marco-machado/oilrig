import type { ChatEntry, ClockConfig, WeatherMode } from '@oilrig/shared';
import type { ApiKeyRow, KeyStore } from '../api/keys.ts';
import type { WorldStore } from '../world/store.ts';

/** How many chat lines are kept (the world replays the last 50). */
const CHAT_KEEP = 1000;

const KEY_COLUMNS =
  'id, owner_id AS ownerId, name, prefix, rate_per_minute AS ratePerMinute, created, last_used AS lastUsed, revoked';

/** The World DO's tables: chat, saved environment, doors and API keys. */
export class SqlWorldStore implements WorldStore, KeyStore {
  private readonly sql: SqlStorage;
  private chatWrites = 0;

  constructor(sql: SqlStorage) {
    this.sql = sql;
    sql.exec(`
      CREATE TABLE IF NOT EXISTS chat (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        name TEXT NOT NULL,
        text TEXT NOT NULL,
        t REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS env (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS doors (id TEXT PRIMARY KEY, open INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        hash TEXT NOT NULL UNIQUE,
        prefix TEXT NOT NULL,
        rate_per_minute INTEGER NOT NULL,
        created REAL NOT NULL,
        last_used REAL,
        revoked REAL
      );
      CREATE INDEX IF NOT EXISTS api_keys_owner ON api_keys (owner_id);
    `);
  }

  // ---------- chat ----------

  addChat(e: ChatEntry) {
    this.sql.exec('INSERT INTO chat (id, player_id, name, text, t) VALUES (?, ?, ?, ?, ?)', e.id, e.from, e.name, e.text, e.t);
    if (++this.chatWrites % 100 === 0) this.sql.exec('DELETE FROM chat WHERE seq <= (SELECT MAX(seq) FROM chat) - ?', CHAT_KEEP);
  }

  recentChat(limit: number): ChatEntry[] {
    const rows = this.sql
      .exec<{ id: string; from: string; name: string; text: string; t: number }>(
        'SELECT id, player_id AS "from", name, text, t FROM chat ORDER BY seq DESC LIMIT ?',
        limit,
      )
      .toArray();
    return rows.reverse().map((r) => ({ id: r.id, from: r.from, name: r.name, text: r.text, t: r.t }));
  }

  // ---------- environment ----------

  private get<T>(key: string): T | null {
    const row = this.sql.exec<{ value: string }>('SELECT value FROM env WHERE key = ?', key).toArray()[0];
    return row ? (JSON.parse(row.value) as T) : null;
  }

  private put(key: string, value: unknown) {
    this.sql.exec('INSERT INTO env (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
  }

  savedClock() {
    return this.get<{ clock: ClockConfig; base: string }>('clock');
  }

  saveClock(clock: ClockConfig, base: string) {
    this.put('clock', { clock, base });
  }

  savedWeatherMode() {
    return this.get<WeatherMode>('weather');
  }

  saveWeatherMode(mode: WeatherMode) {
    this.put('weather', mode);
  }

  doors(): Record<string, boolean> {
    const rows = this.sql.exec<{ id: string; open: number }>('SELECT id, open FROM doors').toArray();
    return Object.fromEntries(rows.map((r) => [r.id, r.open === 1]));
  }

  saveDoor(id: string, open: boolean) {
    this.sql.exec('INSERT INTO doors (id, open) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET open = excluded.open', id, open ? 1 : 0);
  }

  // ---------- API keys ----------

  addApiKey(k: { id: string; ownerId: string; name: string; hash: string; prefix: string; ratePerMinute: number }) {
    this.sql.exec(
      'INSERT INTO api_keys (id, owner_id, name, hash, prefix, rate_per_minute, created) VALUES (?, ?, ?, ?, ?, ?, ?)',
      k.id,
      k.ownerId,
      k.name,
      k.hash,
      k.prefix,
      k.ratePerMinute,
      Date.now(),
    );
  }

  apiKeyByHash(hash: string): ApiKeyRow | null {
    return this.sql.exec<ApiKeyRow>(`SELECT ${KEY_COLUMNS} FROM api_keys WHERE hash = ?`, hash).toArray()[0] ?? null;
  }

  activeKeys(ownerId: string): ApiKeyRow[] {
    return this.sql.exec<ApiKeyRow>(`SELECT ${KEY_COLUMNS} FROM api_keys WHERE owner_id = ? AND revoked IS NULL ORDER BY created`, ownerId).toArray();
  }

  revokeApiKey(ownerId: string, id: string): boolean {
    return this.sql.exec('UPDATE api_keys SET revoked = ? WHERE id = ? AND owner_id = ? AND revoked IS NULL', Date.now(), id, ownerId).rowsWritten > 0;
  }

  touchApiKey(id: string, at: number) {
    this.sql.exec('UPDATE api_keys SET last_used = ? WHERE id = ?', at, id);
  }

  /** Raw rows, for tests that check what is stored. */
  dumpApiKeyTable(): Array<Record<string, SqlStorageValue>> {
    return this.sql.exec('SELECT * FROM api_keys').toArray();
  }
}
