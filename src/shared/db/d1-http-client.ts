import { D1QueryError, D1Unavailable, type SqlClient, type SqlValue } from "./sql-client.js";

type D1Envelope = {
  success?: boolean;
  errors?: { code?: number; message?: string }[];
  result?: { results?: unknown[]; meta?: { changes?: number }; success?: boolean }[];
};

/** SqlClient over the Cloudflare D1 REST "query" endpoint, one statement per call. */
export function createD1HttpClient(cfg: {
  accountId: string;
  databaseId: string;
  apiToken: string;
  fetch?: typeof fetch;
}): SqlClient {
  const doFetch = cfg.fetch ?? fetch;
  const url = `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/d1/database/${cfg.databaseId}/query`;

  async function query(sql: string, params: SqlValue[]): Promise<NonNullable<D1Envelope["result"]>[number]> {
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sql, params }),
      });
    } catch (err) {
      throw new D1Unavailable(`D1 request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.status >= 500) throw new D1Unavailable(`D1 answered HTTP ${res.status}`);
    let body: D1Envelope;
    try {
      body = (await res.json()) as D1Envelope;
    } catch {
      throw new D1Unavailable(`D1 answered HTTP ${res.status} with an unreadable body`);
    }
    if (!body.success) {
      const msg = (body.errors ?? []).map((e) => e.message).filter(Boolean).join("; ");
      throw new D1QueryError(msg || `D1 query failed (HTTP ${res.status})`);
    }
    const first = body.result?.[0];
    if (!first) throw new D1QueryError("D1 answered without a result");
    return first;
  }

  return {
    async all<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
      return ((await query(sql, params)).results ?? []) as T[];
    },
    async run(sql: string, params: SqlValue[] = []) {
      return { changes: (await query(sql, params)).meta?.changes ?? 0 };
    },
  };
}
