import type { StoredCoupon } from "../../src/contract/coupon.js";
import { CONFIG_LINK } from "../../src/local/coupons/repo.js";
import type { SqlClient } from "../../src/shared/db/sql-client.js";

export type CouponView = Pick<
  StoredCoupon,
  "id" | "code" | "discount_type" | "discount_value" | "min_purchase" | "cap" | "scope" | "valid_from" | "valid_until"
>;

export type CouponSiteData = { link: string; coupons: CouponView[] } | { link: null; coupons: [] };

/**
 * Coupons for the build: published and not yet expired. valid_from is deliberately not filtered:
 * a coupon whose window opens later is rendered and revealed by the page script when it opens.
 * Without the affiliate link nothing is shown.
 */
export async function loadCouponSiteData(db: SqlClient, now: Date): Promise<CouponSiteData> {
  try {
    const links = await db.all<{ value: string }>("SELECT value FROM config WHERE name = ?", [CONFIG_LINK]);
    const link = links[0]?.value;
    if (!link) return { link: null, coupons: [] };
    const coupons = await db.all<CouponView>(
      `SELECT id, code, discount_type, discount_value, min_purchase, cap, scope, valid_from, valid_until
         FROM coupons
        WHERE status = 'published' AND valid_until > ?
        ORDER BY valid_until, id`,
      [now.toISOString()],
    );
    return { link, coupons };
  } catch (error) {
    // The migration may not be applied yet: the deal site must still build.
    if (isNoSuchTable(error)) return { link: null, coupons: [] };
    throw error;
  }
}

/**
 * Latest change to the set of coupons the page shows: the newest updated_at among published and
 * removed coupons (insert, extension and removal all stamp it). Null when nothing is shown.
 */
export async function loadCouponsLastmod(db: SqlClient): Promise<string | null> {
  try {
    const links = await db.all<{ value: string }>("SELECT value FROM config WHERE name = ?", [CONFIG_LINK]);
    if (!links[0]?.value) return null;
    const rows = await db.all<{ latest: string | null }>(
      "SELECT MAX(updated_at) AS latest FROM coupons WHERE status IN ('published', 'removed')",
    );
    return rows[0]?.latest ?? null;
  } catch (error) {
    if (isNoSuchTable(error)) return null;
    throw error;
  }
}

function isNoSuchTable(error: unknown): boolean {
  return error instanceof Error && /no such table/i.test(error.message);
}
