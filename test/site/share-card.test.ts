import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSiteData } from "../../site/lib/deals.js";
import { buildProducts } from "../../site/lib/products.js";
import { cardVersion } from "../../site/lib/card-version.js";
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

  it("reuses the cached file when the product has no photo to fetch", async () => {
    await seedDeal(db, { id: "a", run_date: "2026-11-12", model_id: "HP:I3", imageUrl: null });
    const p = await firstProduct();
    const first = await productCardPng(p, { cacheDir, fetch: notFound() });
    expect(existsSync(cardCachePath(cacheDir, "a", cardVersion(p.latest.candidate)))).toBe(true);
    const fetch = notFound();
    const second = await productCardPng(p, { cacheDir, fetch });
    expect(second).toEqual(first);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not cache a card whose photo fetch failed, so the next build retries it", async () => {
    await seedDeal(db, { id: "a", run_date: "2026-11-12", model_id: "HP:I3", imageUrl: IMG });
    const p = await firstProduct();
    const png = await productCardPng(p, { cacheDir, fetch: notFound() });
    expect([...png.slice(0, 4)]).toEqual(PNG);
    expect(existsSync(cardCachePath(cacheDir, "a", cardVersion(p.latest.candidate)))).toBe(false);
  });

  it("changes the version when the Mercado Libre price or any rival price changes", async () => {
    await seedDeal(db, { id: "a", run_date: "2026-11-12", model_id: "HP:I3", ml: 100, rival: 200 });
    const base = (await firstProduct()).latest.candidate;
    const clone = (f: (c: typeof base) => void) => {
      const c = structuredClone(base);
      f(c);
      return cardVersion(c);
    };
    expect(cardVersion(base)).toBe(cardVersion(structuredClone(base)));
    expect(clone((c) => (c.ml.price_ars = 99))).not.toBe(cardVersion(base));
    expect(clone((c) => (c.others[0]!.price_ars = 201))).not.toBe(cardVersion(base));
  });

  it("still renders when the product has no photo", async () => {
    await seedDeal(db, { id: "a", run_date: "2026-11-12", model_id: "HP:I3", imageUrl: null });
    const png = await productCardPng(await firstProduct(), { cacheDir, fetch: notFound() });
    expect([...png.slice(0, 4)]).toEqual(PNG);
  });
});
