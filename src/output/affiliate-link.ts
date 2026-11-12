export type AffiliateLinkResult =
  | { ok: true; link: string }
  | { ok: false; reason: "empty" | "not_single_url" | "not_https" | "wrong_host" };

const AFFILIATE_HOST = "meli.la";

/**
 * Accepts exactly one https://meli.la link. The returned `link` is the trimmed input substring,
 * byte for byte: it is never normalized, resolved or rewritten.
 */
export function parseAffiliateLink(text: string): AffiliateLinkResult {
  const link = text.trim();
  if (link === "") return { ok: false, reason: "empty" };
  if (/\s/.test(link)) return { ok: false, reason: "not_single_url" };
  if (!link.startsWith("https://")) return { ok: false, reason: "not_https" };
  try {
    if (new URL(link).hostname.toLowerCase() !== AFFILIATE_HOST) return { ok: false, reason: "wrong_host" };
  } catch {
    return { ok: false, reason: "wrong_host" };
  }
  return { ok: true, link };
}

export type AffiliateIds = { word: string; tool: string };

const ML_HOST = "www.mercadolibre.com.ar";

/**
 * Sets (or replaces) `matt_word` and `matt_tool` on an https://www.mercadolibre.com.ar URL,
 * keeping every other query param. Throws on any other host, on non-https or on empty ids.
 */
export function buildAffiliateLink(productUrl: string, ids: AffiliateIds): string {
  if (ids.word === "" || ids.tool === "") throw new Error("affiliate ids must be non-empty");
  const url = new URL(productUrl);
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== ML_HOST) {
    throw new Error(`not a ${ML_HOST} https URL`);
  }
  url.searchParams.set("matt_word", ids.word);
  url.searchParams.set("matt_tool", ids.tool);
  return url.toString();
}
