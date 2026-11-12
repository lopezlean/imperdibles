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
          id: "h",
          run_date: "2026-11-10",
          model_id: "m-h",
          title: 'Robot </script> "Gamma" & Co',
          publishedAt: "2026-11-10T09:30:00-03:00",
        });
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

  it("generates day and month pages", () => {
    expect(site.exists("ofertas/12-de-noviembre-de-2026/index.html")).toBe(true);
    expect(site.exists("ofertas/noviembre-de-2026/index.html")).toBe(true);
    expect(site.exists("ofertas/11-de-noviembre-de-2026/index.html")).toBe(false);
    const day = site.read("ofertas/12-de-noviembre-de-2026/index.html");
    expect(day).toContain("<title>Mejores ofertas del jueves 12 de noviembre de 2026 en Mercado Libre | imperdibles</title>");
    expect(day).toContain('<link rel="canonical" href="https://imperdibles.com.ar/ofertas/12-de-noviembre-de-2026/">');
    expect(day).toContain("/ofertas/10-de-noviembre-de-2026/");
    expect(day).toContain("/ofertas/noviembre-de-2026/");
    const month = site.read("ofertas/noviembre-de-2026/index.html");
    expect(month).toContain("<title>Mejores ofertas de noviembre 2026 en Mercado Libre | imperdibles</title>");
    expect(month).toContain("/ofertas/12-de-noviembre-de-2026/");
    expect(month).toContain("/ofertas/10-de-noviembre-de-2026/");
  });

  it("keeps hostile titles inert", () => {
    const day = site.read("ofertas/10-de-noviembre-de-2026/index.html");
    expect(day).not.toContain('</script> "Gamma"');
    for (const rel of ["index.html", "ofertas/10-de-noviembre-de-2026/index.html", "ofertas/noviembre-de-2026/index.html"]) {
      const blocks = [...site.read(rel).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      expect(blocks.length).toBeGreaterThan(0);
      for (const b of blocks) expect(() => JSON.parse(b[1]!)).not.toThrow();
    }
  });

  it("writes robots and sitemap", () => {
    const robots = site.read("robots.txt");
    expect(robots).toContain("Sitemap: https://imperdibles.com.ar/sitemap-index.xml");
    expect(robots).toContain("Disallow: /internal/");
    expect(site.exists("sitemap-index.xml")).toBe(true);
    const xml = site.read("sitemap-0.xml");
    const m = /<loc>https:\/\/imperdibles\.com\.ar\/ofertas\/12-de-noviembre-de-2026\/<\/loc><lastmod>([^<]+)<\/lastmod>/.exec(xml);
    expect(m).not.toBeNull();
    expect(new Date(m![1]!).getTime()).toBe(new Date("2026-11-12T09:30:00-03:00").getTime());
    expect(xml).not.toContain("/404");
  });

  it("emits 404.html", () => {
    expect(site.exists("404.html")).toBe(true);
    expect(site.read("404.html")).toContain("<title>Página no encontrada | imperdibles</title>");
  });

  it("builds a noindex empty home when nothing is published", async () => {
    const empty = await buildSite({ seed: async () => {} });
    const html = empty.read("index.html");
    expect(html).toContain("<title>Ofertas en Mercado Libre más baratas que en otras tiendas | imperdibles</title>");
    expect(html).toContain("Todavía no hay imperdibles publicados. Comparamos precios");
    expect(html).toContain("El mismo filtro. También cuando no hay nada para recomendar.");
    expect(html).toContain("noindex");
    expect(html).toContain("Los imperdibles de hoy");
    expect(empty.exists("ofertas")).toBe(false);
  }, 120_000);
});
