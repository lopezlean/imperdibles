import { catalogPhotoUrl } from "../../src/output/photo-url.js";
import { dayPage, listDays, listMonths, monthPage, type Deal, type SiteData } from "./deals.js";
import { activeCategories, buildProducts, categoryProducts } from "./products.js";
import { categoryPath, dayPath, monthPath, productPath } from "./slugs.js";

/** Google's cap on images per sitemap URL. */
export const MAX_IMAGES_PER_URL = 1000;

/** Last-modified timestamp per site path: "/", every day, month, product and category page. */
export function lastmodByPath(d: SiteData): Map<string, string> {
  const map = new Map<string, string>();
  const days = listDays(d);
  for (const day of days) map.set(dayPath(day), dayPage(d, day)!.lastmod);
  for (const month of listMonths(d)) map.set(monthPath(month), monthPage(d, month)!.lastmod);
  const latest = days.at(-1);
  if (latest) map.set("/", map.get(dayPath(latest))!);
  const products = buildProducts(d);
  for (const p of products) map.set(productPath(p.slug), p.lastmod);
  for (const c of activeCategories(d)) {
    const listed = categoryProducts(products, c.id);
    map.set(categoryPath(c.id), listed.map((p) => p.lastmod).reduce((a, b) => (b > a ? b : a)));
  }
  return map;
}

/** The photo URLs a page renders, exactly as DealCard renders them: deduped, in page order, capped. */
export function photoUrls(items: Deal[]): string[] {
  const urls = new Set<string>();
  for (const item of items) {
    const url = catalogPhotoUrl(item.candidate.image_url);
    if (url) urls.add(url);
  }
  return [...urls].slice(0, MAX_IMAGES_PER_URL);
}

/** Product photo URLs per deal page path ("/", day and month pages); paths without photos are absent. */
export function imagesByPath(d: SiteData): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const set = (path: string, items: Deal[]) => {
    const urls = photoUrls(items);
    if (urls.length > 0) map.set(path, urls);
  };
  const days = listDays(d);
  for (const day of days) set(dayPath(day), dayPage(d, day)!.items);
  for (const month of listMonths(d)) set(monthPath(month), monthPage(d, month)!.items);
  const latest = days.at(-1);
  if (latest) set("/", dayPage(d, latest)!.items);
  const products = buildProducts(d);
  for (const p of products) set(productPath(p.slug), [p.latest]);
  for (const c of activeCategories(d)) set(categoryPath(c.id), categoryProducts(products, c.id).map((p) => p.latest));
  return map;
}
