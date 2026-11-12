import { expect, it } from "vitest";
import { loadAffiliateConfig, loadConfig } from "../../src/shared/config.js";
import { createSqliteClient } from "../support/sqlite-client.js";

it("loads the seeded configuration", async () => {
  expect(await loadConfig(createSqliteClient())).toEqual({
    threshold_pct: 15,
    query_budget: 150,
    collect_time: "06:00",
    notify_time: "07:30",
    revalidate_time: "10:45",
    publish_time: "11:00",
    categories: [{ id: "aspiradoras-robot", name: "Aspiradoras robot", terms: ["aspiradora robot"] }],
  });
});

it("reads the affiliate settings: manual and no ids by default", async () => {
  const db = createSqliteClient();
  expect(await loadAffiliateConfig(db)).toEqual({ mode: "manual", auto: null });
});

it("enables auto only when mode is auto and both ids are non-empty", async () => {
  const set = (db: ReturnType<typeof createSqliteClient>, n: string, v: string) =>
    db.run("UPDATE config SET value = ? WHERE name = ?", [v, n]);
  const db = createSqliteClient();
  await set(db, "affiliate_mode", "auto");
  expect(await loadAffiliateConfig(db)).toEqual({ mode: "auto", auto: null });
  await set(db, "affiliate_word", "w");
  await set(db, "affiliate_tool", "t");
  expect(await loadAffiliateConfig(db)).toEqual({ mode: "auto", auto: { word: "w", tool: "t" } });
  await set(db, "affiliate_mode", "manual");
  expect(await loadAffiliateConfig(db)).toEqual({ mode: "manual", auto: null });
  await set(db, "affiliate_mode", "garbage");
  expect((await loadAffiliateConfig(db)).auto).toBeNull();
});

it("falls back to manual when the rows are missing", async () => {
  const db = createSqliteClient();
  await db.run("DELETE FROM config WHERE name LIKE 'affiliate_%'");
  expect(await loadAffiliateConfig(db)).toEqual({ mode: "manual", auto: null });
});
