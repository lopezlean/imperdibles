import type { Coupon } from "../contract/coupon.js";
import { artDate, artTime } from "../shared/time.js";
import { formatArs } from "./format.js";

/** "$20.000 OFF" | "10% OFF". */
export function formatDiscount(c: Pick<Coupon, "discount_type" | "discount_value">): string {
  return c.discount_type === "amount" ? `${formatArs(c.discount_value)} OFF` : `${c.discount_value}% OFF`;
}

/** "2026-11-04" -> "04/11". */
function dayMonth(isoDate: string): string {
  const [, m = "", d = ""] = isoDate.split("-");
  return `${d}/${m}`;
}

/** Validity in ART from UTC ISO inputs: a same-day window not starting at 00:00 shows both times; otherwise only the expiry. */
export function formatValidity(validFrom: string, validUntil: string): string {
  const from = new Date(validFrom);
  const until = new Date(validUntil);
  const untilDate = artDate(until);
  const untilTime = artTime(until);
  if (artDate(from) === untilDate && artTime(from) !== "00:00") {
    return `Válido el ${dayMonth(untilDate)} de ${artTime(from)} a ${untilTime} hs`;
  }
  return `Vence el ${dayMonth(untilDate)} a las ${untilTime} hs`;
}
