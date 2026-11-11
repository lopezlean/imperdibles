import * as cheerio from "cheerio";
import type { BudgetedHttp } from "../http.js";
import { StoreFormatError, type Listing } from "../types.js";
import { createStoreAdapter, parsePesos, type ListingParse, type Rejected } from "./common.js";

const ID = "fravega";
const ORIGIN = "https://www.fravega.com";
const SELLER = "Frávega";

/** Result pages read per search term; the store sorts by sales, so the first pages hold the relevant listings. */
export const FRAVEGA_PAGES = 5;

/** Page 0 is the plain search URL; later pages use the store's own 0-based `page` parameter. */
export const fravegaSearchUrl = (term: string, page = 0): string =>
  `${ORIGIN}/l/?keyword=${encodeURIComponent(term)}${page > 0 ? `&page=${page}` : ""}`;

const formatError = (message: string) => new StoreFormatError(ID, message);

type Enrichment = { gtin: string | null; brand: string | null };

/**
 * GTIN and brand come only from the embedded Next.js JSON, joined to an article by product slug.
 * That JSON never decides seller, price, title or URL: those come from the visible article.
 * Anything missing, malformed or ambiguous yields nulls.
 */
function readEnrichment(html: string): Map<string, Enrichment> {
  const found = new Map<string, Enrichment | "ambiguous">();
  const raw = cheerio.load(html)("script#__NEXT_DATA__").first().html();
  if (!raw) return new Map();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return new Map();
  }
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (value === null || typeof value !== "object") return;
    const obj = value as Record<string, unknown>;
    if (typeof obj.slug === "string" && "gtin" in obj) {
      const number = (obj.gtin as { number?: unknown } | null)?.number;
      const name = (obj.brand as { name?: unknown } | null)?.name;
      const entry: Enrichment = {
        gtin: typeof number === "string" && /^\d{8,14}$/.test(number) ? number : null,
        brand: typeof name === "string" && name.trim() !== "" ? name.trim() : null,
      };
      const previous = found.get(obj.slug);
      if (previous === undefined) found.set(obj.slug, entry);
      else if (previous === "ambiguous" || previous.gtin !== entry.gtin || previous.brand !== entry.brand) {
        found.set(obj.slug, "ambiguous");
      }
    }
    Object.values(obj).forEach(visit);
  };
  visit(data);
  const result = new Map<string, Enrichment>();
  for (const [slug, entry] of found) if (entry !== "ambiguous") result.set(slug, entry);
  return result;
}

const productSlug = (path: string): string => path.replace(/^\/p\//, "").replace(/-\d+\/?$/, "");

export function parseFravegaListing(html: string, observedAt: string): ListingParse {
  const $ = cheerio.load(html);
  const articles = $("article").toArray();
  if (articles.length === 0) {
    // A legitimate empty search carries the store's explicit marker; anything else is a format change.
    if ($('[data-test-id="results-not-found"]').length > 0) return { listings: [], rejected: [] };
    throw formatError("No <article> found in the listing");
  }
  const enrichment = readEnrichment(html);

  const listings: Listing[] = [];
  const rejected: Rejected[] = [];
  const seen = new Set<string>();
  let readablePrices = 0;

  for (const el of articles) {
    const article = $(el);
    const href = article.find('a[rel="bookmark"][href^="/p/"]').first().attr("href");
    const title = article.find('[data-test-id="article-title"] span').first().text().replace(/\s+/g, " ").trim();
    if (!href || !title) throw formatError("Article without a product link or title");
    const ref = href.split(/[?#]/)[0]!;
    if (seen.has(ref)) continue;
    seen.add(ref);

    const priceBlock = article.find('[data-test-id="product-price"]').first().clone();
    priceBlock.find("p, [data-test-id=\"discount-tag\"]").remove();
    const priceText = priceBlock.find("span").filter((_, s) => $(s).find("span").length === 0).last().text();
    const price = parsePesos(priceText);
    if (price !== null) readablePrices += 1;

    const sellers = article
      .find("p")
      .toArray()
      .map((p) =>
        $(p)
          .contents()
          .filter((_, n) => n.type === "text")
          .text()
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter((text) => text.startsWith("Vendido por"))
      .map((text) => text.slice("Vendido por".length).trim());
    const seller = sellers.length === 1 && sellers[0] !== "" ? sellers[0]! : null;

    if (seller === null) rejected.push({ external_ref: ref, reason: "unknown_seller" });
    else if (seller.normalize("NFC") !== SELLER) rejected.push({ external_ref: ref, reason: "third_party_seller" });
    else if (price === null) rejected.push({ external_ref: ref, reason: "bad_price" });
    else {
      const extra = enrichment.get(productSlug(ref));
      listings.push({
        store: ID,
        title: title,
        brand: extra?.brand ?? null,
        model: null,
        gtin: extra?.gtin ?? null,
        price_ars: price,
        external_ref: ref,
        url: `${ORIGIN}${ref}`,
        seller: SELLER,
        item_condition: null,
        observed_at: observedAt,
      });
    }
  }

  if (readablePrices === 0) throw formatError("No article has a readable price");
  return { listings, rejected };
}

export function createFravegaAdapter(deps: {
  http: BudgetedHttp;
  now: () => Date;
  pages?: number;
  onRejected?: (store: string, rejected: Rejected[]) => void;
}) {
  return createStoreAdapter({ id: ID, searchUrl: fravegaSearchUrl, parse: parseFravegaListing, ...deps, pages: deps.pages ?? FRAVEGA_PAGES });
}
