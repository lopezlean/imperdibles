import { beforeEach, describe, expect, it } from "vitest";
import { loadSiteData } from "../../site/lib/deals.js";
import { priceHistory } from "../../site/lib/price-history.js";
import { buildProducts } from "../../site/lib/products.js";
import { createSqliteClient } from "../support/sqlite-client.js";
import { seedDeal } from "./support/seed-deals.js";

let db: ReturnType<typeof createSqliteClient>;
beforeEach(() => {
  db = createSqliteClient();
});
const product = async () => buildProducts(await loadSiteData(db))[0]!;

describe("priceHistory", () => {
  it("orders points oldest first and calls the lowest price seen", async () => {
    await seedDeal(db, { id: "a", run_date: "2026-11-05", model_id: "m", ml: 120000 });
    await seedDeal(db, { id: "b", run_date: "2026-11-12", model_id: "m", ml: 100000 });
    const h = priceHistory(await product());
    expect(h.points.map((p) => p.price)).toEqual([120000, 100000]);
    expect(h.verdict).toEqual({ kind: "lowest" });
  });

  it("says how much above the lowest price seen when it is not the best", async () => {
    await seedDeal(db, { id: "a", run_date: "2026-11-05", model_id: "m", ml: 100000 });
    await seedDeal(db, { id: "b", run_date: "2026-11-12", model_id: "m", ml: 110000 });
    expect(priceHistory(await product()).verdict).toEqual({ kind: "above", pct: 10 });
  });

  it("is a first sighting with a single point", async () => {
    await seedDeal(db, { id: "a", run_date: "2026-11-12", model_id: "m", ml: 100000 });
    expect(priceHistory(await product()).verdict).toEqual({ kind: "first" });
  });
});
