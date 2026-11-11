import type { BudgetedHttp } from "../http.js";
import { StoreFormatError, type Listing, type StoreAdapter } from "../types.js";
import { createStoreAdapter, type ListingParse, type Rejected } from "./common.js";

/** One VTEX storefront: `origin` has no trailing slash; `name` is the seller name used when the response has none. */
export type VtexStore = { id: string; origin: string; name: string };

/** The catalog API answers at most this many products per call (`_from`..`_to` is inclusive). */
export const VTEX_PAGE_SIZE = 50;
/** Pages read per search term; a short page ends the search sooner. */
export const VTEX_PAGES = 5;

/** The store itself; any other id is a marketplace seller. */
const OWN_SELLER_ID = "1";

export const VTEX_HEADERS = { Accept: "application/json" };

/** Page 0 is `_from=0&_to=49`; each later page moves the window by 50. */
export const vtexSearchUrl = (store: VtexStore, term: string, page = 0): string =>
  `${store.origin}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(term)}&_from=${page * VTEX_PAGE_SIZE}&_to=${page * VTEX_PAGE_SIZE + VTEX_PAGE_SIZE - 1}`;

/** A usable GTIN: 8, 12, 13 or 14 digits and not one digit repeated. Anything else (stores fill junk in) is missing. */
export function validEan(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ean = value.trim();
  if (!/^\d+$/.test(ean) || ![8, 12, 13, 14].includes(ean.length)) return null;
  return /^(\d)\1*$/.test(ean) ? null : ean;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);

type Offer = { own: boolean; seller: string; price: number; stock: number; ean: string | null };

function readOffers(store: VtexStore, product: Obj): Offer[] {
  const fail = (message: string) => new StoreFormatError(store.id, message);
  if (!Array.isArray(product.items)) throw fail("Product without an items array");
  const offers: Offer[] = [];
  for (const item of product.items) {
    if (!isObj(item) || !Array.isArray(item.sellers)) throw fail("Item without a sellers array");
    const ean = validEan(item.ean);
    for (const s of item.sellers) {
      if (!isObj(s) || typeof s.sellerId !== "string" || !isObj(s.commertialOffer)) throw fail("Seller without an id or offer");
      const { Price, AvailableQuantity } = s.commertialOffer;
      if (typeof Price !== "number" || !Number.isFinite(Price) || typeof AvailableQuantity !== "number" || !Number.isFinite(AvailableQuantity)) {
        throw fail("Offer without a numeric price and stock");
      }
      const name = typeof s.sellerName === "string" && s.sellerName.trim() !== "" ? s.sellerName.trim() : store.name;
      offers.push({ own: s.sellerId === OWN_SELLER_ID, seller: name, price: Math.floor(Price), stock: AvailableQuantity, ean });
    }
  }
  return offers;
}

/** Path of the product page; the host in `link` is ignored so the stored URL is always on the store's own origin. */
function productPath(product: Obj): string | null {
  if (typeof product.link === "string") {
    try {
      const path = new URL(product.link).pathname;
      if (path.length > 1) return path;
    } catch {
      // fall through to linkText
    }
  }
  return typeof product.linkText === "string" && product.linkText !== "" ? `/${product.linkText}/p` : null;
}

/**
 * Only offers sold by the store itself (seller "1") and in stock count; the cheapest of them prices the product.
 * `model` stays null: `productReference` is an internal code, so brand and model code come from the title, as for Frávega.
 */
export function parseVtexListing(store: VtexStore, body: string, observedAt: string): ListingParse {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new StoreFormatError(store.id, "Response is not JSON");
  }
  if (!Array.isArray(data)) throw new StoreFormatError(store.id, "Response is not a product array");

  const listings: Listing[] = [];
  const rejected: Rejected[] = [];
  const seen = new Set<string>();
  for (const product of data) {
    if (!isObj(product) || typeof product.productName !== "string" || product.productName.trim() === "") {
      throw new StoreFormatError(store.id, "Product without a name");
    }
    const ref = productPath(product);
    if (ref === null) throw new StoreFormatError(store.id, "Product without a link");
    const offers = readOffers(store, product);
    if (seen.has(ref)) continue;
    seen.add(ref);

    const own = offers.filter((o) => o.own);
    const live = own.filter((o) => o.stock > 0);
    const priced = live.filter((o) => o.price > 0);
    if (priced.length === 0) {
      const reason = live.length > 0 ? "bad_price" : own.length > 0 ? "out_of_stock" : offers.length > 0 ? "third_party_seller" : "unknown_seller";
      rejected.push({ external_ref: ref, reason });
      continue;
    }
    const best = priced.reduce((a, b) => (b.price < a.price ? b : a));
    const brand = typeof product.brand === "string" && product.brand.trim() !== "" ? product.brand.trim() : null;
    listings.push({
      store: store.id,
      title: product.productName.replace(/\s+/g, " ").trim(),
      brand,
      model: null,
      gtin: best.ean,
      price_ars: best.price,
      external_ref: ref,
      url: `${store.origin}${ref}`,
      seller: best.seller,
      item_condition: null,
      observed_at: observedAt,
    });
  }
  return { listings, rejected, scanned: data.length };
}

export type VtexDeps = {
  http: BudgetedHttp;
  now: () => Date;
  pages?: number;
  onRejected?: (store: string, rejected: Rejected[]) => void;
};

export function createVtexAdapter(store: VtexStore, deps: VtexDeps): StoreAdapter {
  return createStoreAdapter({
    id: store.id,
    searchUrl: (term, page) => vtexSearchUrl(store, term, page),
    parse: (body, observedAt) => parseVtexListing(store, body, observedAt),
    pageSize: VTEX_PAGE_SIZE,
    headers: VTEX_HEADERS,
    ...deps,
    pages: deps.pages ?? VTEX_PAGES,
  });
}
