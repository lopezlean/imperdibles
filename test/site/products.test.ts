import { beforeEach, describe, expect, it } from "vitest";
import { loadSiteData } from "../../site/lib/deals.js";
import { buildProducts, categoryProducts, CATEGORY_LIMIT, isStale } from "../../site/lib/products.js";
import { createSqliteClient } from "../support/sqlite-client.js";
import { seedDeal } from "./support/seed-deals.js";

let db: ReturnType<typeof createSqliteClient>;
beforeEach(() => {
  db = createSqliteClient();
});

const products = async () => buildProducts(await loadSiteData(db));

describe("buildProducts", () => {
  it("gives one product per model with its latest deal on top and one history row per day", async () => {
    await seedDeal(db, { id: "a", run_date: "2026-11-10", model_id: "HP:I3" });
    await seedDeal(db, { id: "b", run_date: "2026-11-12", model_id: "HP:I3" });
    await seedDeal(db, { id: "c", run_date: "2026-11-11", model_id: "ZZ:1" });
    const list = await products();
    expect(list.map((p) => p.model_id)).toEqual(["HP:I3", "ZZ:1"]);
    const hp = list[0]!;
    expect(hp.slug).toBe("hp-i3");
    expect(hp.latest.id).toBe("b");
    expect(hp.history.map((d) => d.run_date)).toEqual(["2026-11-12", "2026-11-10"]);
  });

  it("makes slugs unique and stable when two model ids slug alike", async () => {
    await seedDeal(db, { id: "a", run_date: "2026-11-12", model_id: "A:B" });
    await seedDeal(db, { id: "b", run_date: "2026-11-12", model_id: "A-B" });
    const first = (await products()).map((p) => p.slug);
    const second = (await products()).map((p) => p.slug);
    expect(new Set(first).size).toBe(2);
    expect(first).toEqual(second);
    expect(first.some((s) => s === "a-b")).toBe(true);
  });

  it("falls back to a hash slug when the model id has no usable characters", async () => {
    await seedDeal(db, { id: "a", run_date: "2026-11-12", model_id: "::" });
    expect((await products())[0]!.slug).toMatch(/^p-[0-9a-f]{6}$/);
  });

  it("belongs to the category of the latest deal only", async () => {
    await seedDeal(db, { id: "a", run_date: "2026-11-10", model_id: "m1", category: "smart-tv" });
    await seedDeal(db, { id: "b", run_date: "2026-11-12", model_id: "m1", category: "monitores" });
    const list = await products();
    expect(list[0]!.category).toBe("monitores");
    expect(categoryProducts(list, "smart-tv")).toEqual([]);
    expect(categoryProducts(list, "monitores")).toHaveLength(1);
  });

  it("uses the newest publication time as lastmod, or the run date without posts", async () => {
    await seedDeal(db, { id: "a", run_date: "2026-11-10", model_id: "m1", publishedAt: "2026-11-10T09:00:00-03:00" });
    await seedDeal(db, { id: "b", run_date: "2026-11-12", model_id: "m1", publishedAt: "2026-11-12T09:00:00-03:00" });
    await seedDeal(db, { id: "c", run_date: "2026-11-11", model_id: "m2" });
    const byModel = Object.fromEntries((await products()).map((p) => [p.model_id, p.lastmod]));
    expect(byModel["m1"]).toBe("2026-11-12T09:00:00-03:00");
    expect(byModel["m2"]).toBe("2026-11-11");
  });
});

describe("categoryProducts", () => {
  it("caps a category at the newest CATEGORY_LIMIT products", async () => {
    for (let i = 0; i < CATEGORY_LIMIT + 1; i++) {
      const day = `2026-10-${String(i % 28 + 1).padStart(2, "0")}`;
      await seedDeal(db, { id: `d${i}`, run_date: day, model_id: `m${i}`, category: "smart-tv" });
    }
    const list = categoryProducts(await products(), "smart-tv");
    expect(list).toHaveLength(CATEGORY_LIMIT);
    const dates = list.map((p) => p.latest.run_date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});

describe("isStale", () => {
  it("is stale only after more than seven days", () => {
    expect(isStale("2026-11-05", "2026-11-13")).toBe(true);
    expect(isStale("2026-11-06", "2026-11-13")).toBe(false);
    expect(isStale("2026-11-13", "2026-11-13")).toBe(false);
  });
});
