import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type { SqlClient, SqlValue } from "../../src/shared/db/sql-client.js";

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

/** In-memory SQLite with every migrations/*.sql applied in name order. */
export function createSqliteClient(): SqlClient & { raw: Database.Database } {
  const raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    raw.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  return {
    raw,
    async all<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
      return raw.prepare(sql).all(...params) as T[];
    },
    async run(sql: string, params: SqlValue[] = []) {
      return { changes: raw.prepare(sql).run(...params).changes };
    },
  };
}
