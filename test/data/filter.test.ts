import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyPrices,
  buildCandidateList,
  passesThreshold,
  type MatchedGroup,
} from "../../src/data/filter.js";
import { parseCandidateList, type Candidate, type StoreOffer } from "../../src/contract/candidate-list.js";

type Other = Exclude<StoreOffer, { store: "ml" }>;
type Ml = Extract<StoreOffer, { store: "ml" }>;

const ml = (price: number, id = "1"): Ml => ({
  store: "ml",
  listing_title: "t",
  url: `https://www.mercadolibre.com.ar/p/MLA${id}`,
  price_ars: price,
  observed_at: "2026-11-10T06:12:00-03:00",
  external_ref: `MLA${id}`,
  seller: "Tienda oficial",
  ml_product_id: `MLA${id}`,
  ml_seller_id: "10",
});
const other = (price: number, store = "fravega"): Other => ({
  store,
  listing_title: "t",
  url: `https://www.${store}.com/p/x`,
  price_ars: price,
  observed_at: "2026-11-10T06:14:00-03:00",
  external_ref: "X",
  seller: null,
});
const group = (
  model_id: string,
  mlPrice: number,
  rivals: { offer: Other; rule?: "gtin" | "brand_code_variant" }[],
): MatchedGroup => ({
  model_id,
  brand: "Marca",
  title: `Titulo ${model_id}`,
  image_url: null,
  ml: ml(mlPrice),
  others: rivals.map((r) => ({ offer: r.offer, rule: r.rule ?? "brand_code_variant" })),
});
const base = { run_id: "run1", run_date: "2026-11-10", category: "cat", threshold_pct: 15 };

describe("passesThreshold", () => {
  it("uses the unrounded difference", () => {
    expect(passesThreshold(85010, 100000, 15)).toBe(false);
    expect(passesThreshold(85000, 100000, 15)).toBe(true);
    expect(passesThreshold(84990, 100000, 15)).toBe(true);
    expect(passesThreshold(90000, 100000, 10)).toBe(true);
    expect(passesThreshold(100000, 100000, 15)).toBe(false);
  });
});

describe("buildCandidateList", () => {
  it("compares against the cheapest rival", () => {
    const list = buildCandidateList({
      ...base,
      groups: [group("A", 85000, [{ offer: other(120000, "cetrogar") }, { offer: other(100000) }])],
    });
    expect(list.candidates).toHaveLength(1);
    const c = list.candidates[0]!;
    expect(c.candidate_id).toBe("run1:A");
    expect(c.difference_ars).toBe(15000);
    expect(c.others.map((o) => o.price_ars)).toEqual([100000, 120000]);
  });

  it("excludes a model that only beats a pricier rival", () => {
    const list = buildCandidateList({
      ...base,
      groups: [group("A", 90000, [{ offer: other(120000, "cetrogar") }, { offer: other(100000) }])],
    });
    expect(list.candidates).toEqual([]);
    expect(list.models_compared).toBe(1);
  });

  it("takes the rule from the cheapest rival and ties by store", () => {
    const list = buildCandidateList({
      ...base,
      groups: [
        group("A", 50000, [
          { offer: other(100000, "musimundo"), rule: "gtin" },
          { offer: other(100000, "cetrogar"), rule: "brand_code_variant" },
        ]),
      ],
    });
    const c = list.candidates[0]!;
    expect(c.others.map((o) => o.store)).toEqual(["cetrogar", "musimundo"]);
    expect(c.match_rule).toBe("brand_code_variant");
  });

  it("is deterministic and sorted by difference_pct desc, ties by model_id", () => {
    const groups = [
      group("B", 80000, [{ offer: other(100000) }]),
      group("C", 70000, [{ offer: other(100000) }]),
      group("A", 80000, [{ offer: other(100000) }]),
    ];
    const first = buildCandidateList({ ...base, groups });
    expect(buildCandidateList({ ...base, groups })).toEqual(first);
    expect(first.candidates.map((c) => c.model_id)).toEqual(["C", "A", "B"]);
  });

  it("counts only groups with rivals as compared", () => {
    const list = buildCandidateList({
      ...base,
      groups: [group("A", 90000, [{ offer: other(100000) }]), group("B", 90000, [])],
    });
    expect(list.candidates).toEqual([]);
    expect(list.models_compared).toBe(1);
  });

  it("rebuilds the candidates of the valid fixture", () => {
    const fixture = parseCandidateList(
      JSON.parse(readFileSync("fixtures/lista-candidatos/valid-2026-11-10.json", "utf8")),
    );
    const groups: MatchedGroup[] = fixture.candidates.map((c) => ({
      model_id: c.model_id,
      brand: c.brand,
      title: c.title,
      image_url: c.image_url,
      ml: c.ml,
      others: [...c.others].reverse().map((offer) => ({ offer, rule: c.match_rule })),
    }));
    const list = buildCandidateList({
      run_id: fixture.run_id,
      run_date: fixture.run_date,
      category: fixture.category,
      threshold_pct: fixture.threshold_pct,
      groups: [...groups].reverse(),
    });
    expect(list.candidates).toHaveLength(fixture.candidates.length);
    list.candidates.forEach((c, i) => {
      const f = fixture.candidates[i]!;
      expect(c.candidate_id).toBe(f.candidate_id);
      expect(c.difference_ars).toBe(f.difference_ars);
      expect(Math.abs(c.difference_pct - f.difference_pct)).toBeLessThan(1e-9);
      expect(c.match_rule).toBe(f.match_rule);
    });
  });
});

describe("applyPrices", () => {
  it("sorts rivals and recomputes differences, keeping other fields", () => {
    const candidate: Candidate = {
      candidate_id: "run1:A",
      model_id: "A",
      brand: "M",
      title: "T",
      image_url: null,
      ml: ml(90000),
      others: [other(300000)],
      difference_ars: 210000,
      difference_pct: 70,
      confidence: "high",
      match_rule: "gtin",
    };
    const next = applyPrices(candidate, ml(85000), [other(120000, "cetrogar"), other(100000)]);
    expect(next.others.map((o) => o.price_ars)).toEqual([100000, 120000]);
    expect(next.difference_ars).toBe(15000);
    expect(Math.abs(next.difference_pct - 15)).toBeLessThan(1e-9);
    expect(next.ml.price_ars).toBe(85000);
    expect({ ...next, ml: 0, others: 0, difference_ars: 0, difference_pct: 0 }).toEqual({
      ...candidate,
      ml: 0,
      others: 0,
      difference_ars: 0,
      difference_pct: 0,
    });
  });
});
