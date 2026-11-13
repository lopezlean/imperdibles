import { beforeAll, describe, expect, it } from "vitest";
import { TRANSPARENCY_H1 } from "../../src/output/copy.js";
import { buildSite, type BuiltSite } from "./support/build-site.js";
import { seedDeal } from "./support/seed-deals.js";

describe("/transparencia build", () => {
  let site: BuiltSite;
  beforeAll(async () => {
    site = await buildSite({
      seed: async (db) => {
        await seedDeal(db, { id: "a", run_date: "2026-11-10", model_id: "m1", models_compared: 50 });
      },
    });
  }, 240_000);

  it("shows the totals and the per-day table", () => {
    const html = site.read("transparencia/index.html");
    expect(html).toContain(TRANSPARENCY_H1);
    expect(html).toContain("50");
    expect(html).toContain("/ofertas/10-de-noviembre-de-2026/");
  });

  it("is linked from the footer and the sitemap", () => {
    expect(site.read("index.html")).toContain('href="/transparencia/"');
    expect(site.read("sitemap-0.xml")).toContain("/transparencia/");
  });
});
