import type { Candidate } from "../../contract/candidate-list.js";
import { AFFILIATE_LEGEND, storeName } from "../copy.js";
import { formatArs, formatPct, truncate } from "../format.js";

const CAPTION_LIMIT = 1024;
const X_LIMIT = 280;
/** X counts every URL as 23 characters, whatever its real length. */
const X_LINK_WEIGHT = 23;

/** Channel photo caption, at most 1024 characters. Only the title is shortened; the link never is. */
export function buildChannelCaption(c: Candidate, link: string): string {
  const build = (titulo: string) =>
    [
      titulo,
      `${formatPct(c)}% menos en Mercado Libre: ${formatArs(c.ml.precio_ars)}`,
      ...c.otras.map((o) => `${storeName(o.tienda)}: ${formatArs(o.precio_ars)}`),
      `Diferencia: ${formatArs(c.diferencia_ars)}`,
      link,
      "",
      AFFILIATE_LEGEND,
    ].join("\n");
  const overflow = build(c.titulo).length - CAPTION_LIMIT;
  return overflow <= 0 ? build(c.titulo) : build(truncate(c.titulo, Math.max(1, c.titulo.length - overflow)));
}

/** X material for the owner: at most 280 weighted characters (link = 23). Only the title is shortened. */
export function buildXPost(c: Candidate, link: string): string {
  const tail = `${formatPct(c)}% menos en Mercado Libre que en ${storeName(c.otras[0]!.tienda)} (${formatArs(c.ml.precio_ars)}). `;
  const fixed = `: ${tail}`.length + X_LINK_WEIGHT + " Enlace de afiliado.".length;
  const titulo = truncate(c.titulo, Math.max(1, X_LIMIT - fixed));
  return `${titulo}: ${tail}${link} Enlace de afiliado.`;
}
