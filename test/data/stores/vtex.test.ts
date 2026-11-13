// Fixtures under fixtures/{jumbo,easy,coppel}/search-aspiradora-robot-derived.json were recorded on 2026-11-11, and
// fixtures/{cetrogar,naldo,carrefour,oncity}/... on 2026-11-13, by an agent: one GET each of `/api/catalog_system/pub/products/search?ft=aspiradora%20robot&_from=0&_to=49`.
// Each response was trimmed to the fields the adapter reads and to a few products, so every file is "derived".
// Hand-edited items (everything else is verbatim from the response):
//   jumbo:  item 4 (Giroscópica) had its seller changed to sellerId "2" / "Tercero Derivado S.A." with stock 5.
//   easy:   item 3 (Klauben) had its stock set to 0; item 4 (Ultracomb) got the same third-party seller edit.
//   coppel: items 2 (empty EAN) and 3 (junk EAN "128449") had their stock set to 3 (the real ones were all out of
//           stock); item 5 (Daewoo) got the third-party seller edit.
//   cetrogar, naldo, oncity: the last item had the store's own (sellerId "1") offer removed, leaving only the real
//           third-party offer, to exercise the seller rule. Everything else is verbatim.
//   carrefour: the real response had no in-stock own offer (all 50 own offers were at stock 0 / price 0), so items 1
//           (Electrolux 4 en 1) and 3 (Midea I5C) had the own offer set to Price 359999 / 449999, ListPrice 399999 /
//           499999 and stock 3; the last item (Dreame F10) had the own offer removed, leaving the third-party one.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { BudgetedHttp } from "../../../src/data/http.js";
import { UpstreamError } from "../../../src/data/http.js";
import { CARREFOUR, carrefourSearchUrl, createCarrefourAdapter, parseCarrefourListing } from "../../../src/data/stores/carrefour.js";
import { CETROGAR, cetrogarSearchUrl, createCetrogarAdapter, parseCetrogarListing } from "../../../src/data/stores/cetrogar.js";
import { COPPEL, createCoppelAdapter, coppelSearchUrl, parseCoppelListing } from "../../../src/data/stores/coppel.js";
import { EASY, createEasyAdapter, easySearchUrl, parseEasyListing } from "../../../src/data/stores/easy.js";
import { JUMBO, createJumboAdapter, jumboSearchUrl, parseJumboListing } from "../../../src/data/stores/jumbo.js";
import { NALDO, createNaldoAdapter, naldoSearchUrl, parseNaldoListing } from "../../../src/data/stores/naldo.js";
import { ONCITY, createOncityAdapter, oncitySearchUrl, parseOncityListing } from "../../../src/data/stores/oncity.js";
import { VTEX_PAGES, VTEX_PAGE_SIZE, parseVtexListing, validEan, vtexSearchUrl } from "../../../src/data/stores/vtex.js";
import { StoreFormatError } from "../../../src/data/types.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures");
const read = (store: string) => readFileSync(path.join(dir, store, "search-aspiradora-robot-derived.json"), "utf8");
const T = "2026-11-12T06:00:00-03:00";
const STORE = { id: "vt", origin: "https://www.vt.test", name: "VT" };

type OfferOver = { sellerId?: string; sellerName?: string; Price?: unknown; ListPrice?: number; AvailableQuantity?: unknown };
const seller = (o: OfferOver = {}) => ({
  sellerId: o.sellerId ?? "1",
  sellerName: o.sellerName ?? "VT S.A.",
  commertialOffer: { Price: o.Price ?? 1000, ListPrice: o.ListPrice ?? 1200, AvailableQuantity: o.AvailableQuantity ?? 3 },
});
const item = (ean: unknown, ...sellers: unknown[]) => ({ itemId: "1", name: "n", ean, sellers: sellers.length > 0 ? sellers : [seller()] });
const product = (over: Record<string, unknown> = {}) => ({
  productId: "10",
  productName: "Aspiradora Robot Acme AB123",
  brand: "Acme",
  productReference: "999",
  linkText: "aspiradora-robot-acme",
  link: "https://www.vt.test/aspiradora-robot-acme/p",
  items: [item("7798192369120")],
  ...over,
});
const parse = (...products: unknown[]) => parseVtexListing(STORE, JSON.stringify(products), T);

describe("validEan", () => {
  it("accepts 8, 12, 13 and 14 digit codes", () => {
    for (const ean of ["12345670", "731199781400", "7798192369120", "17798192369127"]) expect(validEan(ean)).toBe(ean);
  });
  it("treats empty, short, long, non-numeric, repeated-digit and non-string values as missing", () => {
    for (const ean of ["", " ", "128449", "123456789", "779819236912x", "0000000000000", "1111111111111", "88888888", 7798192369120, null, undefined]) {
      expect(validEan(ean)).toBeNull();
    }
  });
});

describe("parseVtexListing seller and stock rules", () => {
  it("keeps a first-party in-stock offer as a listing", () => {
    const r = parse(product());
    expect(r.rejected).toEqual([]);
    expect(r.listings).toEqual([
      {
        store: "vt", title: "Aspiradora Robot Acme AB123", brand: "Acme", model: null, gtin: "7798192369120",
        price_ars: 1000, external_ref: "/aspiradora-robot-acme/p", url: "https://www.vt.test/aspiradora-robot-acme/p",
        seller: "VT S.A.", item_condition: null, observed_at: T,
      },
    ]);
  });

  it("rejects a product sold only by another seller as third_party_seller", () => {
    const r = parse(product({ items: [item("7798192369120", seller({ sellerId: "2", sellerName: "Otro" }))] }));
    expect(r.listings).toEqual([]);
    expect(r.rejected).toEqual([{ external_ref: "/aspiradora-robot-acme/p", reason: "third_party_seller" }]);
  });

  it("ignores a third-party offer next to the store's own offer", () => {
    const r = parse(product({ items: [item("7798192369120", seller({ sellerId: "2", Price: 10 }), seller({ Price: 1000 }))] }));
    expect(r.listings.map((l) => l.price_ars)).toEqual([1000]);
  });

  it("rejects an out-of-stock own offer, including a negative or zero quantity", () => {
    for (const q of [0, -1]) {
      const r = parse(product({ items: [item("7798192369120", seller({ AvailableQuantity: q }))] }));
      expect(r.listings).toEqual([]);
      expect(r.rejected).toEqual([{ external_ref: "/aspiradora-robot-acme/p", reason: "out_of_stock" }]);
    }
  });

  it("does not let a third party's stock stand in for the store's missing stock", () => {
    const r = parse(product({ items: [item("7798192369120", seller({ AvailableQuantity: 0 }), seller({ sellerId: "2", AvailableQuantity: 9 }))] }));
    expect(r.rejected[0]!.reason).toBe("out_of_stock");
  });

  it("rejects a product with no items or no sellers as unknown_seller", () => {
    const r = parse(product({ items: [] }), product({ link: "https://www.vt.test/b/p", items: [{ itemId: "1", ean: "", sellers: [] }] }));
    expect(r.rejected).toEqual([
      { external_ref: "/aspiradora-robot-acme/p", reason: "unknown_seller" },
      { external_ref: "/b/p", reason: "unknown_seller" },
    ]);
  });

  it("rejects an in-stock own offer with a zero or sub-peso price as bad_price", () => {
    const r = parse(product({ items: [item("", seller({ Price: 0 }))] }), product({ link: "https://www.vt.test/b/p", items: [item("", seller({ Price: 0.5 }))] }));
    expect(r.rejected.map((x) => x.reason)).toEqual(["bad_price", "bad_price"]);
  });

  it("floors fractional prices to whole pesos", () => {
    expect(parse(product({ items: [item("", seller({ Price: 303331.67 }))] })).listings[0]!.price_ars).toBe(303331);
  });

  it("takes the cheapest in-stock own offer among a product's items and uses that item's EAN", () => {
    const r = parse(
      product({
        items: [
          item("7798192369120", seller({ Price: 2000 })),
          item("7790000000001", seller({ Price: 1500 })),
          item("7790000000002", seller({ Price: 100, AvailableQuantity: 0 })),
        ],
      }),
    );
    expect(r.listings).toHaveLength(1);
    expect(r.listings[0]).toMatchObject({ price_ars: 1500, gtin: "7790000000001" });
  });

  it("dedupes products that share a path", () => {
    expect(parse(product(), product()).listings).toHaveLength(1);
  });

  it("builds the reference from linkText when the link is missing or unusable", () => {
    expect(parse(product({ link: undefined })).listings[0]!.external_ref).toBe("/aspiradora-robot-acme/p");
    expect(parse(product({ link: "not a url" })).listings[0]!.external_ref).toBe("/aspiradora-robot-acme/p");
  });

  it("keeps the link path but always builds the url on the store's own origin", () => {
    const l = parse(product({ link: "https://other.test/x/y/p?utm=1#a" })).listings[0]!;
    expect(l.external_ref).toBe("/x/y/p");
    expect(l.url).toBe("https://www.vt.test/x/y/p");
  });

  it("leaves brand null when blank and never takes the model from productReference", () => {
    const l = parse(product({ brand: "  ", productReference: "61310106026" })).listings[0]!;
    expect(l.brand).toBeNull();
    expect(l.model).toBeNull();
  });

  it("drops a junk EAN to null so matching falls back to brand and model code from the title", () => {
    expect(parse(product({ items: [item("")] })).listings[0]!.gtin).toBeNull();
    expect(parse(product({ items: [item("128449")] })).listings[0]!.gtin).toBeNull();
    expect(parse(product({ items: [item(undefined)] })).listings[0]!.gtin).toBeNull();
  });

  it("reports how many products the page held, accepted or not", () => {
    expect(parse(product(), product({ items: [] })).scanned).toBe(2);
    expect(parse().scanned).toBe(0);
  });

  it("returns an empty parse for an empty search", () => {
    expect(parse()).toEqual({ listings: [], rejected: [], scanned: 0 });
  });
});

describe("parseVtexListing format changes", () => {
  const bad = (body: string) => () => parseVtexListing(STORE, body, T);
  it("throws StoreFormatError on a body that is not JSON or not an array", () => {
    expect(bad("<html>blocked</html>")).toThrow(StoreFormatError);
    expect(bad("{}")).toThrow(StoreFormatError);
    expect(bad("null")).toThrow(StoreFormatError);
    expect(bad(JSON.stringify({ error: "x" }))).toThrow(StoreFormatError);
  });
  it("carries the store id on the error", () => {
    expect(bad("{}")).toThrow(expect.objectContaining({ store: "vt" }));
  });
  it("throws on products or offers with the wrong shape", () => {
    const cases: unknown[] = [
      "text",
      product({ productName: undefined }),
      product({ items: "nope" }),
      product({ link: undefined, linkText: undefined }),
      product({ items: [null] }),
      product({ items: [{ itemId: "1", ean: "", sellers: "nope" }] }),
      product({ items: [item("", { sellerId: 1, commertialOffer: { Price: 1, AvailableQuantity: 1 } })] }),
      product({ items: [item("", { sellerId: "1", commertialOffer: null })] }),
      product({ items: [item("", seller({ Price: "1000" }))] }),
      product({ items: [item("", { sellerId: "1", commertialOffer: { Price: 1000 } })] }),
    ];
    for (const c of cases) expect(bad(JSON.stringify([c]))).toThrow(StoreFormatError);
  });
});

describe.each([
  { id: "jumbo", store: JUMBO, origin: "https://www.jumbo.com.ar", parseStore: parseJumboListing, url: jumboSearchUrl, name: "Jumbo Argentina IO", inStock: 1, rejected: ["out_of_stock", "out_of_stock", "third_party_seller"] },
  { id: "easy", store: EASY, origin: "https://www.easy.com.ar", parseStore: parseEasyListing, url: easySearchUrl, name: "EASY", inStock: 2, rejected: ["out_of_stock", "third_party_seller"] },
  { id: "coppel", store: COPPEL, origin: "https://www.coppel.com.ar", parseStore: parseCoppelListing, url: coppelSearchUrl, name: "Coppel S.A.", inStock: 2, rejected: ["out_of_stock", "out_of_stock", "third_party_seller"] },
  { id: "cetrogar", store: CETROGAR, origin: "https://www.cetrogar.com.ar", parseStore: parseCetrogarListing, url: cetrogarSearchUrl, name: "Cetrogar", inStock: 2, rejected: ["out_of_stock", "out_of_stock", "third_party_seller"] },
  { id: "naldo", store: NALDO, origin: "https://www.naldo.com.ar", parseStore: parseNaldoListing, url: naldoSearchUrl, name: "Naldo Lombardi SA Arg", inStock: 2, rejected: ["out_of_stock", "out_of_stock", "third_party_seller"] },
  { id: "carrefour", store: CARREFOUR, origin: "https://www.carrefour.com.ar", parseStore: parseCarrefourListing, url: carrefourSearchUrl, name: "CARREFOUR", inStock: 2, rejected: ["out_of_stock", "out_of_stock", "third_party_seller"] },
  { id: "oncity", store: ONCITY, origin: "https://www.oncity.com", parseStore: parseOncityListing, url: oncitySearchUrl, name: "On City", inStock: 2, rejected: ["out_of_stock", "out_of_stock", "third_party_seller"] },
])("$id fixture", ({ id, store, origin, parseStore, url, name, inStock, rejected }) => {
  const r = parseStore(read(id), T);

  it("is configured for its own host", () => {
    expect(store.id).toBe(id);
    expect(store.origin).toBe(origin);
    expect(url("aspiradora robot")).toBe(`${origin}/api/catalog_system/pub/products/search?ft=aspiradora%20robot&_from=0&_to=49`);
  });

  it("keeps only the store's own in-stock offers, with clean integer prices", () => {
    expect(r.listings).toHaveLength(inStock);
    for (const l of r.listings) {
      expect(l.store).toBe(id);
      expect(l.seller).toBe(name);
      expect(Number.isInteger(l.price_ars) && l.price_ars > 0).toBe(true);
      expect(l.url.startsWith(`${origin}/`)).toBe(true);
      expect(l.observed_at).toBe(T);
    }
  });

  it("rejects out-of-stock and third-party products by reason", () => {
    expect(r.rejected.map((x) => x.reason)).toEqual(rejected);
  });

  it("matches the reviewed snapshot", () => {
    expect(r).toMatchSnapshot();
  });
});

describe("fixture EANs", () => {
  it("coppel: the empty and the junk EAN both become null", () => {
    const r = parseCoppelListing(read("coppel"), T);
    expect(r.listings.map((l) => [l.title, l.gtin])).toEqual([
      ["Aspiradora robot Electrolux ERB10", null],
      ["Aspiradora Robot Winco W503", null],
    ]);
  });
  it("jumbo: a real 13-digit EAN is kept", () => {
    expect(parseJumboListing(read("jumbo"), T).listings[0]!.gtin).toBe("7798192369120");
  });
});

describe("adapters of the newer VTEX stores", () => {
  it.each([
    ["cetrogar", createCetrogarAdapter],
    ["naldo", createNaldoAdapter],
    ["carrefour", createCarrefourAdapter],
    ["oncity", createOncityAdapter],
  ] as const)("%s adapter carries its id", (id, create) => {
    const http = { get: async () => new Response("[]"), used: () => 0 } as unknown as BudgetedHttp;
    expect(create({ http, now: () => new Date("2026-11-12T09:00:00Z") }).id).toBe(id);
  });
});

describe("vtexSearchUrl and createVtexAdapter-based adapters", () => {
  it("pages by _from/_to in blocks of 50", () => {
    expect(VTEX_PAGE_SIZE).toBe(50);
    expect(VTEX_PAGES).toBe(5);
    expect(vtexSearchUrl(STORE, "a b&c")).toBe("https://www.vt.test/api/catalog_system/pub/products/search?ft=a%20b%26c&_from=0&_to=49");
    expect(vtexSearchUrl(STORE, "x", 1)).toContain("_from=50&_to=99");
    expect(vtexSearchUrl(STORE, "x", 4)).toContain("_from=200&_to=249");
  });

  const now = () => new Date("2026-11-12T09:00:00Z");
  const full = (n: number, from: number) => JSON.stringify(Array.from({ length: n }, (_, i) => product({ link: `https://www.vt.test/p${from + i}/p`, linkText: `p${from + i}` })));
  function build(bodies: (string | Response)[], opts: { pages?: number } = {}) {
    const get = vi.fn(async (_u: string, _h?: Record<string, string>) => {
      const b = bodies[get.mock.calls.length - 1] ?? "[]";
      return typeof b === "string" ? new Response(b, { status: 206 }) : b;
    });
    const http = { get, used: () => 0 } as unknown as BudgetedHttp;
    return { get, adapter: createJumboAdapter({ http, now, ...opts }) };
  }

  it("asks for JSON and accepts the 206 that VTEX answers with", async () => {
    const { adapter, get } = build([JSON.stringify([product({ link: "https://www.jumbo.com.ar/x/p" })])]);
    const out = await adapter.search("aspiradora robot");
    expect(adapter.id).toBe("jumbo");
    expect(out).toHaveLength(1);
    expect(out[0]!.observed_at).toBe("2026-11-12T06:00:00-03:00");
    expect(get.mock.calls[0]![0]).toBe(jumboSearchUrl("aspiradora robot"));
    expect(get.mock.calls[0]![1]!.Accept).toMatch(/json/);
  });

  it("stops after a page shorter than the page size", async () => {
    const { adapter, get } = build([full(50, 0), full(7, 50), full(50, 100)]);
    expect(await adapter.search("x")).toHaveLength(57);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("stops at an empty page", async () => {
    const { adapter, get } = build([full(50, 0), "[]"]);
    expect(await adapter.search("x")).toHaveLength(50);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("reads at most five full pages by default and honours a smaller cap", async () => {
    const pages = [0, 1, 2, 3, 4, 5].map((i) => full(50, i * 50));
    const a = build(pages);
    expect(await a.adapter.search("x")).toHaveLength(250);
    expect(a.get).toHaveBeenCalledTimes(5);
    expect(a.get.mock.calls.map((c) => c[0])).toEqual([0, 1, 2, 3, 4].map((p) => jumboSearchUrl("x", p)));
    const b = build(pages, { pages: 1 });
    await b.adapter.search("x");
    expect(b.get).toHaveBeenCalledTimes(1);
  });

  it("keeps paging past a full page whose products were all rejected", async () => {
    const oos = JSON.stringify(Array.from({ length: 50 }, (_, i) => product({ link: `https://www.vt.test/o${i}/p`, items: [item("", seller({ AvailableQuantity: 0 }))] })));
    const { adapter, get } = build([oos, full(2, 0)]);
    expect(await adapter.search("x")).toHaveLength(2);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("reports rejected items through onRejected", async () => {
    const onRejected = vi.fn();
    const get = vi.fn(async () => new Response(JSON.stringify([product({ items: [item("", seller({ AvailableQuantity: 0 }))] })]), { status: 200 }));
    const adapter = createEasyAdapter({ http: { get, used: () => 0 } as unknown as BudgetedHttp, now, pages: 1, onRejected });
    await adapter.search("x");
    expect(onRejected).toHaveBeenCalledWith("easy", [{ external_ref: "/aspiradora-robot-acme/p", reason: "out_of_stock" }]);
  });

  it("rejects with UpstreamError on a non-2xx first page", async () => {
    const { adapter } = build([new Response("no", { status: 503 })]);
    await expect(adapter.search("x")).rejects.toBeInstanceOf(UpstreamError);
  });

  it("raises StoreFormatError, with the store id, when the body changes shape", async () => {
    const adapter = createCoppelAdapter({ http: { get: async () => new Response("<html>", { status: 200 }), used: () => 0 } as unknown as BudgetedHttp, now });
    await expect(adapter.search("x")).rejects.toMatchObject({ name: "StoreFormatError", store: "coppel" });
  });
});
