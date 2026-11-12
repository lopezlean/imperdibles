export type DiscountType = "amount" | "percent";
export type CouponStatus = "pending" | "published" | "removed";

/** What the extractor returns. valid_* are ART wall clock: "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM", or null. */
export type ExtractedCoupon = {
  code: string;
  discount_type: DiscountType;
  discount_value: number;
  min_purchase: number | null;
  cap: number | null;
  scope: string;
  valid_from: string | null;
  valid_until: string | null;
};

/** Validated coupon. valid_from / valid_until are UTC ISO strings from Date.toISOString() (lexicographically comparable). */
export type Coupon = {
  code: string;
  discount_type: DiscountType;
  discount_value: number;
  min_purchase: number | null;
  cap: number | null;
  scope: string;
  valid_from: string;
  valid_until: string;
};

export type StoredCoupon = Coupon & {
  id: number;
  status: CouponStatus;
  source_message_id: number;
  source_text: string;
  channel_message_id: number | null;
  owner_message_id: number | null;
};

/** Why the guard refused an extracted coupon. */
export type GuardReason = "code_not_in_text" | "number_not_in_text" | "invalid_value" | "invalid_validity" | "already_expired";
export type GuardResult = { ok: true; coupon: Coupon } | { ok: false; reason: GuardReason };
