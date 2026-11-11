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

// ML's GTIN attribute can hold several codes ("850015249389, 6941812703670"): split on anything
// that is not a digit, so they are never glued into one number. Leading zeros are dropped.
function normalizeGtins(g: string | null): string[] {
  if (g === null) return [];
  const codes = g
    .split(/[^0-9]+/)
    .map((d) => d.replace(/^0+/, ""))
    .filter((d) => d !== "");
  return [...new Set(codes)];
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

// ML's MODEL attribute often holds the manufacturer code (e.g. E101) while the title holds the
// commercial one (S40C), so both sources are kept apart: each is checked on its own for a high match.
function mlCodeSources(c: Comparable): string[][] {
  const fromModel = c.model ? extractModelCodes(c.model) : [];
  const fromTitle = extractModelCodes(c.title);
  return [fromModel, fromTitle].filter((codes) => codes.length > 0);
}

function mlCodes(c: Comparable): string[] {
  return [...new Set(mlCodeSources(c).flat())];
}

/** High needs one store code equal to the single code of at least one ML source (MODEL or title). */
function singleCodeAgrees(ml: Comparable, codesOther: string[]): boolean {
  return codesOther.length === 1 && mlCodeSources(ml).some((codes) => codes.length === 1 && codes[0] === codesOther[0]);
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
  const gtinsA = normalizeGtins(ml.gtin);
  const gtinsB = normalizeGtins(other.gtin);
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

  if (gtinsA.length > 0 && gtinsB.length > 0) {
    const shared = gtinsA.find((g) => gtinsB.includes(g));
    if (shared === undefined) return null;
    match = { confidence: "high", rule: "gtin", evidence: { gtin: shared } };
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
    if (singleCodeAgrees(ml, codesOther) && sameList(variantsMl, variantsOther)) {
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
  // The brand written after the code ("Atar21c1pi Atma") is not a different model.
  const brandWords = new Set([ml.brand, other.brand].flatMap((b) => (b ? normalizeWords(b) : [])));
  const diff = [...sufML.filter((w) => !sufOther.includes(w)), ...sufOther.filter((w) => !sufML.includes(w))].filter(
    (w) => !brandWords.has(w),
  );
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
  if (highs.length === 1) return highs[0]!;
  // Several catalog products for the same model: a single shared GTIN is the stronger evidence.
  const byGtin = highs.filter((h) => h.match.rule === "gtin");
  return byGtin.length === 1 ? byGtin[0]! : { product: null, reason: "multiple_high" };
}
