import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { D1QueryError, D1Unavailable } from "../../src/shared/db/sql-client.js";
import { createD1HttpClient } from "../../src/shared/db/d1-http-client.js";

const fixture = (n: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "cloudflare", n), "utf8");
const cfg = { accountId: "ACC", databaseId: "DB", apiToken: "TOKEN" };

function fake(body: string, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(body, { status });
  }) as typeof fetch;
  return { calls, fetchFn };
}

describe("createD1HttpClient", () => {
  it("posts the query with auth and returns rows", async () => {
    const { calls, fetchFn } = fake(fixture("d1-query-ok.json"));
    const rows = await createD1HttpClient({ ...cfg, fetch: fetchFn }).all("SELECT 1");
    expect(calls[0]!.url).toBe("https://api.cloudflare.com/client/v4/accounts/ACC/d1/database/DB/query");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN");
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.body).toBe('{"sql":"SELECT 1","params":[]}');
    expect(rows).toEqual([
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ]);
  });

  it("run returns the change count", async () => {
    const { fetchFn } = fake(fixture("d1-query-ok.json"));
    expect(await createD1HttpClient({ ...cfg, fetch: fetchFn }).run("DELETE FROM x")).toEqual({ changes: 2 });
  });

  it("maps success:false to D1QueryError", async () => {
    const { fetchFn } = fake(fixture("d1-query-error.json"), 400);
    await expect(createD1HttpClient({ ...cfg, fetch: fetchFn }).all("SELECT * FROM nope")).rejects.toBeInstanceOf(
      D1QueryError,
    );
  });

  it("maps network failures and 5xx to D1Unavailable", async () => {
    const boom = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(createD1HttpClient({ ...cfg, fetch: boom }).all("SELECT 1")).rejects.toBeInstanceOf(D1Unavailable);
    const { fetchFn } = fake("oops", 503);
    await expect(createD1HttpClient({ ...cfg, fetch: fetchFn }).run("SELECT 1")).rejects.toBeInstanceOf(
      D1Unavailable,
    );
  });
});
