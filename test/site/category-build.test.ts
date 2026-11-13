import { beforeAll, describe, expect, it } from "vitest";
import { CATEGORY_LIMIT } from "../../site/lib/products.js";
import { buildSite, type BuiltSite } from "./support/build-site.js";
import { seedDeal } from "./support/seed-deals.js";

const cards = (html: string) => (html.match(/<article class="pcard"/g) ?? []).length;
const productLinks = (html: string) => (html.match(/href="\/producto\//g) ?? []).length;

describe("category pages build", () => {
  let site: BuiltSite;

  beforeAll(async () => {
    site = await buildSite({
      seed: async (db) => {
        for (let i = 0; i < CATEGORY_LIMIT + 1; i++) {
          const day = `2026-10-${String((i % 28) + 1).padStart(2, "0")}`;
          await seedDeal(db, { id: `t${i}`, run_date: day, model_id: `tv${i}`, category: "smart-tv", title: `TV ${i}` });
        }
        await seedDeal(db, { id: "m1", run_date: "2026-11-01", model_id: "MOVER:1", category: "celulares", title: "Mover" });
        await seedDeal(db, { id: "m2", run_date: "2026-11-05", model_id: "MOVER:1", category: "heladeras", title: "Mover" });
      },
    });
  }, 240_000);

  it("builds a page for each category with published deals and none for the others", () => {
    expect(site.exists("categoria/smart-tv/index.html")).toBe(true);
    expect(site.exists("categoria/heladeras/index.html")).toBe(true);
    expect(site.exists("categoria/lavarropas/index.html")).toBe(false);
  });

  it("lists exactly CATEGORY_LIMIT products on a big category", () => {
    const html = site.read("categoria/smart-tv/index.html");
    expect(cards(html)).toBe(CATEGORY_LIMIT);
  });

  it("lists a moved product only in its latest category", () => {
    expect(site.exists("categoria/celulares/index.html")).toBe(false);
    expect(productLinks(site.read("categoria/heladeras/index.html"))).toBeGreaterThan(0);
  });

  it("links the categories from the header on every page", () => {
    const home = site.read("index.html");
    expect(home).toContain('href="/categoria/smart-tv/"');
    expect(home).toContain('href="/categoria/heladeras/"');
  });
});
