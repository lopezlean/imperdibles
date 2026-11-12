import { beforeAll, describe, expect, it } from "vitest";
import { seedDeal } from "./support/seed-deals.js";
import { buildSite, type BuiltSite } from "./support/build-site.js";

describe("site build", () => {
  let site: BuiltSite;

  beforeAll(async () => {
    site = await buildSite({
      seed: async (db) => {
        await seedDeal(db, { id: "old", run_date: "2026-11-10", model_id: "m-old", title: "Robot Viejo", publishedAt: "2026-11-10T09:00:00-03:00" });
        await seedDeal(db, {
          id: "a",
          run_date: "2026-11-12",
          model_id: "m-a",
          title: "Robot Alfa",
          ml: 750,
          rival: 1000,
          models_compared: 5,
          publishedAt: "2026-11-12T09:00:00-03:00",
        });
        await seedDeal(db, {
          id: "b",
          run_date: "2026-11-12",
          model_id: "m-b",
          title: "Robot Beta",
          ml: 825,
          rival: 1000,
          publishedAt: "2026-11-12T09:30:00-03:00",
        });
      },
    });
  }, 120_000);

  it("builds the home page from fixture data", () => {
    expect(site.exists("index.html")).toBe(true);
    const html = site.read("index.html");
    expect(html).toContain('<link rel="canonical" href="https://imperdibles.com.ar/">');
    expect(html).toMatch(/<meta name="description" content="2 ofertas verificadas en Mercado Libre, hasta 25,0%/);
    expect(html).toContain("<title>Ofertas en Mercado Libre hasta 25,0% más baratas que en otras tiendas | imperdibles</title>");
    expect(html).toContain("Los imperdibles del jueves 12 de noviembre de 2026");
    expect(html).toContain('rel="sponsored noopener"');
    expect(html).toContain('"@type":"ItemList"');
    expect(html).not.toContain('"offers"');
    expect(html.indexOf("Robot Alfa")).toBeGreaterThan(-1);
    expect(html.indexOf("Robot Alfa")).toBeLessThan(html.indexOf("Robot Beta"));
    expect(html).toContain('lang="es"');
    expect(html).toContain('name="color-scheme"');
  });

  it("links the home to the previous day and the month", () => {
    const html = site.read("index.html");
    expect(html).toContain("/ofertas/10-de-noviembre-de-2026/");
    expect(html).toContain("/ofertas/noviembre-de-2026/");
  });

  it("lists the home in the sitemap with a lastmod", () => {
    const xml = site.read("sitemap-0.xml");
    expect(xml).toMatch(/<loc>https:\/\/imperdibles\.com\.ar\/<\/loc><lastmod>[^<]+<\/lastmod>/);
  });

  it("builds a noindex empty home when nothing is published", async () => {
    const empty = await buildSite({ seed: async () => {} });
    const html = empty.read("index.html");
    expect(html).toContain("<title>Ofertas en Mercado Libre más baratas que en otras tiendas | imperdibles</title>");
    expect(html).toContain("Todavía no hay imperdibles publicados. Comparamos precios");
    expect(html).toContain("El mismo filtro. También cuando no hay nada para recomendar.");
    expect(html).toContain("noindex");
    expect(html).toContain("Los imperdibles de hoy");
  }, 120_000);
});
