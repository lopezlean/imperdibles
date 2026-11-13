import type { Product } from "./products.js";

export type PricePoint = { run_date: string; price: number };

export type PriceVerdict = { kind: "first" } | { kind: "lowest" } | { kind: "above"; pct: number };

export type PriceHistory = { points: PricePoint[]; min: number; max: number; verdict: PriceVerdict };

/** Mercado Libre price per published day, oldest first, and how the latest price compares to the best one seen. */
export function priceHistory(p: Product): PriceHistory {
  const points = [...p.history].reverse().map((d) => ({ run_date: d.run_date, price: d.candidate.ml.price_ars }));
  const prices = points.map((x) => x.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const latest = points[points.length - 1]!.price;
  const verdict: PriceVerdict =
    points.length < 2 ? { kind: "first" } : latest <= min ? { kind: "lowest" } : { kind: "above", pct: Math.round(((latest - min) / min) * 100) };
  return { points, min, max, verdict };
}
