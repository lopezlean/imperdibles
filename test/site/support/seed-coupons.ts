import type { SqlClient } from "../../../src/shared/db/sql-client.js";
import type { CouponStatus, DiscountType } from "../../../src/contract/coupon.js";

export type SeedCoupon = {
  code: string;
  status?: CouponStatus;
  validFrom: string;
  validUntil: string;
  discountType?: DiscountType;
  discountValue?: number;
  minPurchase?: number | null;
  cap?: number | null;
  scope?: string;
  updatedAt?: string;
};

let nextSource = 1;

/** Inserts one coupon row; valid_* are UTC ISO strings. */
export async function seedCoupon(db: SqlClient, o: SeedCoupon): Promise<void> {
  const stamp = "2026-11-01T00:00:00-03:00";
  const source = nextSource++;
  await db.run(
    `INSERT INTO coupons
       (code, discount_type, discount_value, min_purchase, cap, scope, valid_from, valid_until, status, source_message_id, source_text, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      o.code,
      o.discountType ?? "percent",
      o.discountValue ?? 10,
      o.minPurchase ?? null,
      o.cap ?? null,
      o.scope ?? "",
      o.validFrom,
      o.validUntil,
      o.status ?? "published",
      source,
      `post ${o.code}`,
      stamp,
      o.updatedAt ?? stamp,
    ],
  );
}
