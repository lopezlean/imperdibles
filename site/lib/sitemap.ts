import { dayPage, listDays, listMonths, monthPage, type SiteData } from "./deals.js";
import { dayPath, monthPath } from "./slugs.js";

/** Last-modified timestamp per site path: "/", every day page and every month page. */
export function lastmodByPath(d: SiteData): Map<string, string> {
  const map = new Map<string, string>();
  const days = listDays(d);
  for (const day of days) map.set(dayPath(day), dayPage(d, day)!.lastmod);
  for (const month of listMonths(d)) map.set(monthPath(month), monthPage(d, month)!.lastmod);
  const latest = days.at(-1);
  if (latest) map.set("/", map.get(dayPath(latest))!);
  return map;
}
