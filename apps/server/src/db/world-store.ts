import type { ChatEntry, ClockConfig, WeatherMode } from '@oilrig/shared';
import type { ApiKeyRow, KeyStore } from '../api/keys.ts';
import type { WorldStore } from '../world/store.ts';
import type { Database } from './database.ts';

/** How many chat lines are kept (the world replays the last 50). */
const CHAT_KEEP = 1000;

const KEY_COLUMNS =
  'id, owner_id AS ownerId, name, prefix, rate_per_minute AS ratePerMinute, created, last_used AS lastUsed, revoked';

/** The world's tables: chat, saved environment, doors and API keys. */
export class SqlWorldStore implements WorldStore, KeyStore {
  private readonly db: Database;
  private chatWrites = 0;

  constructor(db: Database) {
    this.db = db;
    db.exec(`
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
    this.db.run('INSERT INTO chat (id, player_id, name, text, t) VALUES (?, ?, ?, ?, ?)', e.id, e.from, e.name, e.text, e.t);
    if (++this.chatWrites % 100 === 0) this.db.run('DELETE FROM chat WHERE seq <= (SELECT MAX(seq) FROM chat) - ?', CHAT_KEEP);
  }

  recentChat(limit: number): ChatEntry[] {
    const rows = this.db.all<ChatEntry>('SELECT id, player_id AS "from", name, text, t FROM chat ORDER BY seq DESC LIMIT ?', limit);
    return rows.reverse().map((r) => ({ id: r.id, from: r.from, name: r.name, text: r.text, t: r.t }));
  }

  // ---------- environment ----------

  private get<T>(key: string): T | null {
    const row = this.db.get<{ value: string }>('SELECT value FROM env WHERE key = ?', key);
    return row ? (JSON.parse(row.value) as T) : null;
  }

  private put(key: string, value: unknown) {
    this.db.run('INSERT INTO env (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
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

  lastPresence() {
    return this.get<number>('presence');
  }

  saveLastPresence(t: number) {
    this.put('presence', t);
  }

  doors(): Record<string, boolean> {
    const rows = this.db.all<{ id: string; open: number }>('SELECT id, open FROM doors');
    return Object.fromEntries(rows.map((r) => [r.id, r.open === 1]));
  }

  saveDoor(id: string, open: boolean) {
    this.db.run('INSERT INTO doors (id, open) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET open = excluded.open', id, open ? 1 : 0);
  }

  // ---------- API keys ----------

  addApiKey(k: { id: string; ownerId: string; name: string; hash: string; prefix: string; ratePerMinute: number }) {
    this.db.run(
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
    return this.db.get<ApiKeyRow>(`SELECT ${KEY_COLUMNS} FROM api_keys WHERE hash = ?`, hash);
  }

  activeKeys(ownerId: string): ApiKeyRow[] {
    return this.db.all<ApiKeyRow>(`SELECT ${KEY_COLUMNS} FROM api_keys WHERE owner_id = ? AND revoked IS NULL ORDER BY created`, ownerId);
  }

  revokeApiKey(ownerId: string, id: string): boolean {
    return this.db.run('UPDATE api_keys SET revoked = ? WHERE id = ? AND owner_id = ? AND revoked IS NULL', Date.now(), id, ownerId) > 0;
  }

  touchApiKey(id: string, at: number) {
    this.db.run('UPDATE api_keys SET last_used = ? WHERE id = ?', at, id);
  }
}
