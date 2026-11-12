import { describe, expect, it } from "vitest";
import { loadSiteData } from "../../site/lib/deals.js";
import { lastmodByPath } from "../../site/lib/sitemap.js";
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
