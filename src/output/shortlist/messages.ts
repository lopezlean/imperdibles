import type { Candidate, CandidateList } from "../../contract/candidate-list.js";
import { storeName } from "../copy.js";
import { formatArs, formatPct, formatThreshold, truncate } from "../format.js";

const CAPTION_LIMIT = 1024;
const FOOTER = 'Para elegirlo, responder a este mensaje con el enlace de afiliado. Para descartarlo, responder "rechazar".';
const AUTO_FOOTER =
  'Ya tiene enlace de afiliado. Para publicarlo, responder "publicar". Para descartarlo, responder "rechazar". Para usar otro enlace, responder con un enlace https://meli.la/...';

type Shape = { listing: number | null; title: number | null };

function render(c: Candidate, shape: Shape, footer: string): string {
  const offers = [c.ml, ...c.others];
  const title = shape.title === null ? c.title : truncate(c.title, shape.title);
  const prices = [
    `Mercado Libre: ${formatArs(c.ml.price_ars)}`,
    ...c.others.map((o) => `${storeName(o.store)}: ${formatArs(o.price_ars)}`),
    `Diferencia: ${formatArs(c.difference_ars)} (${formatPct(c)}% menos)`,
  ];
  const links = offers.flatMap((o) => {
    const urlLine = o.url;
    if (shape.listing === null) return [urlLine];
    const title = shape.listing === Infinity ? o.listing_title : truncate(o.listing_title, shape.listing);
    return [`${storeName(o.store)}: ${title}`, urlLine];
  });
  return [title, ...prices, "", ...links, "", footer].join("\n");
}

/** Plain-text caption for one shortlist card, at most 1024 characters when the URLs allow it. URLs are never shortened. */
export function buildShortlistCaption(c: Candidate, opts: { autoAffiliate?: boolean } = {}): string {
  const footer = opts.autoAffiliate === true ? AUTO_FOOTER : FOOTER;
  const steps: Shape[] = [
    { listing: Infinity, title: null },
    { listing: 80, title: null },
    { listing: 40, title: null },
    { listing: 40, title: 80 },
    { listing: null, title: 80 },
  ];
  let last = "";
  for (const s of steps) {
    last = render(c, s, footer);
    if (last.length <= CAPTION_LIMIT) return last;
  }
  return last;
}

export function buildNoCandidatesText(list: CandidateList): string {
  return `Hoy no hay candidatos: se compararon ${list.models_compared} modelos y ninguno llegó al ${formatThreshold(list.threshold_pct)}%.`;
}
