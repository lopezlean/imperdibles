import { describe, expect, it } from "vitest";
import { loadSiteData } from "../../site/lib/deals.js";
import { imagesByPath, lastmodByPath } from "../../site/lib/sitemap.js";
import { createSqliteClient } from "../support/sqlite-client.js";
import { seedDeal } from "./support/seed-deals.js";

describe("lastmodByPath", () => {
  it("maps day, month and home paths", async () => {
    const db = createSqliteClient();
    await seedDeal(db, { id: "a", run_date: "2026-11-10", model_id: "m1" });
    await seedDeal(db, { id: "b", run_date: "2026-11-12", model_id: "m2", publishedAt: "2026-11-12T11:05:00-03:00" });
    await seedDeal(db, { id: "c", run_date: "2026-11-12", model_id: "m3", publishedAt: "2026-11-12T11:20:00-03:00" });
    const map = lastmodByPath(await loadSiteData(db));
    expect(map.get("/ofertas/12-de-noviembre-de-2026/")).toBe("2026-11-12T11:20:00-03:00");
    expect(map.get("/ofertas/10-de-noviembre-de-2026/")).toBe("2026-11-10");
    expect(map.get("/ofertas/noviembre-de-2026/")).toBe("2026-11-12T11:20:00-03:00");
    expect(map.get("/")).toBe("2026-11-12T11:20:00-03:00");
  });
});

describe("product and category paths", () => {
  it("maps lastmod for products and categories", async () => {
    const db = createSqliteClient();
    await seedDeal(db, { id: "a", run_date: "2026-11-10", model_id: "m1", publishedAt: "2026-11-10T09:00:00-03:00" });
    await seedDeal(db, { id: "b", run_date: "2026-11-12", model_id: "m1", publishedAt: "2026-11-12T09:00:00-03:00" });
    await seedDeal(db, { id: "c", run_date: "2026-11-11", model_id: "m2", publishedAt: "2026-11-11T09:00:00-03:00" });
    const map = lastmodByPath(await loadSiteData(db));
    expect(map.get("/producto/m1/")).toBe("2026-11-12T09:00:00-03:00");
    expect(map.get("/producto/m2/")).toBe("2026-11-11T09:00:00-03:00");
    expect(map.get("/categoria/aspiradoras-robot/")).toBe("2026-11-12T09:00:00-03:00");
  });

  it("lists photos for products and categories that have one", async () => {
    const db = createSqliteClient();
    const img = "https://http2.mlstatic.com/D_NQ_NP_x-F.webp";
    await seedDeal(db, { id: "a", run_date: "2026-11-12", model_id: "m1", imageUrl: img });
    await seedDeal(db, { id: "b", run_date: "2026-11-12", model_id: "m2", imageUrl: null });
    const map = imagesByPath(await loadSiteData(db));
    expect(map.get("/producto/m1/")).toEqual([img]);
    expect(map.has("/producto/m2/")).toBe(false);
    expect(map.get("/categoria/aspiradoras-robot/")).toEqual([img]);
  });
});
