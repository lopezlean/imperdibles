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
  confidence: "high" | "doubtful";
  rule: "gtin" | "brand_code_variant" | "partial";
  evidence: Record<string, unknown>;
  reason?: string;
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

// Brand equality: both brand set -> compare; one null -> the other's brand must appear as a whole word
// in the null side's title; both null -> unknown, so not equal.
function brandsEqual(a: Comparable, b: Comparable): boolean {
  const ba = a.brand ? normalizeBrand(a.brand) : null;
  const bb = b.brand ? normalizeBrand(b.brand) : null;
  if (ba !== null && bb !== null) return ba === bb;
  if (ba !== null) return containsWholeWord(b.title, ba);
  if (bb !== null) return containsWholeWord(a.title, bb);
  return false;
}

function brandOf(a: Comparable, b: Comparable): string | null {
  const m = a.brand ?? b.brand;
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
  if (c.model) {
    const fromModel = extractModelCodes(c.model);
    if (fromModel.length > 0) return fromModel;
  }
  return extractModelCodes(c.title);
}

function mlVariants(c: Comparable): string[] {
  const set = new Set([...extractVariants(c.title), ...(c.model ? extractVariants(c.model) : [])]);
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
  const codesOther = extractModelCodes(other.title);
  const variantsMl = mlVariants(ml);
  const variantsOther = extractVariants(other.title);

  let match: Match | null = null;
  // First applicable reason to lower to doubtful; guards never raise confidence.
  let lowered: { reason: string; extra: Record<string, unknown> } | null = null;
  const lower = (reason: string, extra: Record<string, unknown> = {}) => {
    lowered ??= { reason, extra };
  };

  if (gtinA !== null && gtinB !== null) {
    if (gtinA !== gtinB) return null;
    match = { confidence: "high", rule: "gtin", evidence: { gtin: gtinA } };
    // Cross-check: a shared GTIN must not contradict brand or model code.
    const brandMl = ml.brand ? normalizeBrand(ml.brand) : null;
    const brandOther = other.brand ? normalizeBrand(other.brand) : null;
    // One brand missing: the known brand must appear in the other title, but only when that title has a
    // model code (a bare generic title proves nothing either way).
    const titleOnlyConflict =
      (brandMl !== null && brandOther === null && codesOther.length > 0 && !brandsEqual(ml, other)) ||
      (brandOther !== null && brandMl === null && codesMl.length > 0 && !brandsEqual(ml, other));
    if ((brandMl !== null && brandOther !== null && brandMl !== brandOther) || titleOnlyConflict) {
      lower("brand_conflict", { brand_ml: brandMl, brand_other: brandOther });
    } else if (codesMl.length > 0 && codesOther.length > 0 && !codesMl.some((c) => codesOther.includes(c))) {
      lower("code_conflict", { codes_ml: codesMl, codes_other: codesOther });
    }
  } else if (brandsEqual(ml, other)) {
    const evidence = { codes_ml: codesMl, codes_other: codesOther, variants_ml: variantsMl, variants_other: variantsOther };
    if (codesMl.length === 1 && codesOther.length === 1 && codesMl[0] === codesOther[0] && sameList(variantsMl, variantsOther)) {
      match = { confidence: "high", rule: "brand_code_variant", evidence };
    } else if (codesMl.some((c) => codesOther.includes(c)) || prefixOverlap(codesMl, codesOther)) {
      match = { confidence: "doubtful", rule: "partial", evidence };
    }
  }
  if (match === null) return null;

  // Guards only ever lower a match to doubtful.
  const accML = hasAccessoryWords(ml.title) || isForBrand(ml.title, brandOf(ml, other));
  const accOther = hasAccessoryWords(other.title) || isForBrand(other.title, brandOf(ml, other));
  if (accML || accOther) lower("accessory", { accessory_in: accML && accOther ? "both" : accML ? "ml" : "other" });

  if (hasConditionWords(ml.title) || hasConditionWords(other.title)) lower("condition");

  if (hasBundleWords(ml.title) !== hasBundleWords(other.title)) lower("bundle");

  if (match.rule === "gtin" && !sameList(variantsMl, variantsOther)) {
    lower("variant", { variants_ml: variantsMl, variants_other: variantsOther });
  }

  const sufML = extractCodeSuffixWords(ml.title);
  const sufOther = extractCodeSuffixWords(other.title);
  const diff = [...sufML.filter((w) => !sufOther.includes(w)), ...sufOther.filter((w) => !sufML.includes(w))];
  if (diff.length > 0) lower("model_suffix", { suffixes: diff });

  const pa = ml.price_ars;
  const pb = other.price_ars;
  if (pa !== null && pb !== null) {
    const lo = Math.min(pa, pb);
    const hi = Math.max(pa, pb);
    if (lo <= 0 || hi / lo > PRICE_RATIO_LIMIT) lower("price_ratio", { price_ml: pa, price_other: pb });
  }

  if (lowered === null) return match;
  const { reason, extra } = lowered as { reason: string; extra: Record<string, unknown> };
  return { ...match, confidence: "doubtful", reason, evidence: { ...match.evidence, ...extra } };
}

export function pickCatalogProduct(
  store: Comparable,
  results: MlProduct[],
): { product: MlProduct; match: Match } | { product: null; reason: "no_high" | "multiple_high" } {
  const highs: { product: MlProduct; match: Match }[] = [];
  for (const product of results) {
    const match = matchListings(product, store);
    if (match?.confidence === "high") highs.push({ product, match });
  }
  if (highs.length === 0) return { product: null, reason: "no_high" };
  if (highs.length > 1) return { product: null, reason: "multiple_high" };
  return highs[0]!;
}
