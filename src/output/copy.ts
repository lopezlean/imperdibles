/** Spec-fixed copy and constants. Plain values only: Worker-safe, never read from a file at runtime. */

/** Duplicates `tiendas.nombre` on purpose: the Worker must not read it per request. */
export const STORE_NAMES: Record<string, string> = {
  ml: "Mercado Libre",
  fravega: "Frávega",
  cetrogar: "Cetrogar",
  musimundo: "Musimundo",
};

/** Display name for a store id; unknown ids fall back to the id itself. */
export function storeName(id: string): string {
  return Object.hasOwn(STORE_NAMES, id) ? STORE_NAMES[id]! : id;
}

// TODO(V1): docs/verification/data.md V1 is PENDING OWNER; switch here once recorded.
export const PRICE_LABEL: "lista" | "actual" = "lista" as "lista" | "actual";

export const AFFILIATE_LEGEND =
  "Los enlaces a Mercado Libre son de afiliado: recibimos una comisión por cada compra, sin costo adicional.";

export const NOT_AFFILIATED = "imperdibles.ar no pertenece a Mercado Libre ni a las tiendas comparadas.";
