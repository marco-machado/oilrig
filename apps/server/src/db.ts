import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ChatEntry } from '@ocean-home/shared';

/** Small persistence layer: chat log and player profiles. */
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
    `);
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
