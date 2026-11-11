import type { Candidate, CandidateList } from "../../contract/candidate-list.js";
import { storeName } from "../copy.js";
import { formatArs, formatPct, formatThreshold, truncate } from "../format.js";

const CAPTION_LIMIT = 1024;
const FOOTER = 'Para elegirlo, responder a este mensaje con el enlace de afiliado. Para descartarlo, responder "rechazar".';

type Shape = { listing: number | null; titulo: number | null };

function render(c: Candidate, shape: Shape): string {
  const offers = [c.ml, ...c.otras];
  const titulo = shape.titulo === null ? c.titulo : truncate(c.titulo, shape.titulo);
  const prices = [
    `Mercado Libre: ${formatArs(c.ml.precio_ars)}`,
    ...c.otras.map((o) => `${storeName(o.tienda)}: ${formatArs(o.precio_ars)}`),
    `Diferencia: ${formatArs(c.diferencia_ars)} (${formatPct(c)}% menos)`,
  ];
  const links = offers.flatMap((o) => {
    const urlLine = o.url;
    if (shape.listing === null) return [urlLine];
    const title = shape.listing === Infinity ? o.titulo_listado : truncate(o.titulo_listado, shape.listing);
    return [`${storeName(o.tienda)}: ${title}`, urlLine];
  });
  return [titulo, ...prices, "", ...links, "", FOOTER].join("\n");
}

/** Plain-text caption for one shortlist card, at most 1024 characters when the URLs allow it. URLs are never shortened. */
export function buildShortlistCaption(c: Candidate): string {
  const steps: Shape[] = [
    { listing: Infinity, titulo: null },
    { listing: 80, titulo: null },
    { listing: 40, titulo: null },
    { listing: 40, titulo: 80 },
    { listing: null, titulo: 80 },
  ];
  let last = "";
  for (const s of steps) {
    last = render(c, s);
    if (last.length <= CAPTION_LIMIT) return last;
  }
  return last;
}

export function buildNoCandidatesText(list: CandidateList): string {
  return `Hoy no hay candidatos: se compararon ${list.modelos_comparados} modelos y ninguno llegó al ${formatThreshold(list.umbral_pct)}%.`;
}
