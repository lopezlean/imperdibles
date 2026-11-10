import type { SqlClient, SqlValue } from "./sql-client.js";

/** SqlClient over a Worker D1 binding. */
export function createD1BindingClient(db: D1Database): SqlClient {
  const bind = (sql: string, params: SqlValue[]) => db.prepare(sql).bind(...params);
  return {
    async all<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
      const res = await bind(sql, params).all<T>();
      return res.results;
    },
    async run(sql: string, params: SqlValue[] = []) {
      const res = await bind(sql, params).run();
      return { changes: res.meta.changes };
    },
  };
}
