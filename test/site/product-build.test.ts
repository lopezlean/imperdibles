import { beforeAll, describe, expect, it } from "vitest";
import { STALE_NOTICE } from "../../src/output/copy.js";
import { daySlug } from "../../site/lib/slugs.js";
import { buildSite, type BuiltSite } from "./support/build-site.js";
import { seedDeal } from "./support/seed-deals.js";

const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const FRESH_OLD = daysAgo(3);
const FRESH_NEW = daysAgo(1);
const STALE = daysAgo(30);

describe("product pages build", () => {
  let site: BuiltSite;

  beforeAll(async () => {
    site = await buildSite({
      seed: async (db) => {
        await seedDeal(db, { id: "a1", run_date: FRESH_OLD, model_id: "HP:I3", category: "smart-tv", title: "Notebook HP I3" });
        await seedDeal(db, { id: "a2", run_date: FRESH_NEW, model_id: "HP:I3", category: "monitores", title: "Notebook HP I3", ml: 100000 });
        await seedDeal(db, { id: "x1", run_date: FRESH_NEW, model_id: "GONE:1", category: "removida", title: "Sin categoria" });
        await seedDeal(db, { id: "b1", run_date: STALE, model_id: "OLD:1", title: "Producto viejo" });
      },
    });
  }, 240_000);

  it("builds one page per model", () => {
    expect(site.exists("producto/hp-i3/index.html")).toBe(true);
    expect(site.exists("producto/old-1/index.html")).toBe(true);
  });

  it("points the button at the latest deal's affiliate link", () => {
    const html = site.read("producto/hp-i3/index.html");
    expect(html).toContain('href="https://meli.la/a2"');
    expect(html).toContain('rel="sponsored noopener"');
    expect(html).not.toContain("https://meli.la/a1");
  });

  it("lists every appearance in the history, linking to the day pages", () => {
    const html = site.read("producto/hp-i3/index.html");
    expect(html).toContain(`/ofertas/${daySlug(FRESH_NEW)}/`);
    expect(html).toContain(`/ofertas/${daySlug(FRESH_OLD)}/`);
  });

  it("gives a fresh page an Offer and no staleness notice", () => {
    const html = site.read("producto/hp-i3/index.html");
    expect(html).toContain('"offers"');
    expect(html).not.toContain(STALE_NOTICE("").slice(0, 20));
  });

  it("marks a stale page with the notice and no Offer", () => {
    const html = site.read("producto/old-1/index.html");
    expect(html).toContain("Este precio es del");
    expect(html).not.toContain('"offers"');
  });

  it("links card titles on day pages to the product page", () => {
    const html = site.read(`ofertas/${daySlug(FRESH_NEW)}/index.html`);
    expect(html).toContain('href="/producto/hp-i3/"');
  });

  it("does not link a category page that is not generated", () => {
    expect(site.exists("categoria/removida/index.html")).toBe(false);
    const html = site.read("producto/gone-1/index.html");
    expect(html).not.toContain("/categoria/removida/");
  });
});
