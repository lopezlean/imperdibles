import { describe, expect, it } from "vitest";
import type { BudgetedHttp } from "../../../src/data/http.js";
import { enabledSecondaryStores } from "../../../src/data/stores/index.js";
import { createSqliteClient } from "../../support/sqlite-client.js";

const deps = { http: { get: async () => new Response("[]"), used: () => 0 } as unknown as BudgetedHttp, now: () => new Date("2026-11-12T09:00:00Z") };

describe("enabledSecondaryStores", () => {
  it("returns the VTEX stores seeded by the migrations, in id order, never ml or fravega", async () => {
    const db = createSqliteClient();
    expect((await enabledSecondaryStores(db, deps)).map((s) => s.id)).toEqual(["coppel", "easy", "jumbo"]);
  });

  it("skips disabled stores", async () => {
    const db = createSqliteClient();
    await db.run("UPDATE stores SET enabled = 0 WHERE id IN ('easy', 'coppel')");
    expect((await enabledSecondaryStores(db, deps)).map((s) => s.id)).toEqual(["jumbo"]);
  });

  it("ignores an enabled row that has no adapter yet", async () => {
    const db = createSqliteClient();
    await db.run("INSERT INTO stores (id, name, enabled) VALUES ('cetrogar', 'Cetrogar', 1)");
    expect((await enabledSecondaryStores(db, deps)).map((s) => s.id)).toEqual(["coppel", "easy", "jumbo"]);
  });

  it("passes the deps through, including the page cap", async () => {
    const db = createSqliteClient();
    const calls: string[] = [];
    const full = JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ productName: "A", brand: "B", link: `https://x.test/${i}/p`, items: [] })));
    const http = { get: async (u: string) => (calls.push(u), new Response(full)), used: () => 0 } as unknown as BudgetedHttp;
    const [coppel] = await enabledSecondaryStores(db, { ...deps, http, pages: 1 });
    await coppel!.search("x");
    expect(calls).toHaveLength(1);
  });
});
