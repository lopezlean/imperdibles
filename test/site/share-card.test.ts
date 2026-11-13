import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSiteData } from "../../site/lib/deals.js";
import { buildProducts } from "../../site/lib/products.js";
import { cardCachePath, productCardPng } from "../../site/lib/share-card.js";
import { createSqliteClient } from "../support/sqlite-client.js";
import { seedDeal } from "./support/seed-deals.js";

const PNG = [0x89, 0x50, 0x4e, 0x47];
const IMG = "https://http2.mlstatic.com/x.jpg";
const notFound = () => vi.fn(async () => new Response("", { status: 404 }));

let db: ReturnType<typeof createSqliteClient>;
let cacheDir: string;
beforeEach(() => {
  db = createSqliteClient();
  cacheDir = mkdtempSync(join(tmpdir(), "og-cache-"));
});

const firstProduct = async () => buildProducts(await loadSiteData(db))[0]!;

describe("productCardPng", () => {
  it("renders a PNG", async () => {
    await seedDeal(db, { id: "a", run_date: "2026-11-12", model_id: "HP:I3", imageUrl: IMG });
    const png = await productCardPng(await firstProduct(), { cacheDir, fetch: notFound() });
    expect([...png.slice(0, 4)]).toEqual(PNG);
  });

  it("reuses the cached file instead of rendering and fetching again", async () => {
    await seedDeal(db, { id: "a", run_date: "2026-11-12", model_id: "HP:I3", imageUrl: IMG });
    const p = await firstProduct();
    const fetch = notFound();
    await productCardPng(p, { cacheDir, fetch });
    expect(existsSync(cardCachePath(cacheDir, "a", p.latest.candidate.ml.price_ars))).toBe(true);
    await productCardPng(p, { cacheDir, fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keys the cache by price so a price change is not served stale", () => {
    expect(cardCachePath(cacheDir, "a", 100)).not.toBe(cardCachePath(cacheDir, "a", 200));
  });

  it("still renders when the product has no photo", async () => {
    await seedDeal(db, { id: "a", run_date: "2026-11-12", model_id: "HP:I3", imageUrl: null });
    const png = await productCardPng(await firstProduct(), { cacheDir, fetch: notFound() });
    expect([...png.slice(0, 4)]).toEqual(PNG);
  });
});
