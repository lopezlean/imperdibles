import { beforeEach, describe, expect, it } from "vitest";
import { dayPage, listDays, listMonths, loadSiteData, monthPage } from "../../site/lib/deals.js";
import { createSqliteClient } from "../support/sqlite-client.js";
import { seedDeal } from "./support/seed-deals.js";

let db: ReturnType<typeof createSqliteClient>;
beforeEach(() => {
  db = createSqliteClient();
});

const load = () => loadSiteData(db);

describe("listing", () => {
  it("lists days and months ascending, ignoring days without published deals", async () => {
    await seedDeal(db, { id: "a", run_date: "2026-11-12", model_id: "m1" });
    await seedDeal(db, { id: "b", run_date: "2026-11-10", model_id: "m2" });
    await seedDeal(db, { id: "c", run_date: "2026-11-11", model_id: "m3", status: "validated" });
    await seedDeal(db, { id: "d", run_date: "2026-10-31", model_id: "m4" });
    const d = await load();
    expect(listDays(d)).toEqual(["2026-10-31", "2026-11-10", "2026-11-12"]);
    expect(listMonths(d)).toEqual(["2026-10", "2026-11"]);
  });

  it("excludes non published statuses and rows without affiliate link", async () => {
    await seedDeal(db, { id: "a", run_date: "2026-11-10", model_id: "m1" });
    await seedDeal(db, { id: "b", run_date: "2026-11-11", model_id: "m2", status: "invalidated" });
    await seedDeal(db, { id: "c", run_date: "2026-11-12", model_id: "m3", link: null });
    expect(listDays(await load())).toEqual(["2026-11-10"]);
  });

  it("skips unparseable payloads and empty others; a day with only those is absent", async () => {
    await seedDeal(db, { id: "a", run_date: "2026-11-10", model_id: "m1" });
    await seedDeal(db, { id: "b", run_date: "2026-11-11", model_id: "m2", payload: "{not json" });
    const empty = JSON.parse(
      JSON.stringify({ title: "X", ml: { price_ars: 1 }, others: [] }),
    ) as object;
    await seedDeal(db, { id: "c", run_date: "2026-11-12", model_id: "m3", payload: JSON.stringify(empty) });
    const d = await load();
    expect(listDays(d)).toEqual(["2026-11-10"]);
    expect(dayPage(d, "2026-11-11")).toBeNull();
    expect(dayPage(d, "2026-11-12")).toBeNull();
  });

  it("returns null for unknown day or month", async () => {
    await seedDeal(db, { id: "a", run_date: "2026-11-12", model_id: "m1" });
    const d = await load();
    expect(dayPage(d, "2026-11-13")).toBeNull();
    expect(monthPage(d, "2026-12")).toBeNull();
  });

  it("exposes the configured threshold", async () => {
    expect((await load()).threshold_pct).toBe(15);
  });
});

describe("dayPage", () => {
  it("keeps the earliest published row per model", async () => {
    await seedDeal(db, { id: "a", run_date: "2026-11-12", model_id: "m1", publishedAt: "2026-11-12T11:20:00-03:00" });
    await seedDeal(db, { id: "b", run_date: "2026-11-12", model_id: "m1", publishedAt: "2026-11-12T11:05:00-03:00" });
    const page = dayPage(await load(), "2026-11-12")!;
    expect(page.items.map((i) => i.id)).toEqual(["b"]);
  });

  it("sorts by discount desc then title", async () => {
    await seedDeal(db, { id: "a", run_date: "2026-11-12", model_id: "m1", title: "Zeta", ml: 329999, rival: 399999 });
    await seedDeal(db, { id: "b", run_date: "2026-11-12", model_id: "m2", title: "Beta", ml: 300000, rival: 400000 });
    await seedDeal(db, { id: "c", run_date: "2026-11-12", model_id: "m3", title: "Álamo", ml: 329999, rival: 399999 });
    const page = dayPage(await load(), "2026-11-12")!;
    expect(page.items.map((i) => i.id)).toEqual(["b", "c", "a"]);
  });

  it("sums the largest run of each category", async () => {
    await seedDeal(db, { id: "a", run_date: "2026-11-12", model_id: "m1", runId: "r1", models_compared: 10 });
    await seedDeal(db, { id: "b", run_date: "2026-11-12", model_id: "m2", runId: "r2", models_compared: 14 });
    await seedDeal(db, { id: "c", run_date: "2026-11-12", model_id: "m3", category: "smart-tv", models_compared: 7 });
    const d = await load();
    expect(dayPage(d, "2026-11-12")!.models_compared).toBe(21);
    expect(d.comparedByDay["2026-11-12"]).toBe(21);
  });

  it("links prev/next days and month", async () => {
    for (const [i, day] of ["10", "12", "14"].entries()) {
      await seedDeal(db, { id: `x${i}`, run_date: `2026-11-${day}`, model_id: `m${i}` });
    }
    const d = await load();
    expect(dayPage(d, "2026-11-12")).toMatchObject({ prev: "2026-11-10", next: "2026-11-14", month: "2026-11" });
    expect(dayPage(d, "2026-11-10")!.prev).toBeNull();
    expect(dayPage(d, "2026-11-14")!.next).toBeNull();
  });

  it("derives lastmod from the latest post, falling back to the date", async () => {
    await seedDeal(db, { id: "a", run_date: "2026-11-12", model_id: "m1", publishedAt: "2026-11-12T11:05:00-03:00" });
    await seedDeal(db, { id: "b", run_date: "2026-11-12", model_id: "m2", publishedAt: "2026-11-12T11:20:00-03:00" });
    await seedDeal(db, { id: "c", run_date: "2026-11-10", model_id: "m3" });
    const d = await load();
    expect(dayPage(d, "2026-11-12")!.lastmod).toBe("2026-11-12T11:20:00-03:00");
    expect(dayPage(d, "2026-11-10")!.lastmod).toBe("2026-11-10");
  });

  it("reports the single category of the day, or null when mixed", async () => {
    await seedDeal(db, { id: "a", run_date: "2026-11-10", model_id: "m1", category: "smart-tv" });
    await seedDeal(db, { id: "b", run_date: "2026-11-12", model_id: "m2" });
    await seedDeal(db, { id: "c", run_date: "2026-11-12", model_id: "m3", category: "smart-tv" });
    const d = await load();
    expect(dayPage(d, "2026-11-10")!.categoryId).toBe("smart-tv");
    expect(dayPage(d, "2026-11-12")!.categoryId).toBeNull();
    expect(d.categories.map((c) => c.id).sort()).toEqual(["aspiradoras-robot", "smart-tv"]);
    expect(d.categories.find((c) => c.id === "smart-tv")!.name).toBe("Smart TV");
  });
});

describe("monthPage", () => {
  it("keeps the best discount per model", async () => {
    await seedDeal(db, { id: "a", run_date: "2026-11-03", model_id: "m1", ml: 329999, rival: 399999 });
    await seedDeal(db, { id: "b", run_date: "2026-11-10", model_id: "m1", ml: 300000, rival: 400000 });
    const page = monthPage(await load(), "2026-11")!;
    expect(page.items.map((i) => [i.id, i.run_date])).toEqual([["b", "2026-11-10"]]);
    expect(page.days).toEqual(["2026-11-03", "2026-11-10"]);
  });

  it("breaks ties with the most recent date", async () => {
    await seedDeal(db, { id: "a", run_date: "2026-11-10", model_id: "m1" });
    await seedDeal(db, { id: "b", run_date: "2026-11-03", model_id: "m1" });
    expect(monthPage(await load(), "2026-11")!.items.map((i) => i.run_date)).toEqual(["2026-11-10"]);
  });

  it("links prev/next months and uses the max lastmod", async () => {
    await seedDeal(db, { id: "a", run_date: "2026-10-31", model_id: "m1" });
    await seedDeal(db, { id: "b", run_date: "2026-11-03", model_id: "m2", publishedAt: "2026-11-03T11:00:00-03:00" });
    await seedDeal(db, { id: "c", run_date: "2026-11-12", model_id: "m3", publishedAt: "2026-11-12T11:20:00-03:00" });
    await seedDeal(db, { id: "d", run_date: "2026-12-01", model_id: "m4" });
    const d = await load();
    expect(monthPage(d, "2026-11")).toMatchObject({
      prev: "2026-10",
      next: "2026-12",
      lastmod: "2026-11-12T11:20:00-03:00",
    });
    expect(monthPage(d, "2026-10")!.prev).toBeNull();
  });
});
