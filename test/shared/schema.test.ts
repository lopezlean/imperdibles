import { describe, expect, it } from "vitest";
import { createSqliteClient } from "../support/sqlite-client.js";

async function seedParents() {
  const db = createSqliteClient();
  await db.run(
    "INSERT INTO runs (id, run_date, category, status, models_compared, queries_used, started_at) VALUES ('c1','2026-11-10','aspiradoras-robot','ok',0,0,'2026-11-10T06:00:00-03:00')",
  );
  await db.run(
    "INSERT INTO models (id, category, brand, model_code, model_key, title, created_at) VALUES ('XIAOMI:S40C','aspiradoras-robot','XIAOMI','S40C','XIAOMI:S40C','Robot S40C','2026-11-10T06:00:00-03:00')",
  );
  return db;
}

describe("schema", () => {
  it("creates every table", async () => {
    const db = createSqliteClient();
    const tables = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'")).map(
      (t) => t.name,
    );
    expect(tables).toEqual(
      expect.arrayContaining([
        "stores",
        "models",
        "store_listings",
        "price_observations",
        "matches",
        "runs",
        "candidates",
        "posts",
        "pages",
        "config",
        "ml_tokens",
      ]),
    );
  });

  it("rejects a bad candidates.status with a CHECK failure", async () => {
    const db = await seedParents();
    await expect(
      db.run(
        "INSERT INTO candidates (id, run_id, model_id, payload, status) VALUES ('x','c1','XIAOMI:S40C','{}','raro')",
      ),
    ).rejects.toThrow(/CHECK/);
    await db.run(
      "INSERT INTO candidates (id, run_id, model_id, payload, status) VALUES ('x','c1','XIAOMI:S40C','{}','pending')",
    );
  });

  it("rejects duplicates on posts(candidate_id, channel)", async () => {
    const db = await seedParents();
    await db.run(
      "INSERT INTO candidates (id, run_id, model_id, payload, status) VALUES ('x','c1','XIAOMI:S40C','{}','published')",
    );
    const ins = "INSERT INTO posts (candidate_id, channel, published_at) VALUES ('x','telegram_channel','2026-11-10T11:00:00-03:00')";
    await db.run(ins);
    await expect(db.run(ins)).rejects.toThrow(/UNIQUE/);
    await expect(
      db.run("INSERT INTO posts (candidate_id, channel, published_at) VALUES ('x','otro','2026-11-10')"),
    ).rejects.toThrow(/CHECK/);
  });

  it("rejects duplicates on matches(model_id, listing_id)", async () => {
    const db = await seedParents();
    await db.run(
      "INSERT INTO store_listings (store_id, external_ref, title, url, first_seen_at, last_seen_at) VALUES ('ml','r1','t','https://u','2026-11-10','2026-11-10')",
    );
    const pub = (await db.all<{ id: number }>("SELECT id FROM store_listings"))[0]!.id;
    const ins = `INSERT INTO matches (model_id, listing_id, confidence, rule, evidence, status, created_at) VALUES ('XIAOMI:S40C',${pub},'high','r','{}','auto','2026-11-10')`;
    await db.run(ins);
    await expect(db.run(ins)).rejects.toThrow(/UNIQUE/);
  });

  it("inserts several rows from one JSON parameter", async () => {
    const db = await seedParents();
    const rows = JSON.stringify([
      { ref: "a", t: "A" },
      { ref: "b", t: "B" },
      { ref: "c", t: "C" },
    ]);
    const res = await db.run(
      `INSERT INTO store_listings (store_id, external_ref, title, url, first_seen_at, last_seen_at)
       SELECT 'ml', json_extract(value,'$.ref'), json_extract(value,'$.t'), 'https://u', '2026-11-10', '2026-11-10' FROM json_each(?)`,
      [rows],
    );
    expect(res.changes).toBe(3);
    expect(await db.all("SELECT id FROM store_listings")).toHaveLength(3);
  });
});
