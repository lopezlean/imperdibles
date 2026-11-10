import type { BudgetedHttp } from "../http.js";
import { UpstreamError } from "../http.js";
import type { Listing, StoreAdapter } from "../types.js";
import { artIso } from "../../shared/time.js";

export type Rejected = { ref_externa: string; reason: "third_party_seller" | "unknown_seller" | "bad_price" };
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

export function createStoreAdapter(cfg: {
  id: string;
  searchUrl: (term: string) => string;
  parse: (html: string, observedAt: string) => ListingParse;
  http: BudgetedHttp;
  now: () => Date;
  onRejected?: (tienda: string, rejected: Rejected[]) => void;
}): StoreAdapter {
  return {
    id: cfg.id,
    async search(term) {
      const url = cfg.searchUrl(term);
      const res = await cfg.http.get(url, STORE_HEADERS);
      if (!res.ok) throw new UpstreamError(res.status, url);
      const { listings, rejected } = cfg.parse(await res.text(), artIso(cfg.now()));
      if (rejected.length > 0) cfg.onRejected?.(cfg.id, rejected);
      return listings;
    },
  };
}
