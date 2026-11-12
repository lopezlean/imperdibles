import type { Coupon, GuardReason } from "../../contract/coupon.js";
import { formatDiscount, formatValidity } from "../coupon-format.js";
import { AFFILIATE_LEGEND } from "../copy.js";
import { formatArs, truncate } from "../format.js";

const TELEGRAM_LIMIT = 4096;
/** The scope is free model text not verified against the post: capped so it cannot bloat the public message. */
export const SCOPE_LIMIT = 300;

const QUOTE_HEADER = "Mensaje original:";
const OWNER_HINT = 'Para bajarlo, responder "rechazar".';

/** Plain single line: whitespace (including newlines) collapsed, trimmed, capped with "…". */
function plainScope(scope: string): string {
  return truncate(scope.replace(/\s+/g, " ").trim(), SCOPE_LIMIT);
}

/** Public channel message. The link and the legend are never shortened. */
export function buildCouponChannelMessage(c: Coupon, link: string): string {
  const scope = plainScope(c.scope);
  return [
    `🎟️ Cupón de Mercado Libre: ${c.code}`,
    formatDiscount(c),
    ...(c.min_purchase !== null ? [`Compra mínima: ${formatArs(c.min_purchase)}`] : []),
    ...(c.cap !== null ? [`Tope de reintegro: ${formatArs(c.cap)}`] : []),
    ...(scope !== "" ? [`Aplica a: ${scope}`] : []),
    formatValidity(c.valid_from, c.valid_until),
    link,
    "",
    AFFILIATE_LEGEND,
  ].join("\n");
}

/** Joins head, quoted source and tail, shortening only the source so the whole fits Telegram's limit. */
function withQuote(head: string, sourceText: string, tail: string): string {
  const fixed = `${head}\n\n${QUOTE_HEADER}\n`.length + (tail === "" ? 0 : `\n\n${tail}`.length);
  const quote = truncate(sourceText, Math.max(0, TELEGRAM_LIMIT - fixed));
  return `${head}\n\n${QUOTE_HEADER}\n${quote}${tail === "" ? "" : `\n\n${tail}`}`;
}

/** Private notice to the owner after a coupon was published. */
export function buildCouponOwnerNotice(c: Coupon, sourceText: string): string {
  return withQuote(`Cupón publicado: ${c.code} (${formatDiscount(c)})`, sourceText, OWNER_HINT);
}

const REJECTED_REASONS: Record<Exclude<GuardReason, "already_expired"> | "extraction_failed", string> = {
  code_not_in_text: "el código no aparece en el mensaje",
  number_not_in_text: "un monto o porcentaje no aparece en el mensaje",
  invalid_value: "algún valor no es válido",
  invalid_validity: "la vigencia no es válida",
  extraction_failed: "no se pudo leer el mensaje tras 3 intentos",
};

/** Private notice to the owner when a coupon was not published. Expired coupons are dropped silently, so they have no notice. */
export function buildCouponRejectedNotice(input: {
  reason: Exclude<GuardReason, "already_expired"> | "extraction_failed";
  code: string | null;
  sourceText: string;
}): string {
  const head = [`No publicado: ${REJECTED_REASONS[input.reason]}.`, ...(input.code !== null ? [`Código: ${input.code}`] : [])].join("\n");
  return withQuote(head, input.sourceText, "");
}
