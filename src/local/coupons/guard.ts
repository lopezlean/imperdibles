import type { Coupon, ExtractedCoupon, GuardResult } from "../../contract/coupon.js";
import { artDate } from "../../shared/time.js";

const CODE_SHAPE = /^[A-Za-z0-9]{3,30}$/;
const DATE_ONLY = /^(\d{4}-\d{2}-\d{2})$/;
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-sensitive whole token: not adjacent to [A-Za-z0-9_-]. */
export function containsToken(text: string, token: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(token)}(?![A-Za-z0-9_-])`).test(text);
}

const THOUSANDS = /^\d{1,3}([.,]\d{3})+$/;

/**
 * Standalone numeric tokens (not adjacent to letters or digits, URLs ignored). "." / ","
 * count as thousands separators only in the form 1.000 / 1,000,000; "9,5" is not 95.
 */
export function containsNumber(text: string, n: number): boolean {
  const target = String(n);
  const prose = text.replace(/https?:\/\/\S+/g, " ");
  for (const match of prose.matchAll(/(?<![A-Za-z\d])\d+(?:[.,]\d+)*(?![A-Za-z\d])/g)) {
    const token = match[0];
    if (/^\d+$/.test(token)) {
      if (token === target) return true;
    } else if (THOUSANDS.test(token) && token.replace(/[.,]/g, "") === target) {
      return true;
    }
  }
  return false;
}

function positiveInt(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

function validValues(c: ExtractedCoupon): boolean {
  if (!CODE_SHAPE.test(c.code)) return false;
  if (!positiveInt(c.discount_value)) return false;
  if (c.discount_type === "percent" && c.discount_value > 100) return false;
  if (c.min_purchase !== null && !positiveInt(c.min_purchase)) return false;
  if (c.cap !== null && !positiveInt(c.cap)) return false;
  return true;
}

/** ART wall clock to a Date; null when unparsable or not a real calendar date. */
function artWallClock(date: string, time: string, seconds: string): Date | null {
  const d = new Date(`${date}T${time}:${seconds}-03:00`);
  if (Number.isNaN(d.getTime()) || artDate(d) !== date) return null;
  return d;
}

function resolveFrom(value: string): Date | null {
  const only = DATE_ONLY.exec(value);
  if (only) return artWallClock(only[1]!, "00:00", "00");
  const dt = DATE_TIME.exec(value);
  return dt ? artWallClock(dt[1]!, dt[2]!, "00") : null;
}

function resolveUntil(value: string): Date | null {
  const only = DATE_ONLY.exec(value);
  if (only) return artWallClock(only[1]!, "23:59", "59");
  const dt = DATE_TIME.exec(value);
  if (!dt) return null;
  const [, date, time] = dt;
  if (time === "23:59") return artWallClock(date!, time, "59");
  const at = artWallClock(date!, time!, "00");
  // "until 00:00" means the end of the previous ART day.
  if (at && time === "00:00") return new Date(at.getTime() - 1000);
  return at;
}

export function guardCoupon(
  extracted: ExtractedCoupon,
  post: { text: string; postedAt: Date },
  now: Date,
): GuardResult {
  if (!validValues(extracted)) return { ok: false, reason: "invalid_value" };
  if (!containsToken(post.text, extracted.code)) return { ok: false, reason: "code_not_in_text" };
  for (const n of [extracted.discount_value, extracted.min_purchase, extracted.cap]) {
    if (n !== null && !containsNumber(post.text, n)) return { ok: false, reason: "number_not_in_text" };
  }

  const from =
    extracted.valid_from === null ? post.postedAt : resolveFrom(extracted.valid_from);
  const until =
    extracted.valid_until === null
      ? artWallClock(artDate(post.postedAt), "23:59", "59")
      : resolveUntil(extracted.valid_until);
  if (!from || !until || until.getTime() <= from.getTime()) return { ok: false, reason: "invalid_validity" };
  if (until.getTime() <= now.getTime()) return { ok: false, reason: "already_expired" };

  const coupon: Coupon = {
    code: extracted.code,
    discount_type: extracted.discount_type,
    discount_value: extracted.discount_value,
    min_purchase: extracted.min_purchase,
    cap: extracted.cap,
    scope: extracted.scope,
    valid_from: from.toISOString(),
    valid_until: until.toISOString(),
  };
  return { ok: true, coupon };
}
