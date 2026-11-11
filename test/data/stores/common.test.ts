import { describe, expect, it, vi } from "vitest";
import type { BudgetedHttp } from "../../../src/data/http.js";
import { UpstreamError } from "../../../src/data/http.js";
import { createStoreAdapter, parsePesos, type ListingParse } from "../../../src/data/stores/common.js";

describe("parsePesos", () => {
  it("reads Argentine thousands separators", () => {
    expect(parsePesos("$ 329.999")).toBe(329999);
    expect(parsePesos("$1.199.999")).toBe(1199999);
    expect(parsePesos("$999")).toBe(999);
  });
  it("floors the cents", () => {
    expect(parsePesos("$329.999,50")).toBe(329999);
    expect(parsePesos("$391.039,61")).toBe(391039);
  });
  it("returns null for zero, words and anything not a single price", () => {
    expect(parsePesos("$0")).toBeNull();
    expect(parsePesos("$0,99")).toBeNull();
    expect(parsePesos("Consultar")).toBeNull();
    expect(parsePesos("")).toBeNull();
    expect(parsePesos("$456.29924")).toBeNull();
    expect(parsePesos("$350.999 $290.082")).toBeNull();
  });
});

describe("createStoreAdapter", () => {
  const listing = {
    store: "t", title: "x", brand: null, model: null, gtin: null, price_ars: 10,
    external_ref: "/p/x/", url: "https://t.test/p/x/", seller: "T", item_condition: null, observed_at: "",
  };
  function build(res: () => Response, parse: (html: string, at: string) => ListingParse, onRejected?: (t: string, r: any[]) => void) {
    const get = vi.fn(async (_u: string, _h?: Record<string, string>) => res());
    const http = { get, used: () => 0 } as unknown as BudgetedHttp;
    const adapter = createStoreAdapter({
      id: "t",
      searchUrl: (term) => `https://t.test/?q=${encodeURIComponent(term)}`,
      parse, http, now: () => new Date("2026-11-12T09:00:00Z"),
      ...(onRejected ? { onRejected } : {}),
    });
    return { adapter, get };
  }

  it("requests the search URL and parses with the ART timestamp", async () => {
    const parse = vi.fn(() => ({ listings: [listing], rejected: [] }));
    const { adapter, get } = build(() => new Response("<html>", { status: 200 }), parse);
    expect(adapter.id).toBe("t");
    expect(await adapter.search("a b")).toEqual([listing]);
    expect(get.mock.calls[0]![0]).toBe("https://t.test/?q=a%20b");
    expect(parse).toHaveBeenCalledWith("<html>", "2026-11-12T06:00:00-03:00");
  });

  it("throws UpstreamError on a non-2xx response", async () => {
    const { adapter } = build(() => new Response("no", { status: 404 }), vi.fn());
    await expect(adapter.search("x")).rejects.toBeInstanceOf(UpstreamError);
  });

  it("reports rejected items once, only when there are any", async () => {
    const onRejected = vi.fn();
    const rejected = [{ external_ref: "/p/y/", reason: "third_party_seller" as const }];
    const a = build(() => new Response("h"), () => ({ listings: [], rejected }), onRejected);
    await a.adapter.search("x");
    expect(onRejected).toHaveBeenCalledTimes(1);
    expect(onRejected).toHaveBeenCalledWith("t", rejected);
    const b = build(() => new Response("h"), () => ({ listings: [listing], rejected: [] }), onRejected);
    await b.adapter.search("x");
    expect(onRejected).toHaveBeenCalledTimes(1);
  });
});
