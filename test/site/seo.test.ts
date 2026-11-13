import { describe, expect, it } from "vitest";
import {
  absoluteUrl,
  breadcrumbLd,
  buildDescription,
  buildRobotsTxt,
  categoryItemListLd,
  ogCardUrl,
  productLd,
  productTitle,
  dayTitle,
  homeTitle,
  itemListLd,
  jsonLdScript,
  monthTitle,
  ogImageOf,
  topPct,
} from "../../site/lib/seo.js";
import type { Deal } from "../../site/lib/deals.js";
import type { Product } from "../../site/lib/products.js";

function deal(o: { id?: string; title?: string; ml?: number; rival?: number; image?: string | null }): Deal {
  const offer = (store: string, price: number) => ({
    store,
    listing_title: "x",
    url: `https://example.test/${store}`,
    price_ars: price,
    observed_at: "2026-11-10T10:00:00-03:00",
    external_ref: store,
    seller: null,
  });
  const id = o.id ?? "a";
  return {
    id,
    model_id: `m-${id}`,
    run_date: "2026-11-12",
    category: "aspiradoras-robot",
    affiliate_link: `https://meli.la/${id}`,
    published_at: null,
    candidate: {
      candidate_id: id,
      model_id: `m-${id}`,
      brand: "Fake",
      title: o.title ?? `Robot ${id}`,
      image_url: o.image === undefined ? "https://http2.mlstatic.com/x.jpg" : o.image,
      ml: { ...offer("ml", o.ml ?? 750), ml_product_id: "MLA1", ml_seller_id: "1" },
      others: [offer("fravega", o.rival ?? 1000)],
      difference_ars: 0,
      difference_pct: 0,
      confidence: "high",
      match_rule: "gtin",
    } as unknown as Deal["candidate"],
  };
}

describe("titles", () => {
  it("builds day, month and home titles", () => {
    expect(dayTitle("2026-11-12")).toBe("Mejores ofertas del jueves 12 de noviembre de 2026 en Mercado Libre | imperdibles");
    expect(monthTitle("2026-11")).toBe("Mejores ofertas de noviembre 2026 en Mercado Libre | imperdibles");
    expect(homeTitle("25,0")).toBe("Ofertas en Mercado Libre hasta 25,0% más baratas que en otras tiendas | imperdibles");
  });
});

describe("buildDescription", () => {
  it("lists the names and pluralises", () => {
    expect(buildDescription({ count: 3, topPct: "25,0", names: ["A", "B", "C"] })).toBe(
      "3 ofertas verificadas en Mercado Libre, hasta 25,0% más baratas que en otras tiendas: A, B, C.",
    );
    expect(buildDescription({ count: 1, topPct: "25,0", names: ["A"] })).toMatch(/^1 oferta verificada /);
  });

  it("truncates to 155 characters with an ellipsis", () => {
    const names = ["a", "b", "c"].map((c) => c.repeat(80));
    const out = buildDescription({ count: 3, topPct: "25,0", names });
    expect(out.length).toBeLessThanOrEqual(155);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("topPct and ogImageOf", () => {
  it("formats the best discount (items arrive sorted best first)", () => {
    expect(topPct([deal({ ml: 750, rival: 1000 }), deal({ id: "b", ml: 900, rival: 1000 })])).toBe("25,0");
  });

  it("returns the top deal's mlstatic photo, else null", () => {
    expect(ogImageOf([deal({})])).toBe("https://http2.mlstatic.com/x.jpg");
    expect(ogImageOf([deal({ image: "https://evil.test/x.jpg" })])).toBeNull();
    expect(ogImageOf([deal({ image: null })])).toBeNull();
    expect(ogImageOf([])).toBeNull();
  });
});

describe("absoluteUrl", () => {
  it("joins site and path", () => {
    expect(absoluteUrl("https://imperdibles.com.ar", "/ofertas/noviembre-de-2026/")).toBe(
      "https://imperdibles.com.ar/ofertas/noviembre-de-2026/",
    );
    expect(absoluteUrl("https://imperdibles.com.ar/", "/")).toBe("https://imperdibles.com.ar/");
  });
});

describe("json-ld", () => {
  it("builds an ItemList of ListItem without offers or prices", () => {
    const ld = itemListLd([deal({}), deal({ id: "b", image: null })]) as {
      itemListElement: Record<string, unknown>[];
    };
    const json = JSON.stringify(ld);
    expect(json).not.toContain('"offers"');
    expect(json).not.toContain("price");
    expect(json).not.toContain("Product");
    expect(ld.itemListElement[0]).toEqual({
      "@type": "ListItem",
      position: 1,
      name: "Robot a",
      url: "https://meli.la/a",
      image: "https://http2.mlstatic.com/x.jpg",
    });
    expect("image" in ld.itemListElement[1]!).toBe(false);
    expect(ld.itemListElement[1]!.position).toBe(2);
  });

  it("builds a BreadcrumbList with positions", () => {
    const ld = breadcrumbLd([
      { name: "Inicio", url: "https://x.test/" },
      { name: "Noviembre", url: "https://x.test/m/" },
    ]) as { "@type": string; itemListElement: { position: number; name: string; item: string }[] };
    expect(ld["@type"]).toBe("BreadcrumbList");
    expect(ld.itemListElement.map((e) => e.position)).toEqual([1, 2]);
    expect(ld.itemListElement[1]).toMatchObject({ "@type": "ListItem", name: "Noviembre", item: "https://x.test/m/" });
  });

  it("escapes < in script output and round-trips", () => {
    const name = '</script><b>"x" & y';
    const out = jsonLdScript({ name });
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<");
    expect((JSON.parse(out) as { name: string }).name).toBe(name);
  });
});

describe("buildRobotsTxt", () => {
  it("allows all, blocks internal routes and points to the sitemap index", () => {
    expect(buildRobotsTxt("https://imperdibles.com.ar")).toBe(
      "User-agent: *\nAllow: /\nDisallow: /internal/\nDisallow: /telegram/\n\nSitemap: https://imperdibles.com.ar/sitemap-index.xml\n",
    );
  });
});

describe("product and category SEO", () => {
  const product = (o: { title?: string; ml?: number; rival?: number; image?: string | null; id?: string } = {}): Product => {
    const latest = deal(o);
    return { slug: `p-${o.id ?? "a"}`, model_id: latest.model_id, category: "smart-tv", latest, history: [latest], lastmod: latest.run_date };
  };

  it("emits an Offer with the printed ML price on a fresh product", () => {
    const ld = productLd(product({ ml: 329999 }), "https://imperdibles.com.ar", false) as { offers?: { price: number; priceCurrency: string } };
    expect(ld.offers?.price).toBe(329999);
    expect(ld.offers?.priceCurrency).toBe("ARS");
  });

  it("omits the Offer on a stale product", () => {
    const ld = productLd(product(), "https://imperdibles.com.ar", true);
    expect(ld).not.toHaveProperty("offers");
  });

  it("lists absolute product URLs in order in the category ItemList", () => {
    const ld = categoryItemListLd([product({ id: "a" }), product({ id: "b" })], "https://imperdibles.com.ar") as {
      itemListElement: { url: string }[];
    };
    expect(ld.itemListElement.map((i) => i.url)).toEqual([
      "https://imperdibles.com.ar/producto/p-a/",
      "https://imperdibles.com.ar/producto/p-b/",
    ]);
  });

  it("builds the absolute share card URL", () => {
    expect(ogCardUrl("https://imperdibles.com.ar", "hp-i3", "abc")).toBe("https://imperdibles.com.ar/og/hp-i3.png?v=abc");
  });

  it("puts the product title and the percentage in the product title tag", () => {
    const title = productTitle(product({ title: "Robot Zeta" }));
    expect(title).toContain("Robot Zeta");
    expect(title).toMatch(/\d+,\d%/);
  });
});
