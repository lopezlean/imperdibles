import { beforeEach, describe, expect, it } from "vitest";
import { loadSiteData } from "../../site/lib/deals.js";
import { transparencyStats } from "../../site/lib/transparency.js";
import { createSqliteClient } from "../support/sqlite-client.js";
import { seedDeal } from "./support/seed-deals.js";

let db: ReturnType<typeof createSqliteClient>;
beforeEach(() => {
  db = createSqliteClient();
});

describe("transparencyStats", () => {
  it("totals compared vs published and lists days newest first", async () => {
    await seedDeal(db, { id: "a", run_date: "2026-11-10", model_id: "m1", models_compared: 40 });
    await seedDeal(db, { id: "b", run_date: "2026-11-10", model_id: "m2", models_compared: 40 });
    await seedDeal(db, { id: "c", run_date: "2026-11-12", model_id: "m3", models_compared: 60 });
    const s = transparencyStats(await loadSiteData(db));
    expect(s.compared).toBe(100);
    expect(s.published).toBe(3);
    expect(s.passPct).toBe(3);
    expect(s.days).toEqual([
      { run_date: "2026-11-12", compared: 60, published: 1 },
      { run_date: "2026-11-10", compared: 40, published: 2 },
    ]);
  });

  it("has no pass rate when nothing was compared and caps the day list", async () => {
    expect(transparencyStats(await loadSiteData(db)).passPct).toBeNull();
    for (let i = 1; i <= 40; i++) await seedDeal(db, { id: `d${i}`, run_date: `2026-10-${String(i % 28 + 1).padStart(2, "0")}`, model_id: `m${i}` });
    expect(transparencyStats(await loadSiteData(db), 5).days).toHaveLength(5);
  });
});
