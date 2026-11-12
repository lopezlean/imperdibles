import { z } from "zod";
import type { ExtractedCoupon } from "../../contract/coupon.js";

const validity = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/).nullable();

export const extractedCouponSchema: z.ZodType<ExtractedCoupon> = z.object({
  code: z.string(),
  discount_type: z.enum(["amount", "percent"]),
  discount_value: z.number().int().positive(),
  min_purchase: z.number().int().positive().nullable(),
  cap: z.number().int().positive().nullable(),
  scope: z.string(),
  valid_from: validity,
  valid_until: validity,
});

export const extractionResultSchema: z.ZodType<{ coupons: ExtractedCoupon[] }> = z.object({
  coupons: z.array(extractedCouponSchema),
});

export interface CouponExtractor {
  extract(post: { text: string; postedAt: Date }): Promise<ExtractedCoupon[]>;
}

/** Extraction failed (transport, missing tool call or invalid output). Messages never carry secrets. */
export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}
