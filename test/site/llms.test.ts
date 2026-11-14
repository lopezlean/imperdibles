import { describe, expect, it } from "vitest";
import { buildLlmsTxt } from "../../site/lib/llms.js";

const base = {
  siteUrl: "https://imperdibles.com.ar",
  thresholdPct: 15,
  categories: [
    { id: "notebooks", name: "Notebooks" },
    { id: "tvs", name: "Televisores" },
  ],
  runDate: "2026-11-12",
  offers: [
    { title: "Robot Alfa", mlPriceArs: 1234567, pct: "25,0", path: "/producto/m-a/" },
    { title: "Robot Beta", mlPriceArs: 825, pct: "17,5", path: "/producto/m-b/" },
  ],
};

describe("buildLlmsTxt", () => {
  const txt = buildLlmsTxt(base);

  it("starts with the title and a blockquote summary", () => {
    const lines = txt.split("\n");
    expect(lines[0]).toBe("# imperdibles");
    expect(lines[2]).toMatch(/^> .*Mercado Libre.*15%/);
    expect(txt.endsWith("\n")).toBe(true);
  });

  it("links the verification method to /transparencia", () => {
    expect(txt).toContain("https://imperdibles.com.ar/transparencia/");
  });

  it("lists key pages and categories as absolute markdown links", () => {
    for (const url of [
      "https://imperdibles.com.ar/",
      "https://imperdibles.com.ar/cupones/",
      "https://imperdibles.com.ar/black-friday/",
      "https://imperdibles.com.ar/sitemap-index.xml",
      "https://imperdibles.com.ar/categoria/notebooks/",
      "https://imperdibles.com.ar/categoria/tvs/",
      "https://imperdibles.com.ar/ofertas/12-de-noviembre-de-2026/",
    ]) {
      expect(txt).toContain(`](${url})`);
    }
    expect(txt).toContain("[Notebooks](");
  });

  it("lists today's offers with price, percentage and product URL", () => {
    expect(txt).toContain("## Ofertas de hoy");
    expect(txt).toContain("- [Robot Alfa](https://imperdibles.com.ar/producto/m-a/): $1.234.567 en Mercado Libre, 25,0% más barato que en otras tiendas");
    expect(txt).toContain("[Robot Beta](https://imperdibles.com.ar/producto/m-b/): $825");
  });

  it("escapes markdown-breaking characters in titles", () => {
    const out = buildLlmsTxt({ ...base, offers: [{ title: "Robot [X]\nline", mlPriceArs: 10, pct: "20,0", path: "/producto/x/" }] });
    expect(out).toContain("[Robot \\[X\\] line](");
  });

  it("handles no offers and no categories", () => {
    const out = buildLlmsTxt({ ...base, offers: [], categories: [], runDate: null });
    expect(out).toContain("Todavía no hay ofertas publicadas");
    expect(out).not.toContain("## Categorías");
    expect(out).not.toContain("/ofertas/");
    expect(out).toContain("](https://imperdibles.com.ar/transparencia/)");
  });
});
