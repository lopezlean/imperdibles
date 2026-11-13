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

/** Groups published deals into one product per model, newest first, with unique stable slugs. */
export function buildProducts(d: SiteData): Product[] {
  const byModel = new Map<string, Deal[]>();
  for (const deal of d.deals) byModel.set(deal.model_id, [...(byModel.get(deal.model_id) ?? []), deal]);

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

  // Slug collisions: the first model id (sorted) keeps the bare slug, the others get a stable suffix.
  const seen = new Set<string>();
  for (const p of [...products].sort((a, b) => a.model_id.localeCompare(b.model_id))) {
    if (seen.has(p.slug)) p.slug = `${p.slug}-${slugSuffix(p.model_id)}`;
    seen.add(p.slug);
  }

  return products.sort((a, b) => b.latest.run_date.localeCompare(a.latest.run_date) || byTitle(a, b));
}

/** The newest CATEGORY_LIMIT products of a category, keeping buildProducts order. */
export function categoryProducts(products: Product[], categoryId: string): Product[] {
  return products.filter((p) => p.category === categoryId).slice(0, CATEGORY_LIMIT);
}
