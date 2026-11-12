import { createD1HttpClient } from "../../src/shared/db/d1-http-client.js";
import type { SqlClient, SqlValue } from "../../src/shared/db/sql-client.js";
import { loadLocalEnv } from "../../src/shared/env.js";

/**
 * Database the build reads from: a read-only SQLite file when SITE_FIXTURE_DB is set
 * (smoke tests), otherwise production D1 over HTTP.
 */
export async function openSiteDb(env: Record<string, string | undefined>): Promise<SqlClient> {
  if (env.SITE_FIXTURE_DB) {
    const { default: Database } = await import("better-sqlite3");
    const raw = new Database(env.SITE_FIXTURE_DB, { readonly: true });
    return {
      async all<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
        return raw.prepare(sql).all(...params) as T[];
      },
      async run(sql: string, params: SqlValue[] = []) {
        return { changes: raw.prepare(sql).run(...params).changes };
      },
    };
  }
  const local = loadLocalEnv(env, ["cfAccountId", "cfApiToken", "d1DatabaseId"]);
  return createD1HttpClient({ accountId: local.cfAccountId, databaseId: local.d1DatabaseId, apiToken: local.cfApiToken });
}
