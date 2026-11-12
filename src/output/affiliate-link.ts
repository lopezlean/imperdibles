export type AffiliateLinkResult =
  | { ok: true; link: string }
  | { ok: false; reason: "empty" | "not_single_url" | "not_https" | "wrong_host" };

const AFFILIATE_HOST = "meli.la";

/** Spanish explanation for each rejection reason, shared by the Telegram webhook and the CLI. */
export const AFFILIATE_REASON_ES = {
  empty: "el mensaje está vacío",
  not_single_url: "tiene que ser un único enlace, sin otro texto",
  not_https: "el enlace no usa https",
  wrong_host: "el enlace no es de meli.la",
} as const satisfies Record<Extract<AffiliateLinkResult, { ok: false }>["reason"], string>;

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
