import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openSiteDb } from "../../site/lib/db.js";
import { createSqliteClient } from "../support/sqlite-client.js";

describe("openSiteDb", () => {
  it("opens a read-only SQLite fixture when SITE_FIXTURE_DB is set", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "site-db-")), "fixture.db");
    writeFileSync(file, createSqliteClient().raw.serialize());

    const db = await openSiteDb({ SITE_FIXTURE_DB: file });

    const [row] = await db.all<{ n: number }>("SELECT COUNT(*) AS n FROM stores");
    expect(row?.n).toBeGreaterThan(0);
    await expect(db.run("DELETE FROM stores")).rejects.toThrow();
  });

  it("names the missing D1 variables", async () => {
    await expect(openSiteDb({})).rejects.toThrow(/D1_ACCOUNT_ID.*D1_API_TOKEN.*D1_DATABASE_ID/);
  });
});
