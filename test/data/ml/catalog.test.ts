import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { BudgetedHttp } from "../../../src/data/http.js";
import { UpstreamError } from "../../../src/data/http.js";
import { MlAuthError, type TokenProvider } from "../../../src/data/ml/auth.js";
import { StoreFormatError } from "../../../src/data/types.js";
import {
  MlPermissionError,
  cheapestNewOffer,
  createMlCatalog,
  mapOffer,
} from "../../../src/data/ml/catalog.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/ml");
const load = (name: string): any => JSON.parse(readFileSync(path.join(dir, name), "utf8"));
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function setup(...responses: Response[]) {
  const queue = [...responses];
  const get = vi.fn(async (_url: string, _headers?: Record<string, string>) => {
    const next = queue.shift();
    if (!next) throw new Error("unexpected extra request");
    return next;
  });
  const http = { get, used: () => 0 } as unknown as BudgetedHttp;
  const token: TokenProvider = {
    get: vi.fn(async () => "tok-1"),
    forceRefresh: vi.fn(async () => "tok-2"),
  };
  return { catalog: createMlCatalog({ http, token }), get, token };
}

const BASE = "https://api.mercadolibre.com";

describe("searchProducts", () => {
  it("requests the catalog search with a Bearer header and maps attributes", async () => {
    const { catalog, get } = setup(json(200, load("products-search-s40c-derived.json")));
    const products = await catalog.searchProducts("xiaomi s40c");
    expect(get).toHaveBeenCalledWith(`${BASE}/products/search?site_id=MLA&status=active&q=xiaomi%20s40c`, {
      Authorization: "Bearer tok-1",
    });
    expect(products).toEqual([
      {
        store: "ml",
        id: "MLA00000001",
        title: "Xiaomi Robot Vacuum S40C",
        brand: "Xiaomi",
        model: "S40C",
        gtin: "0000000000001",
        price_ars: null,
        url: "https://www.mercadolibre.com.ar/p/MLA00000001",
        image_url: null,
      },
    ]);
  });

  it("returns an empty list when results is empty", async () => {
    const { catalog } = setup(json(200, { results: [] }));
    expect(await catalog.searchProducts("nada")).toEqual([]);
  });

  it("throws StoreFormatError when the body has no results array", async () => {
    const { catalog } = setup(json(200, { foo: 1 }));
    await expect(catalog.searchProducts("x")).rejects.toBeInstanceOf(StoreFormatError);
  });
});

describe("getProduct", () => {
  it("uses the permalink as url and null for missing attributes", async () => {
    const { catalog, get } = setup(json(200, { id: "MLA1", name: "Algo", permalink: "https://www.mercadolibre.com.ar/p/MLA1", attributes: [], pictures: [{ url: "https://img/x.jpg" }] }));
    const p = await catalog.getProduct("MLA1");
    expect(get.mock.calls[0]![0]).toBe(`${BASE}/products/MLA1`);
    expect(p).toMatchObject({ id: "MLA1", brand: null, model: null, gtin: null, url: "https://www.mercadolibre.com.ar/p/MLA1", image_url: "https://img/x.jpg" });
  });

  it("maps the derived product fixture", async () => {
    const { catalog } = setup(json(200, load("product-MLA00000001-derived.json")));
    expect(await catalog.getProduct("MLA00000001")).toMatchObject({ brand: "Xiaomi", model: "S40C", gtin: "0000000000001" });
  });
});

describe("getOffers and mapOffer", () => {
  it("maps the items of a product", async () => {
    const { catalog, get } = setup(json(200, load("product-items-new-derived.json")));
    const offers = await catalog.getOffers("MLA00000001");
    expect(get.mock.calls[0]![0]).toBe(`${BASE}/products/MLA00000001/items`);
    expect(offers).toEqual([
      { item_id: "MLA90000001", seller_id: "1001", price_ars: 329999, item_condition: "new" },
      { item_id: "MLA90000002", seller_id: "1002", price_ars: 349999, item_condition: "new" },
    ]);
  });

  it("returns [] for an empty items response", async () => {
    const { catalog } = setup(json(200, load("product-items-empty-derived.json")));
    expect(await catalog.getOffers("MLA00000001")).toEqual([]);
  });

  it("rounds the price up (ML never tilts toward a false pass)", () => {
    expect(mapOffer({ item_id: "MLA1", seller_id: 5, price: 329999.5, condition: "new" }).price_ars).toBe(330000);
  });

  it("throws StoreFormatError on an offer without a usable price", () => {
    expect(() => mapOffer({ item_id: "MLA1", seller_id: 5, condition: "new" })).toThrow(StoreFormatError);
    expect(() => mapOffer({ item_id: "MLA1", seller_id: 5, price: -1, condition: "new" })).toThrow(StoreFormatError);
    expect(() => mapOffer(null)).toThrow(StoreFormatError);
  });
});

describe("cheapestNewOffer", () => {
  it("ignores used offers", () => {
    const offers = load("product-items-used-derived.json").results.map(mapOffer);
    expect(cheapestNewOffer(offers)).toMatchObject({ item_condition: "new", item_id: "MLA90000001", price_ars: 329999 });
  });
  it("returns null for no offers or only used ones", () => {
    expect(cheapestNewOffer([])).toBeNull();
    expect(cheapestNewOffer([{ item_id: "a", seller_id: "1", price_ars: 1, item_condition: "used" }])).toBeNull();
  });
});

describe("status handling", () => {
  it("on 401 forces one refresh and retries with the new token", async () => {
    const { catalog, get, token } = setup(json(401, {}), json(200, { results: [] }));
    await catalog.searchProducts("x");
    expect(token.forceRefresh).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1]![1]).toEqual({ Authorization: "Bearer tok-2" });
  });

  it("a second 401 throws MlAuthError without refreshing again", async () => {
    const { catalog, get, token } = setup(json(401, {}), json(401, {}));
    await expect(catalog.getOffers("MLA1")).rejects.toBeInstanceOf(MlAuthError);
    expect(token.forceRefresh).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("on 403 throws MlPermissionError with the path and tries nothing else", async () => {
    const { catalog, get } = setup(json(403, load("status-403-derived.json")));
    const err = await catalog.getProduct("MLA1").catch((e) => e);
    expect(err).toBeInstanceOf(MlPermissionError);
    expect(err.path).toBe("/products/MLA1");
    expect(get).toHaveBeenCalledTimes(1);
  });

  it.each([404, 400, 418])("maps %i to UpstreamError(status, url)", async (status) => {
    for (const call of [
      (c: ReturnType<typeof setup>["catalog"]) => c.searchProducts("a b"),
      (c: ReturnType<typeof setup>["catalog"]) => c.getProduct("MLA1"),
      (c: ReturnType<typeof setup>["catalog"]) => c.getOffers("MLA1"),
    ]) {
      const { catalog } = setup(json(status, {}));
      const err = await call(catalog).catch((e) => e);
      expect(err).toBeInstanceOf(UpstreamError);
      expect(err.status).toBe(status);
      expect(err.url).toContain(BASE);
    }
  });

  it("throws StoreFormatError on invalid JSON", async () => {
    const { catalog } = setup(new Response("<html>", { status: 200 }));
    await expect(catalog.getProduct("MLA1")).rejects.toBeInstanceOf(StoreFormatError);
  });
});
