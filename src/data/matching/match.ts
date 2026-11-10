import type { Comparable } from "../types.js";
import type { MlProduct } from "../ml/catalog.js";
import {
  extractCodeSuffixWords,
  extractModelCodes,
  extractVariants,
  hasAccessoryWords,
  hasBundleWords,
  hasConditionWords,
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

function brandOf(a: Comparable, b: Comparable): string | null {
  const m = a.marca ?? b.marca;
  return m ? normalizeBrand(m) : null;
}

// "para <brand>" or "compatible con <brand>": the title is for owners of the robot, not the robot.
function isForBrand(title: string, brand: string | null): boolean {
  if (brand === null) return false;
  const words = normalizeWords(title);
  const needle = normalizeWords(brand);
  if (needle.length === 0) return false;
  const at = words.findIndex((_, i) => needle.every((n, k) => words[i + k] === n));
  if (at <= 0) return false;
  const before = words.slice(0, at);
  return before.includes("PARA") || before.some((w, i) => w === "COMPATIBLE" && before[i + 1] === "CON");
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
  // First applicable reason to lower to dudosa; guards never raise confidence.
  let lowered: { motivo: string; extra: Record<string, unknown> } | null = null;
  const lower = (motivo: string, extra: Record<string, unknown> = {}) => {
    lowered ??= { motivo, extra };
  };

  if (gtinA !== null && gtinB !== null) {
    if (gtinA !== gtinB) return null;
    match = { confianza: "alta", regla: "gtin", evidencia: { gtin: gtinA } };
    // Cross-check: a shared GTIN must not contradict brand or model code.
    const brandMl = ml.marca ? normalizeBrand(ml.marca) : null;
    const brandOther = other.marca ? normalizeBrand(other.marca) : null;
    if (brandMl !== null && brandOther !== null && brandMl !== brandOther) {
      lower("marca_conflicto", { marca_ml: brandMl, marca_otra: brandOther });
    } else if (codesMl.length > 0 && codesOther.length > 0 && !codesMl.some((c) => codesOther.includes(c))) {
      lower("codigo_conflicto", { codigos_ml: codesMl, codigos_otra: codesOther });
    }
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
  const accML = hasAccessoryWords(ml.titulo) || isForBrand(ml.titulo, brandOf(ml, other));
  const accOther = hasAccessoryWords(other.titulo) || isForBrand(other.titulo, brandOf(ml, other));
  if (accML || accOther) lower("accesorio", { accesorio_en: accML && accOther ? "ambas" : accML ? "ml" : "otra" });

  if (hasConditionWords(ml.titulo) || hasConditionWords(other.titulo)) lower("condicion");

  if (hasBundleWords(ml.titulo) !== hasBundleWords(other.titulo)) lower("bundle");

  if (match.regla !== "gtin") {
    const sufML = extractCodeSuffixWords(ml.titulo);
    const sufOther = extractCodeSuffixWords(other.titulo);
    const diff = [...sufML.filter((w) => !sufOther.includes(w)), ...sufOther.filter((w) => !sufML.includes(w))];
    if (diff.length > 0) lower("sufijo_modelo", { sufijos: diff });
  }

  const pa = ml.precio_ars;
  const pb = other.precio_ars;
  if (pa !== null && pb !== null) {
    const lo = Math.min(pa, pb);
    const hi = Math.max(pa, pb);
    if (lo <= 0 || hi / lo > PRICE_RATIO_LIMIT) lower("cociente_precio", { precio_ml: pa, precio_otra: pb });
  }

  if (lowered === null) return match;
  const { motivo, extra } = lowered as { motivo: string; extra: Record<string, unknown> };
  return { ...match, confianza: "dudosa", motivo, evidencia: { ...match.evidencia, ...extra } };
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
