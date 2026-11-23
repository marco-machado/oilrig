import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';

/** The server's one SQLite database, with its statements prepared once. Every call is
 * synchronous, so a function that does not await between its reads and writes is atomic. */
export class Database {
  readonly raw: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();

  /** `dataDir` is a directory (the file is `oilrig.db` in it), or `:memory:`. */
  constructor(dataDir: string) {
    if (dataDir === ':memory:') {
      this.raw = new DatabaseSync(':memory:');
    } else {
      mkdirSync(dataDir, { recursive: true });
      this.raw = new DatabaseSync(path.join(dataDir, 'oilrig.db'));
      this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    }
  }

  private statement(sql: string) {
    let s = this.statements.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.statements.set(sql, s);
    }
    return s;
  }

  exec(sql: string) {
    this.raw.exec(sql);
  }

  all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.statement(sql).all(...params) as T[];
  }

  get<T>(sql: string, ...params: SQLInputValue[]): T | null {
    return (this.statement(sql).get(...params) as T | undefined) ?? null;
  }

  /** Runs a write; returns how many rows it changed. */
  run(sql: string, ...params: SQLInputValue[]): number {
    return Number(this.statement(sql).run(...params).changes);
  }

  /** Several writes that land together or not at all. `fn` must not await. */
  transaction<T>(fn: () => T): T {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      return result;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    }
  }

  close() {
    this.statements.clear();
    this.raw.close();
  }
}
