import { beforeAll, describe, expect, it } from "vitest";
import { BLACK_FRIDAY_H1 } from "../../src/output/copy.js";
import { buildSite, type BuiltSite } from "./support/build-site.js";
import { seedDeal } from "./support/seed-deals.js";

const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

describe("black friday page build", () => {
  let site: BuiltSite;
  let empty: BuiltSite;

  beforeAll(async () => {
    site = await buildSite({
      seed: async (db) => {
        await seedDeal(db, { id: "f1", run_date: daysAgo(1), model_id: "TV:1", category: "smart-tv", title: "Smart TV fresco" });
        await seedDeal(db, { id: "f2", run_date: daysAgo(2), model_id: "MON:1", category: "monitores", title: "Monitor fresco" });
        await seedDeal(db, { id: "s1", run_date: daysAgo(30), model_id: "OLD:1", category: "smart-tv", title: "TV viejo" });
      },
    });
    empty = await buildSite({
      seed: async (db) => {
        await seedDeal(db, { id: "s2", run_date: daysAgo(30), model_id: "OLD:2", category: "smart-tv", title: "TV viejo" });
      },
    });
  }, 240_000);

  it("lists fresh products grouped by category and leaves stale ones out", () => {
    const html = site.read("black-friday/index.html");
    expect(html).toContain(BLACK_FRIDAY_H1);
    expect(html).toContain("Smart TV fresco");
    expect(html).toContain("Monitor fresco");
    expect(html).not.toContain("TV viejo");
    expect(html).toContain('href="/producto/tv-1/"');
  });

  it("is linked from the header and the sitemap, and indexable", () => {
    expect(site.read("index.html")).toContain('href="/black-friday/"');
    expect(site.read("sitemap-0.xml")).toContain("/black-friday/");
    expect(site.read("black-friday/index.html")).not.toContain('content="noindex');
  });

  it("builds without indexing and points to the channel when nothing is fresh", () => {
    const html = empty.read("black-friday/index.html");
    expect(html).toContain('content="noindex');
    expect(html).toContain('href="/cupones/"');
  });
});
