import { type Deal, type SiteData } from "./deals.js";
import { productSlug, slugSuffix } from "./slugs.js";

/** A price older than this many days is shown with a staleness notice. */
export const STALE_DAYS = 7;
/** Newest products listed on a category page; no pagination. */
export const CATEGORY_LIMIT = 48;

export type Product = {
  slug: string;
  model_id: string;
  /** Category of the latest deal. */
  category: string;
  latest: Deal;
  /** One deal per run_date, newest first. */
  history: Deal[];
  /** Newest publication time among the model's deals, or the latest run date when none was posted. */
  lastmod: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function isStale(latestRunDate: string, today: string): boolean {
  const days = (Date.parse(today) - Date.parse(latestRunDate)) / DAY_MS;
  return days > STALE_DAYS;
}

const byTitle = (a: Product, b: Product) => a.latest.candidate.title.localeCompare(b.latest.candidate.title, "es");

const cache = new WeakMap<SiteData, Product[]>();

/** Groups published deals into one product per model, newest first, with unique stable slugs. Memoized per SiteData. */
export function buildProducts(d: SiteData): Product[] {
  const cached = cache.get(d);
  if (cached) return cached;
  const built = groupProducts(d);
  cache.set(d, built);
  return built;
}

function groupProducts(d: SiteData): Product[] {
  const byModel = new Map<string, Deal[]>();
  for (const deal of d.deals) {
    const list = byModel.get(deal.model_id);
    if (list) list.push(deal);
    else byModel.set(deal.model_id, [deal]);
  }

  const products: Product[] = [];
  for (const [model_id, deals] of byModel) {
    const sorted = [...deals].sort((a, b) => b.run_date.localeCompare(a.run_date) || (b.published_at ?? "").localeCompare(a.published_at ?? ""));
    const history: Deal[] = [];
    for (const deal of sorted) if (!history.some((h) => h.run_date === deal.run_date)) history.push(deal);
    const posted = deals.map((x) => x.published_at).filter((p): p is string => p !== null);
    const latest = sorted[0]!;
    products.push({
      slug: productSlug(model_id),
      model_id,
      category: latest.category,
      latest,
      history,
      lastmod: posted.length === 0 ? latest.run_date : posted.reduce((a, b) => (b > a ? b : a)),
    });
  }

  // Slug collisions: the model that appeared first keeps the bare slug (so an indexed URL never changes hands
  // when a later model slugs alike); the others get a stable suffix.
  const firstSeen = (p: Product) => p.history[p.history.length - 1]!.run_date;
  const seen = new Set<string>();
  for (const p of [...products].sort((a, b) => firstSeen(a).localeCompare(firstSeen(b)) || a.model_id.localeCompare(b.model_id))) {
    if (seen.has(p.slug)) p.slug = `${p.slug}-${slugSuffix(p.model_id)}`;
    seen.add(p.slug);
  }

  return products.sort((a, b) => b.latest.run_date.localeCompare(a.latest.run_date) || byTitle(a, b));
}

/** The newest CATEGORY_LIMIT products of a category, keeping buildProducts order. */
export function categoryProducts(products: Product[], categoryId: string): Product[] {
  return products.filter((p) => p.category === categoryId).slice(0, CATEGORY_LIMIT);
}

/** model_id -> final product slug, so list pages link to the same URL the product page is built at. */
export const productSlugs = (products: Product[]): Map<string, string> => new Map(products.map((p) => [p.model_id, p.slug]));

/** Categories that own at least one product (by latest deal): the only ones that get a page or a nav link. */
export function activeCategories(d: SiteData): SiteData["categories"] {
  const owned = new Set(buildProducts(d).map((p) => p.category));
  return d.categories.filter((c) => owned.has(c.id));
}

/** Non-stale products grouped by active category, in category order; empty groups are dropped. Each group is capped at CATEGORY_LIMIT. */
export function freshByCategory(d: SiteData, today: string): { category: SiteData["categories"][number]; products: Product[] }[] {
  const fresh = buildProducts(d).filter((p) => !isStale(p.latest.run_date, today));
  return d.categories
    .map((category) => ({ category, products: categoryProducts(fresh, category.id) }))
    .filter((g) => g.products.length > 0);
}
