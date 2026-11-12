import { loadCouponSiteData, type CouponSiteData } from "./coupons.js";
import { loadSiteData, type SiteData } from "./deals.js";
import { openSiteDb } from "./db.js";

let cached: Promise<SiteData> | undefined;
let cachedCoupons: Promise<CouponSiteData> | undefined;

/** Loads the deals once per build process; every page shares the result. */
export function getSiteData(): Promise<SiteData> {
  cached ??= openSiteDb(process.env).then(loadSiteData);
  return cached;
}

/** Loads the coupons once per build process, relative to the moment of the first call. */
export function getCouponSiteData(): Promise<CouponSiteData> {
  cachedCoupons ??= openSiteDb(process.env).then((db) => loadCouponSiteData(db, new Date()));
  return cachedCoupons;
}
