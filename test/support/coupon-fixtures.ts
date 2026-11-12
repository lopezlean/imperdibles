import { readFileSync } from "node:fs";
import path from "node:path";
import type { ExtractedCoupon } from "../../src/contract/coupon.js";

export type CouponPost = { id: number; text: string; postedAt: Date; coupons: ExtractedCoupon[] };

const DIR = path.join(process.cwd(), "fixtures", "coupon-posts");

/** Real posts from the owner's export plus the golden extraction a correct model returns. */
export function loadCouponPosts(): CouponPost[] {
  const rows = JSON.parse(readFileSync(path.join(DIR, "posts.json"), "utf8")) as {
    id: number;
    file: string;
    postedAt: string;
    coupons: ExtractedCoupon[];
  }[];
  return rows.map((r) => ({
    id: r.id,
    text: readFileSync(path.join(DIR, r.file), "utf8"),
    postedAt: new Date(r.postedAt),
    coupons: r.coupons,
  }));
}

export function postById(id: number): CouponPost {
  const post = loadCouponPosts().find((p) => p.id === id);
  if (!post) throw new Error(`no coupon fixture post ${id}`);
  return post;
}
