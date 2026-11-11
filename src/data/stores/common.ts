import type { BudgetedHttp } from "../http.js";
import { BudgetExhaustedError, UpstreamError } from "../http.js";
import type { Listing, StoreAdapter } from "../types.js";
import { artIso } from "../../shared/time.js";

export type Rejected = { external_ref: string; reason: "third_party_seller" | "unknown_seller" | "bad_price" };
export type ListingParse = { listings: Listing[]; rejected: Rejected[] };

const PESOS = /^\$?\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/;

/** One price in Argentine format (`$1.199.999,50`); cents are floored. Anything else, zero included, is null. */
export function parsePesos(text: string): number | null {
  const match = PESOS.exec(text.replace(/ /g, " ").trim());
  if (!match) return null;
  const pesos = Number(match[1]!.replaceAll(".", ""));
  return Number.isSafeInteger(pesos) && pesos > 0 ? pesos : null;
}

export const STORE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/html",
};

/**
 * `searchUrl` takes a 0-based page; page 0 must be the plain search URL. Up to `pages` pages are read
 * (default 1), deduped by external ref. Paging stops at the first page without any article (accepted or
 * rejected), and, past the first page, when the budget runs out or the store errors: the pages already
 * read are returned. Failures on page 0 propagate.
 */
export function createStoreAdapter(cfg: {
  id: string;
  searchUrl: (term: string, page: number) => string;
  parse: (html: string, observedAt: string) => ListingParse;
  http: BudgetedHttp;
  now: () => Date;
  pages?: number;
  onRejected?: (store: string, rejected: Rejected[]) => void;
}): StoreAdapter {
  const pages = Math.max(1, cfg.pages ?? 1);
  return {
    id: cfg.id,
    async search(term) {
      const found = new Map<string, Listing>();
      for (let page = 0; page < pages; page += 1) {
        const url = cfg.searchUrl(term, page);
        let html: string;
        try {
          const res = await cfg.http.get(url, STORE_HEADERS);
          if (!res.ok) throw new UpstreamError(res.status, url);
          html = await res.text();
        } catch (error) {
          if (page > 0 && (error instanceof BudgetExhaustedError || error instanceof UpstreamError)) break;
          throw error;
        }
        const { listings, rejected } = cfg.parse(html, artIso(cfg.now()));
        if (rejected.length > 0) cfg.onRejected?.(cfg.id, rejected);
        if (listings.length === 0 && rejected.length === 0) break;
        for (const l of listings) if (!found.has(l.external_ref)) found.set(l.external_ref, l);
      }
      return [...found.values()];
    },
  };
}
