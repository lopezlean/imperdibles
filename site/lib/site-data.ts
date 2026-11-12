import { loadSiteData, type SiteData } from "./deals.js";
import { openSiteDb } from "./db.js";

let cached: Promise<SiteData> | undefined;

/** Loads the deals once per build process; every page shares the result. */
export function getSiteData(): Promise<SiteData> {
  cached ??= openSiteDb(process.env).then(loadSiteData);
  return cached;
}
