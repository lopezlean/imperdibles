import type { Comparable } from "../types.js";
import type { MlProduct } from "../ml/catalog.js";
import {
  extractModelCodes,
  extractVariants,
  hasAccessoryWords,
  normalizeBrand,
  normalizeWords,
} from "./normalize.js";

export type Match = {
  confianza: "alta" | "dudosa";
  regla: "gtin" | "marca_codigo_variante" | "parcial";
  evidencia: Record<string, unknown>;
  motivo?: string;
};

const PRICE_RATIO_LIMIT = 2.0;

function normalizeGtin(g: string | null): string | null {
  if (g === null) return null;
  const digits = g.replace(/\D/g, "").replace(/^0+/, "");
  return digits === "" ? null : digits;
}

function containsWholeWord(title: string, brand: string): boolean {
  const words = normalizeWords(title).join(" ");
  const needle = normalizeWords(brand).join(" ");
  if (needle === "") return false;
  return ` ${words} `.includes(` ${needle} `);
}

// Brand equality: both marca set -> compare; one null -> the other's brand must appear as a whole word
// in the null side's title; both null -> unknown, so not equal.
function brandsEqual(a: Comparable, b: Comparable): boolean {
  const ba = a.marca ? normalizeBrand(a.marca) : null;
  const bb = b.marca ? normalizeBrand(b.marca) : null;
  if (ba !== null && bb !== null) return ba === bb;
  if (ba !== null) return containsWholeWord(b.titulo, ba);
  if (bb !== null) return containsWholeWord(a.titulo, bb);
  return false;
}

function mlCodes(c: Comparable): string[] {
  if (c.modelo) {
    const fromModel = extractModelCodes(c.modelo);
    if (fromModel.length > 0) return fromModel;
  }
  return extractModelCodes(c.titulo);
}

function mlVariants(c: Comparable): string[] {
  const set = new Set([...extractVariants(c.titulo), ...(c.modelo ? extractVariants(c.modelo) : [])]);
  return [...set].sort();
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function prefixOverlap(a: string[], b: string[]): boolean {
  return a.some((x) => b.some((y) => x !== y && Math.min(x.length, y.length) >= 2 && (x.startsWith(y) || y.startsWith(x))));
}

export function matchListings(ml: Comparable, other: Comparable): Match | null {
  const gtinA = normalizeGtin(ml.gtin);
  const gtinB = normalizeGtin(other.gtin);
  const codesMl = mlCodes(ml);
  const codesOther = extractModelCodes(other.titulo);
  const variantsMl = mlVariants(ml);
  const variantsOther = extractVariants(other.titulo);

  let match: Match | null = null;

  if (gtinA !== null && gtinB !== null) {
    if (gtinA !== gtinB) return null;
    match = { confianza: "alta", regla: "gtin", evidencia: { gtin: gtinA } };
  } else if (brandsEqual(ml, other)) {
    const evidencia = { codigos_ml: codesMl, codigos_otra: codesOther, variantes_ml: variantsMl, variantes_otra: variantsOther };
    if (codesMl.length === 1 && codesOther.length === 1 && codesMl[0] === codesOther[0] && sameList(variantsMl, variantsOther)) {
      match = { confianza: "alta", regla: "marca_codigo_variante", evidencia };
    } else if (codesMl.some((c) => codesOther.includes(c)) || prefixOverlap(codesMl, codesOther)) {
      match = { confianza: "dudosa", regla: "parcial", evidencia };
    }
  }
  if (match === null) return null;

  // Guards only ever lower a match to dudosa.
  const accML = hasAccessoryWords(ml.titulo);
  const accOther = hasAccessoryWords(other.titulo);
  if (accML !== accOther) {
    return { ...match, confianza: "dudosa", motivo: "accesorio", evidencia: { ...match.evidencia, accesorio_en: accML ? "ml" : "otra" } };
  }
  const pa = ml.precio_ars;
  const pb = other.precio_ars;
  if (pa !== null && pb !== null) {
    const lo = Math.min(pa, pb);
    const hi = Math.max(pa, pb);
    if (lo <= 0 || hi / lo > PRICE_RATIO_LIMIT) {
      return { ...match, confianza: "dudosa", motivo: "cociente_precio", evidencia: { ...match.evidencia, precio_ml: pa, precio_otra: pb } };
    }
  }
  return match;
}

export function pickCatalogProduct(
  store: Comparable,
  results: MlProduct[],
): { product: MlProduct; match: Match } | { product: null; reason: "no_alta" | "multiple_alta" } {
  const altas: { product: MlProduct; match: Match }[] = [];
  for (const product of results) {
    const match = matchListings(product, store);
    if (match?.confianza === "alta") altas.push({ product, match });
  }
  if (altas.length === 0) return { product: null, reason: "no_alta" };
  if (altas.length > 1) return { product: null, reason: "multiple_alta" };
  return altas[0]!;
}
