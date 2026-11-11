import { describe, expect, it, vi } from "vitest";
import type { BudgetedHttp } from "../../../src/data/http.js";
import { BudgetExhaustedError, UpstreamError } from "../../../src/data/http.js";
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

  describe("pagination", () => {
    const at = (ref: string) => ({ ...listing, external_ref: ref, url: `https://t.test${ref}` });
    // Each page body is its own parse result, keyed by the page parameter in the URL.
    function paged(pages: Record<number, ListingParse>, opts: { pages: number; budget?: number }) {
      const get = vi.fn(async (url: string) => {
        if (opts.budget !== undefined && get.mock.calls.length > opts.budget) throw new BudgetExhaustedError();
        return new Response(String(new URL(url).searchParams.get("page") ?? "0"), { status: 200 });
      });
      const http = { get, used: () => 0 } as unknown as BudgetedHttp;
      const adapter = createStoreAdapter({
        id: "t",
        searchUrl: (term, page) => `https://t.test/?q=${encodeURIComponent(term)}${page > 0 ? `&page=${page}` : ""}`,
        parse: (html) => pages[Number(html)] ?? { listings: [], rejected: [] },
        http, now: () => new Date("2026-11-12T09:00:00Z"), pages: opts.pages,
      });
      return { adapter, get };
    }
    const ok = (...refs: string[]): ListingParse => ({ listings: refs.map(at), rejected: [] });

    it("fetches pages 0..N-1 in order and concatenates the listings", async () => {
      const { adapter, get } = paged({ 0: ok("/a"), 1: ok("/b"), 2: ok("/c"), 3: ok("/d") }, { pages: 3 });
      const out = await adapter.search("x y");
      expect(out.map((l) => l.external_ref)).toEqual(["/a", "/b", "/c"]);
      expect(get.mock.calls.map((c) => c[0])).toEqual([
        "https://t.test/?q=x%20y",
        "https://t.test/?q=x%20y&page=1",
        "https://t.test/?q=x%20y&page=2",
      ]);
    });

    it("fetches a single page by default", async () => {
      const get = vi.fn(async () => new Response("h", { status: 200 }));
      const adapter = createStoreAdapter({
        id: "t", searchUrl: (term) => `https://t.test/?q=${term}`,
        parse: () => ({ listings: [listing], rejected: [] }),
        http: { get, used: () => 0 } as unknown as BudgetedHttp, now: () => new Date("2026-11-12T09:00:00Z"),
      });
      await adapter.search("x");
      expect(get).toHaveBeenCalledTimes(1);
    });

    it("stops at the first page with no articles at all", async () => {
      const { adapter, get } = paged({ 0: ok("/a"), 1: { listings: [], rejected: [] }, 2: ok("/c") }, { pages: 5 });
      expect((await adapter.search("x")).map((l) => l.external_ref)).toEqual(["/a"]);
      expect(get).toHaveBeenCalledTimes(2);
    });

    it("keeps paging past a page whose articles were all rejected", async () => {
      const rejected = [{ external_ref: "/r", reason: "third_party_seller" as const }];
      const { adapter, get } = paged({ 0: ok("/a"), 1: { listings: [], rejected }, 2: ok("/c") }, { pages: 3 });
      expect((await adapter.search("x")).map((l) => l.external_ref)).toEqual(["/a", "/c"]);
      expect(get).toHaveBeenCalledTimes(3);
    });

    it("dedupes listings across pages by external ref, keeping the first", async () => {
      const first = { ...at("/a"), price_ars: 1 };
      const again = { ...at("/a"), price_ars: 2 };
      const { adapter } = paged({ 0: { listings: [first], rejected: [] }, 1: { listings: [again, at("/b")], rejected: [] } }, { pages: 2 });
      expect(await adapter.search("x")).toEqual([first, at("/b")]);
    });

    it("reports the rejected items of every page", async () => {
      const onRejected = vi.fn();
      const r0 = [{ external_ref: "/r0", reason: "third_party_seller" as const }];
      const r1 = [{ external_ref: "/r1", reason: "unknown_seller" as const }];
      const withHook = createStoreAdapter({
        id: "t", searchUrl: (_t, page) => `https://t.test/?page=${page}`, parse: (html) => ({ 0: { listings: [at("/a")], rejected: r0 }, 1: { listings: [at("/b")], rejected: r1 } }[Number(html)]!),
        http: { get: async (url: string) => new Response(new URL(url).searchParams.get("page")!), used: () => 0 } as unknown as BudgetedHttp,
        now: () => new Date(), pages: 2, onRejected,
      });
      await withHook.search("x");
      expect(onRejected.mock.calls).toEqual([["t", r0], ["t", r1]]);
    });

    it("returns what it has when the budget runs out after the first page", async () => {
      const { adapter, get } = paged({ 0: ok("/a"), 1: ok("/b"), 2: ok("/c") }, { pages: 5, budget: 2 });
      expect((await adapter.search("x")).map((l) => l.external_ref)).toEqual(["/a", "/b"]);
      expect(get).toHaveBeenCalledTimes(3);
    });

    it("still throws BudgetExhaustedError when the first page cannot be fetched", async () => {
      const { adapter } = paged({ 0: ok("/a") }, { pages: 5, budget: 0 });
      await expect(adapter.search("x")).rejects.toBeInstanceOf(BudgetExhaustedError);
    });

    it("treats an upstream error after the first page as the end of the results", async () => {
      const get = vi.fn(async (url: string) =>
        url.includes("page=1") ? new Response("no", { status: 404 }) : new Response("0", { status: 200 }),
      );
      const adapter = createStoreAdapter({
        id: "t", searchUrl: (_t, page) => `https://t.test/?${page > 0 ? `page=${page}` : "q"}`,
        parse: () => ok("/a"), http: { get, used: () => 0 } as unknown as BudgetedHttp, now: () => new Date(), pages: 3,
      });
      expect((await adapter.search("x")).map((l) => l.external_ref)).toEqual(["/a"]);
      expect(get).toHaveBeenCalledTimes(2);
    });
  });
});
