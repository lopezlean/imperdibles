/** Spec-fixed copy and constants. Plain values only: Worker-safe, never read from a file at runtime. */

/** Duplicates `stores.name` on purpose: the Worker must not read it per request. */
export const STORE_NAMES: Record<string, string> = {
  ml: "Mercado Libre",
  fravega: "Frávega",
  jumbo: "Jumbo",
  easy: "Easy",
  coppel: "Coppel",
  cetrogar: "Cetrogar",
  musimundo: "Musimundo",
};

/** Display name for a store id; unknown ids fall back to the id itself. */
export function storeName(id: string): string {
  return Object.hasOwn(STORE_NAMES, id) ? STORE_NAMES[id]! : id;
}

// V1 (docs/verification/data.md): the pipeline compares ML's selling `price`, never `original_price`, so the label is "actual".
export const PRICE_LABEL: "lista" | "actual" = "actual" as "lista" | "actual";

export const AFFILIATE_LEGEND =
  "Los enlaces a Mercado Libre son de afiliado: recibimos una comisión por cada compra, sin costo adicional.";

export const NOT_AFFILIATED = "imperdibles.com.ar no pertenece a Mercado Libre ni a las tiendas comparadas.";

/** Page and card copy fixed by the confirmed design (Design reference appendix). Worker-safe. */
export const PAGE_TITLE_HERO = (threshold: string): string =>
  `Solo publicamos cuando Mercado Libre gana por ${threshold}% o más.`;

export const HERO_LEAD =
  "Comparamos el mismo modelo en otras tiendas. Si la diferencia es chica, el producto no aparece.";

export const COMPARED_CHIP = (n: number): string => (n === 1 ? "1 modelo comparado" : `${n} modelos comparados`);

export const PUBLISHED_CHIP = (n: number): string => (n === 1 ? "1 publicado" : `${n} publicados`);

export const TODAY_HEADING = "Los imperdibles de hoy";

export const CTA_ML = "Ver en Mercado Libre";

export const IN_ML = "en Mercado Libre";

export const DIFFERENCE = "Diferencia";

/** `fechaLarga` is the long date ("10 de noviembre de 2026"). */
export const PRICES_NOTE = (fechaLarga: string, label: "lista" | "actual" = PRICE_LABEL): string =>
  `Precios ${label === "lista" ? "de lista" : "actuales"} al ${fechaLarga}, sin envío ni cuotas.`;

export const HOW_HEADING = "Cómo elegimos";

export const HOW_STEPS = (threshold: string): { title: string; body: string }[] => [
  {
    title: "El mismo modelo exacto",
    body: "Se compara el mismo modelo en Mercado Libre y en otras tiendas, no uno parecido.",
  },
  {
    title: `Diferencia de ${threshold}% o más`,
    body: "Con una diferencia menor, el producto no se publica.",
  },
  {
    title: "Precio y fecha a la vista",
    body: "Cada comparación muestra los dos precios y el día en que se tomaron.",
  },
];

export const CHANNEL_HEADING = "Los imperdibles del día, en Telegram";

export const CHANNEL_LEAD = "Un aviso por cada producto que pasa el filtro. Nada más.";

export const CHANNEL_CTA = "Abrir el canal";

export const NAV = {
  hoy: "Hoy",
  como: "Cómo elegimos",
  canal: "Canal de Telegram",
} as const;

export const EMPTY_PAGE = "Todavía no hay imperdibles publicados.";

/** `fechaCorta` is the short date ("10/11/2026"). */
export const CARD_FOOTER = (fechaCorta: string, label: "lista" | "actual" = PRICE_LABEL): string =>
  `Mismo modelo, precio ${label === "lista" ? "de lista" : "actual"} al ${fechaCorta}`;

/** `pct` is the formatted percentage ("19,7"). */
export const PCT_BADGE = (pct: string): string => `${pct}% menos`;
