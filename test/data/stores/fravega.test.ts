import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { BudgetedHttp } from "../../../src/data/http.js";
import { UpstreamError } from "../../../src/data/http.js";
import { createFravegaAdapter, parseFravegaListing } from "../../../src/data/stores/fravega.js";
import { StoreFormatError } from "../../../src/data/types.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/fravega");
const read = (name: string) => readFileSync(path.join(dir, name), "utf8");
const T = "2026-11-12T06:00:00-03:00";

const article = (opts: { href?: string; title?: string; seller?: string; price?: string }) =>
  `<article>${opts.href === undefined ? '<a rel="bookmark" href="/p/x-1/"></a>' : opts.href}
   <div data-test-id="article-title"><span>${opts.title ?? "Aspiradora X"}</span>${opts.seller ?? "<p>Vendido por <!-- -->Frávega</p>"}
   <div data-test-id="product-price"><div><span>${opts.price ?? "$100.000"}</span></div><p>Precio s/imp. nac.<!-- --> <!-- -->$82.000</p></div></div></article>`;
const page = (...articles: string[]) => `<html><body>${articles.join("")}</body></html>`;

describe("parseFravegaListing on the recorded listing", () => {
  const r = parseFravegaListing(read("listing-aspiradoras-robot.html"), T);

  it("keeps only items sold by Frávega itself, as clean integer-peso listings", () => {
    expect(r.listings.length).toBe(3);
    for (const l of r.listings) {
      expect(l.tienda).toBe("fravega");
      expect(Number.isInteger(l.precio_ars) && l.precio_ars > 0).toBe(true);
      expect(l.url.startsWith("https://www.fravega.com/")).toBe(true);
      expect(l.url).not.toContain("?");
      expect(l.vendedor).toBe("Frávega");
      expect(l.observado_en).toBe(T);
    }
    expect(new Set(r.listings.map((l) => l.ref_externa)).size).toBe(r.listings.length);
  });

  it("counts every third-party article as rejected", () => {
    expect(r.rejected.length).toBe(12);
    expect(new Set(r.rejected.map((x) => x.reason))).toEqual(new Set(["third_party_seller"]));
  });

  it("takes the current price, never the struck list price or the tax-free line", () => {
    const byRef = Object.fromEntries(r.listings.map((l) => [l.ref_externa, l.precio_ars]));
    expect(byRef["/p/aspiradora-robot-trapeadora-philco-limpieza-sense-antichoque-con-app-phra26n-60505/"]).toBe(163999);
    expect(byRef["/p/aspiradora-irobot-m611330-braava-jet-m6-black-60346/"]).toBe(1199999);
    expect(byRef["/p/aspiradora-robot-smartlife-con-sensor-laser-sl-rvcl050-60646/"]).toBe(329999);
  });

  it("matches the reviewed snapshot", () => {
    expect(r).toMatchSnapshot();
  });
});

describe("parseFravegaListing seller rule", () => {
  it("rejects the derived third-party fixture even though the embedded JSON still names Frávega", () => {
    const r = parseFravegaListing(read("listing-third-party-derived.html"), T);
    expect(r.rejected).toContainEqual(expect.objectContaining({ reason: "third_party_seller" }));
    expect(r.rejected.length).toBe(13);
    expect(r.listings.length).toBe(2);
  });

  it("rejects a missing, empty or ambiguous seller line as unknown_seller", () => {
    const html = page(
      article({ href: '<a rel="bookmark" href="/p/a-1/"></a>', seller: "" }),
      article({ href: '<a rel="bookmark" href="/p/b-2/"></a>', seller: "<p>Vendido por </p>" }),
      article({ href: '<a rel="bookmark" href="/p/c-3/"></a>', seller: "<p>Vendido por Frávega</p><p>Vendido por Bidcom</p>" }),
      article({ href: '<a rel="bookmark" href="/p/d-4/"></a>' }),
    );
    const r = parseFravegaListing(html, T);
    expect(r.rejected).toEqual([
      { ref_externa: "/p/a-1/", reason: "unknown_seller" },
      { ref_externa: "/p/b-2/", reason: "unknown_seller" },
      { ref_externa: "/p/c-3/", reason: "unknown_seller" },
    ]);
    expect(r.listings.map((l) => l.ref_externa)).toEqual(["/p/d-4/"]);
  });

  it("only accepts a seller that is exactly Frávega", () => {
    const html = page(
      article({ href: '<a rel="bookmark" href="/p/a-1/"></a>', seller: "<p>Vendido por Frávega Outlet</p>" }),
      article({ href: '<a rel="bookmark" href="/p/b-2/"></a>', seller: "<p>Vendido por Frávega<svg><title>x</title></svg></p>" }),
    );
    const r = parseFravegaListing(html, T);
    expect(r.rejected).toEqual([{ ref_externa: "/p/a-1/", reason: "third_party_seller" }]);
    expect(r.listings.map((l) => l.ref_externa)).toEqual(["/p/b-2/"]);
  });
});

describe("parseFravegaListing prices", () => {
  it("rejects an unreadable price as bad_price while other prices are readable", () => {
    const r = parseFravegaListing(
      page(article({ price: "Consultar" }), article({ href: '<a rel="bookmark" href="/p/y-2/"></a>', price: "$391.039,61" })),
      T,
    );
    expect(r.rejected).toEqual([{ ref_externa: "/p/x-1/", reason: "bad_price" }]);
    expect(r.listings[0]!.precio_ars).toBe(391039);
  });

  it("takes the last span when a struck list price precedes the current price", () => {
    const html = `<article><a rel="bookmark" href="/p/z-9/"></a><div data-test-id="article-title"><span>Z</span><p>Vendido por Frávega</p>
      <div data-test-id="product-price"><div><div><span>$299.999</span><span data-test-id="discount-tag">45</span></div><span>$163.999</span></div><p>Precio s/imp. nac. $135.536</p></div></div></article>`;
    expect(parseFravegaListing(page(html), T).listings[0]!.precio_ars).toBe(163999);
  });

  it("dedupes repeated articles by product path", () => {
    const r = parseFravegaListing(page(article({}), article({})), T);
    expect(r.listings.length).toBe(1);
  });
});

describe("parseFravegaListing embedded JSON enrichment", () => {
  const next = (products: unknown[]) =>
    `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { q: { items: products } } })}</script>`;
  const withJson = (products: unknown[]) => page(article({}), next(products));
  const prod = (over: object) => ({ __typename: "Product", slug: "x", gtin: { __typename: "EAN", number: "7799219122223" }, brand: { name: "Gadnic" }, ...over });

  it("fills gtin and brand from the product whose slug matches the article path", () => {
    const l = parseFravegaListing(withJson([prod({})]), T).listings[0]!;
    expect(l.gtin).toBe("7799219122223");
    expect(l.marca).toBe("Gadnic");
  });

  it("leaves them null when the JSON is absent, malformed, null, or ambiguous", () => {
    for (const html of [
      page(article({})),
      page(article({}), '<script id="__NEXT_DATA__" type="application/json">{oops</script>'),
      withJson([prod({ gtin: null, brand: null })]),
      withJson([prod({}), prod({ gtin: { __typename: "EAN", number: "7790000000001" } })]),
      withJson([prod({ slug: "other" })]),
      withJson([prod({ gtin: { __typename: "EAN", number: "abc" } })]),
    ]) {
      const l = parseFravegaListing(html, T).listings[0]!;
      expect(l.gtin).toBeNull();
    }
    expect(parseFravegaListing(withJson([prod({ brand: null })]), T).listings[0]!.marca).toBeNull();
  });

  it("never lets the JSON decide the seller", () => {
    const html = page(article({ seller: "<p>Vendido por Bidcom</p>" }), next([prod({ seller: { id: "fravega" } })]));
    expect(parseFravegaListing(html, T).rejected[0]!.reason).toBe("third_party_seller");
  });

  it("reads the EAN of the recorded Frávega products", () => {
    const r = parseFravegaListing(read("listing-aspiradoras-robot.html"), T);
    const philco = r.listings.find((l) => l.ref_externa.includes("philco"))!;
    expect(philco.gtin).toBe("7796962017233");
    expect(philco.marca).toBe("Philco");
  });
});

describe("parseFravegaListing format changes", () => {
  it("throws StoreFormatError when there is no article", () => {
    expect(() => parseFravegaListing(read("listing-broken-derived.html"), T)).toThrow(StoreFormatError);
    expect(() => parseFravegaListing("<html></html>", T)).toThrow(StoreFormatError);
  });

  it("treats the recorded no-results page as an empty parse, not a format change", () => {
    expect(parseFravegaListing(read("listing-no-results.html"), T)).toEqual({ listings: [], rejected: [] });
  });

  it("still throws on a page with neither articles nor the no-results marker", () => {
    expect(() => parseFravegaListing(read("listing-broken-derived.html"), T)).toThrow(StoreFormatError);
  });

  it("throws when no article has a readable price", () => {
    expect(() => parseFravegaListing(page(article({ price: "Consultar" })), T)).toThrow(StoreFormatError);
  });

  it("throws on an article without a product link or title", () => {
    expect(() => parseFravegaListing(page(article({ href: "" })), T)).toThrow(StoreFormatError);
    expect(() => parseFravegaListing(page(article({ title: "" })), T)).toThrow(StoreFormatError);
  });
});

describe("createFravegaAdapter", () => {
  const html = read("listing-third-party-derived.html");
  function setup(res: Response, onRejected?: (t: string, r: any[]) => void) {
    const get = vi.fn(async (_u: string, _h?: Record<string, string>) => res);
    const http = { get, used: () => 0 } as unknown as BudgetedHttp;
    const adapter = createFravegaAdapter({ http, now: () => new Date("2026-11-12T09:00:00Z"), ...(onRejected ? { onRejected } : {}) });
    return { adapter, get };
  }

  it("requests the keyword listing and returns Frávega-sold items", async () => {
    const { adapter, get } = setup(new Response(html, { status: 200 }));
    const listings = await adapter.search("aspiradora robot");
    expect(adapter.id).toBe("fravega");
    expect(get.mock.calls[0]![0]).toBe("https://www.fravega.com/l/?keyword=aspiradora%20robot");
    expect(listings.length).toBe(2);
    expect(listings[0]!.observado_en).toBe("2026-11-12T06:00:00-03:00");
  });

  it("returns [] for a no-results page and does not call onRejected", async () => {
    const onRejected = vi.fn();
    const { adapter } = setup(new Response(read("listing-no-results.html"), { status: 200 }), onRejected);
    await expect(adapter.search("zzqxv imposible 99817")).resolves.toEqual([]);
    expect(onRejected).not.toHaveBeenCalled();
  });

  it.each([404, 503])("rejects with UpstreamError on %i", async (status) => {
    const { adapter } = setup(new Response("x", { status }));
    await expect(adapter.search("x")).rejects.toBeInstanceOf(UpstreamError);
  });

  it("calls onRejected once with the third-party articles", async () => {
    const onRejected = vi.fn();
    const { adapter } = setup(new Response(html, { status: 200 }), onRejected);
    await adapter.search("aspiradora robot");
    expect(onRejected).toHaveBeenCalledTimes(1);
    expect(onRejected).toHaveBeenCalledWith("fravega", expect.arrayContaining([expect.objectContaining({ reason: "third_party_seller" })]));
  });
});
