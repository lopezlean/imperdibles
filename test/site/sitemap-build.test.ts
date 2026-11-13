import { beforeAll, describe, expect, it } from "vitest";
import { CONFIG_LINK, setConfig } from "../../src/local/coupons/repo.js";
import { buildSite, type BuiltSite } from "./support/build-site.js";
import { seedCoupon } from "./support/seed-coupons.js";
import { seedDeal } from "./support/seed-deals.js";

const DAY = 24 * 60 * 60 * 1000;
const IMG_A = "https://http2.mlstatic.com/D_NQ_NP_a-F.webp";
const IMG_B = "https://http2.mlstatic.com/D_NQ_NP_b-F.webp?x=1&y=2";
const DAY_PATH = "/ofertas/12-de-noviembre-de-2026/";

const entry = (xml: string, path: string) =>
  new RegExp(`<url><loc>https://imperdibles\\.com\\.ar${path}</loc>.*?</url>`).exec(xml)?.[0] ?? "";
/** The writer normalizes lastmod to UTC, so compare instants. */
const lastmodMs = (block: string) => {
  const m = /<lastmod>([^<]+)<\/lastmod>/.exec(block);
  return m ? new Date(m[1]!).getTime() : null;
};
const imageLocs = (block: string) => [...block.matchAll(/<image:loc>([^<]+)<\/image:loc>/g)].map((m) => m[1]!.replaceAll("&amp;", "&"));

describe("sitemap build", () => {
  let site: BuiltSite;
  let bare: BuiltSite;
  const latest = "2026-11-05T10:00:00-03:00";

  beforeAll(async () => {
    const now = Date.now();
    const from = new Date(now - DAY).toISOString();
    const until = new Date(now + DAY).toISOString();
    site = await buildSite({
      seed: async (db) => {
        await seedDeal(db, { id: "a", run_date: "2026-11-12", model_id: "m-a", imageUrl: IMG_A, publishedAt: "2026-11-12T09:00:00-03:00" });
        await seedDeal(db, { id: "b", run_date: "2026-11-12", model_id: "m-b", imageUrl: IMG_B, publishedAt: "2026-11-12T09:30:00-03:00" });
        await seedDeal(db, { id: "c", run_date: "2026-11-12", model_id: "m-c", imageUrl: null, publishedAt: "2026-11-12T09:40:00-03:00" });
        await seedDeal(db, { id: "d", run_date: "2026-11-10", model_id: "m-a", imageUrl: IMG_A, publishedAt: "2026-11-10T09:00:00-03:00" });
        await setConfig(db, CONFIG_LINK, "https://meli.la/2AbCdEf");
        await seedCoupon(db, { code: "UNO", validFrom: from, validUntil: until, updatedAt: "2026-11-02T10:00:00-03:00" });
        await seedCoupon(db, { code: "DOS", validFrom: from, validUntil: until, updatedAt: latest });
        await seedCoupon(db, { code: "BAJA", status: "removed", validFrom: from, validUntil: until, updatedAt: "2026-11-04T10:00:00-03:00" });
      },
    });
    bare = await buildSite({ seed: async (db) => seedDeal(db, { id: "z", run_date: "2026-11-12", model_id: "m-z" }) });
  }, 240_000);

  it("gives /cupones/ the latest coupon change as lastmod, removals included", () => {
    expect(lastmodMs(entry(site.read("sitemap-0.xml"), "/cupones/"))).toBe(new Date(latest).getTime());
  });

  it("counts a removal newer than the rest", async () => {
    const removedLater = await buildSite({
      seed: async (db) => {
        await setConfig(db, CONFIG_LINK, "https://meli.la/x");
        const t = new Date(Date.now() + DAY).toISOString();
        await seedCoupon(db, { code: "A", validFrom: t, validUntil: t, updatedAt: "2026-11-02T10:00:00-03:00" });
        await seedCoupon(db, { code: "B", status: "removed", validFrom: t, validUntil: t, updatedAt: "2026-11-09T10:00:00-03:00" });
      },
    });
    expect(lastmodMs(entry(removedLater.read("sitemap-0.xml"), "/cupones/"))).toBe(new Date("2026-11-09T10:00:00-03:00").getTime());
  }, 120_000);

  it("omits /cupones/ lastmod without coupons", () => {
    const block = entry(bare.read("sitemap-0.xml"), "/cupones/");
    expect(block).toContain("<loc>https://imperdibles.com.ar/cupones/</loc>");
    expect(block).not.toContain("<lastmod>");
  });

  it("lists product and category pages with lastmod and photos", () => {
    const xml = site.read("sitemap-0.xml");
    const product = entry(xml, "/producto/m-b/");
    expect(product).toContain("<lastmod>");
    expect(imageLocs(product)).toEqual([IMG_B]);
    expect(imageLocs(entry(xml, "/producto/m-c/"))).toEqual([]);
    expect(entry(xml, "/categoria/aspiradoras-robot/")).toContain("<lastmod>");
  });

  it("declares only the base and image namespaces", () => {
    const xml = site.read("sitemap-0.xml");
    const urlset = /<urlset[^>]*>/.exec(xml)![0];
    const declared = [...urlset.matchAll(/xmlns:(\w+)=/g)].map((m) => m[1]);
    expect(declared).toEqual(["image"]);
    expect(urlset).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
  });

  it("lists the product photos of a deal page, matching its <img src>", () => {
    const locs = imageLocs(entry(site.read("sitemap-0.xml"), DAY_PATH));
    const srcs = [...site.read("ofertas/12-de-noviembre-de-2026/index.html").matchAll(/<img src="([^"]+)"/g)].map((m) => m[1]!.replaceAll("&#38;", "&").replaceAll("&amp;", "&"));
    expect([...locs].sort()).toEqual([IMG_A, IMG_B].sort());
    expect([...srcs].sort()).toEqual([...locs].sort());
  });

  it("lists images for the month page and the home too, deduped", () => {
    for (const path of ["/ofertas/noviembre-de-2026/", "/"]) {
      const locs = imageLocs(entry(site.read("sitemap-0.xml"), path));
      expect(new Set(locs).size).toBe(locs.length);
      expect(locs).toContain(IMG_A);
    }
  });

  it("has no image entries for /cupones/", () => {
    expect(entry(site.read("sitemap-0.xml"), "/cupones/")).not.toContain("<image:");
  });
});
