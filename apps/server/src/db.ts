import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ChatEntry } from '@ocean-home/shared';

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  ratePerMinute: number;
  created: number;
  lastUsed: number | null;
  revoked: number | null;
}

const KEY_COLUMNS = 'id, name, prefix, rate_per_minute AS ratePerMinute, created, last_used AS lastUsed, revoked';

/** Small persistence layer: chat log, player profiles and API keys (stored hashed). */
export class Store {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS chat (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        name TEXT NOT NULL,
        text TEXT NOT NULL,
        t REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS profiles (
        name TEXT PRIMARY KEY,
        color TEXT NOT NULL,
        last_seen REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        hash TEXT NOT NULL UNIQUE,
        prefix TEXT NOT NULL,
        rate_per_minute INTEGER NOT NULL,
        created REAL NOT NULL,
        last_used REAL,
        revoked REAL
      );
    `);
  }

  addApiKey(k: { id: string; name: string; hash: string; prefix: string; ratePerMinute: number }) {
    this.db
      .prepare('INSERT INTO api_keys (id, name, hash, prefix, rate_per_minute, created) VALUES (?, ?, ?, ?, ?, ?)')
      .run(k.id, k.name, k.hash, k.prefix, k.ratePerMinute, Date.now());
  }

  apiKeyByHash(hash: string): ApiKeyRow | null {
    const row = this.db.prepare(`SELECT ${KEY_COLUMNS} FROM api_keys WHERE hash = ?`).get(hash) as ApiKeyRow | undefined;
    return row ?? null;
  }

  listApiKeys(): ApiKeyRow[] {
    return this.db.prepare(`SELECT ${KEY_COLUMNS} FROM api_keys ORDER BY created`).all() as unknown as ApiKeyRow[];
  }

  revokeApiKey(idOrPrefix: string): boolean {
    const r = this.db.prepare('UPDATE api_keys SET revoked = ? WHERE (id = ? OR prefix = ?) AND revoked IS NULL').run(Date.now(), idOrPrefix, idOrPrefix);
    return Number(r.changes) > 0;
  }

  touchApiKey(id: string) {
    this.db.prepare('UPDATE api_keys SET last_used = ? WHERE id = ?').run(Date.now(), id);
  }

  /** Raw rows, for tests that check what is stored. */
  dumpApiKeyTable(): Array<Record<string, unknown>> {
    return this.db.prepare('SELECT * FROM api_keys').all() as Array<Record<string, unknown>>;
  }

  addChat(e: ChatEntry) {
    this.db.prepare('INSERT INTO chat (id, player_id, name, text, t) VALUES (?, ?, ?, ?, ?)').run(e.id, e.from, e.name, e.text, e.t);
  }

  recentChat(limit: number): ChatEntry[] {
    const rows = this.db
      .prepare('SELECT id, player_id AS "from", name, text, t FROM chat ORDER BY seq DESC LIMIT ?')
      .all(limit) as unknown as ChatEntry[];
    return rows.reverse().map((r) => ({ id: r.id, from: r.from, name: r.name, text: r.text, t: r.t }));
  }

  touchProfile(name: string, color: string) {
    this.db
      .prepare('INSERT INTO profiles (name, color, last_seen) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET last_seen = excluded.last_seen')
      .run(name, color, Date.now());
  }

  profileColor(name: string): string | null {
    const row = this.db.prepare('SELECT color FROM profiles WHERE name = ?').get(name) as { color: string } | undefined;
    return row?.color ?? null;
  }

  close() {
    this.db.close();
  }
}
