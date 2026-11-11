import {
  parseCandidateList,
  type Candidate,
  type CandidateList,
  type StoreOffer,
} from "../contract/candidate-list.js";

type MlOffer = Candidate["ml"];
type OtherOffer = Candidate["others"][number];

export type MatchedGroup = {
  model_id: string;
  brand: string;
  title: string;
  image_url: string | null;
  ml: MlOffer;
  others: { offer: OtherOffer; rule: "gtin" | "brand_code_variant" }[];
};

/** True when ML is at least `thresholdPct` percent cheaper than the other price. Unrounded, integer arithmetic. */
export function passesThreshold(mlPrice: number, otherPrice: number, thresholdPct: number): boolean {
  if (otherPrice <= 0) return false;
  return (otherPrice - mlPrice) * 100 >= thresholdPct * otherPrice;
}

function byPriceThenStore(a: StoreOffer, b: StoreOffer): number {
  return a.price_ars - b.price_ars || (a.store < b.store ? -1 : a.store > b.store ? 1 : 0);
}

/** Replaces ml and others (rivals sorted ascending) and recomputes the differences from the cheapest rival. */
export function applyPrices(candidate: Candidate, ml: MlOffer, others: OtherOffer[]): Candidate {
  const sorted = [...others].sort(byPriceThenStore);
  const cheapest = sorted[0];
  if (!cheapest) throw new Error("applyPrices requires at least one rival");
  const difference_ars = cheapest.price_ars - ml.price_ars;
  return {
    ...candidate,
    ml,
    others: sorted,
    difference_ars,
    difference_pct: (difference_ars * 100) / cheapest.price_ars,
  };
}

export function buildCandidateList(input: {
  run_id: string;
  run_date: string;
  category: string;
  threshold_pct: number;
  groups: MatchedGroup[];
}): CandidateList {
  const withRivals = input.groups.filter((g) => g.others.length > 0);
  const candidates: Candidate[] = [];
  for (const g of withRivals) {
    const ranked = [...g.others].sort((a, b) => byPriceThenStore(a.offer, b.offer));
    const cheapest = ranked[0]!;
    if (!passesThreshold(g.ml.price_ars, cheapest.offer.price_ars, input.threshold_pct)) continue;
    const seed: Candidate = {
      candidate_id: `${input.run_id}:${g.model_id}`,
      model_id: g.model_id,
      brand: g.brand,
      title: g.title,
      image_url: g.image_url,
      ml: g.ml,
      others: [],
      difference_ars: 0,
      difference_pct: 0,
      confidence: "high",
      match_rule: cheapest.rule,
    };
    candidates.push(
      applyPrices(seed, g.ml, ranked.map((r) => r.offer)),
    );
  }
  candidates.sort(
    (a, b) =>
      b.difference_pct - a.difference_pct || (a.model_id < b.model_id ? -1 : a.model_id > b.model_id ? 1 : 0),
  );
  return parseCandidateList({
    version: 1,
    run_id: input.run_id,
    run_date: input.run_date,
    category: input.category,
    threshold_pct: input.threshold_pct,
    models_compared: withRivals.length,
    candidates,
  });
}
