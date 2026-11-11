import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCandidateList, type Candidate } from "../../../src/contract/candidate-list.js";
import { barWidthPct, buildCardTree, type CardNode } from "../../../src/output/card/tree.js";
import { TOKENS } from "../../../src/output/design-tokens.js";

const opts = { run_date: "2026-11-10" };

function load(n: string) {
  return parseCandidateList(JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "lista-candidatos", n), "utf8")));
}

function offer(store: string, price: number) {
  return {
    store,
    listing_title: "x",
    url: `https://example.test/${store}`,
    price_ars: price,
    observed_at: "2026-11-10T06:12:00-03:00",
    external_ref: store,
    seller: null,
  };
}

function candidate(title: string, ml: number, rivals: [string, number][]): Candidate {
  const others = [...rivals].sort((a, b) => a[1] - b[1]).map(([t, p]) => offer(t, p));
  return {
    candidate_id: "c",
    model_id: "m",
    brand: "Marca",
    title,
    image_url: null,
    ml: { ...offer("ml", ml), store: "ml" as const, ml_product_id: "p", ml_seller_id: "s" },
    others,
    difference_ars: others[0]!.price_ars - ml,
    difference_pct: 0,
    confidence: "high",
    match_rule: "brand_code_variant",
  };
}

const kids = (n: CardNode): (CardNode | string)[] =>
  n.props.children === undefined ? [] : Array.isArray(n.props.children) ? n.props.children : [n.props.children];

function walk(n: CardNode, f: (n: CardNode) => void) {
  f(n);
  for (const k of kids(n)) if (typeof k !== "string") walk(k, f);
}

function textOf(n: CardNode): string {
  return kids(n).map((k) => (typeof k === "string" ? k : textOf(k))).join(" ");
}

function byRole(n: CardNode, role: string): CardNode[] {
  const out: CardNode[] = [];
  walk(n, (x) => {
    if (x.props["data-role"] === role) out.push(x);
  });
  return out;
}

const barWidths = (n: CardNode) => byRole(n, "bar").map((b) => Number(String(b.props.style?.width).replace("%", "")));
const rivalNames = (n: CardNode) => byRole(n, "rival-name").map(textOf);
const titleOf = (n: CardNode) => textOf(byRole(n, "title")[0]!);
const rootStyle = (n: CardNode) => n.props.style!;

describe("barWidthPct", () => {
  it("rounds to one decimal", () => {
    expect(barWidthPct(329999, 399999)).toBe(82.5);
    expect(barWidthPct(399999, 399999)).toBe(100);
  });
});

describe("buildCardTree", () => {
  const one = candidate("Xiaomi Robot Vacuum S40C", 329999, [["fravega", 399999]]);
  const three = load("valid-three-rivals.json").candidates[0]!;
  const treeOne = buildCardTree(one, opts);
  const tree3 = buildCardTree(three, opts);

  it("one rival", () => {
    expect(treeOne).toMatchSnapshot();
    expect(textOf(treeOne)).toContain("17,5% menos");
    expect(textOf(treeOne)).toContain("Mismo modelo, precio de lista al 10/11/2026");
    expect(textOf(treeOne)).toContain("Diferencia: $70.000");
    expect(barWidths(treeOne)).toEqual([82.5, 100]);
    expect(rivalNames(treeOne)).toEqual(["Frávega"]);
    expect(rootStyle(treeOne)).toMatchObject({ width: 1200, height: 675 });
  });

  it("three rivals", () => {
    expect(tree3).toMatchSnapshot();
    expect(rivalNames(tree3)).toEqual(["Frávega", "Cetrogar", "Musimundo"]);
    expect(titleOf(tree3).length).toBeLessThanOrEqual(60);
    expect(titleOf(tree3).endsWith("…")).toBe(true);
    expect(rootStyle(tree3)).toMatchObject({ width: 1200, height: 675 });
    const w = barWidths(tree3);
    expect(w).toHaveLength(4);
    expect(w[w.length - 1]).toBe(100);
    expect(w[0]).toBe(barWidthPct(329999, 419999));
    expect(w).toEqual([...w].sort((a, b) => a - b));
  });

  it("shows only the three cheapest of five rivals", () => {
    const five = candidate("Modelo", 300000, [
      ["musimundo", 450000],
      ["fravega", 400000],
      ["otra1", 900000],
      ["cetrogar", 420000],
      ["otra2", 800000],
    ]);
    const t = buildCardTree(five, opts);
    expect(rivalNames(t)).toEqual(["Frávega", "Cetrogar", "Musimundo"]);
    expect(barWidths(t)).toEqual([barWidthPct(300000, 450000), barWidthPct(400000, 450000), barWidthPct(420000, 450000), 100]);
    expect(textOf(t)).not.toContain("900.000");
  });

  it("is Satori-compatible and styled from tokens", () => {
    for (const t of [treeOne, tree3]) {
      walk(t, (n) => {
        if (kids(n).length > 1) expect(n.props.style?.display, n.type).toBe("flex");
      });
    }
    const logo = byRole(tree3, "logo")[0]!;
    const accent = kids(logo).find((k): k is CardNode => typeof k !== "string" && textOf(k) === ".ar")!;
    expect(accent.props.style?.color).toBe(TOKENS.accent);
    expect(rootStyle(tree3).background).toBe(TOKENS.bg);
    expect(textOf(tree3)).toContain("Foto del producto");
  });

  it("uses smaller rival prices and gaps with 2 or 3 rivals", () => {
    const rivalPrice = (n: CardNode) => byRole(n, "rival-price")[0]!.props.style?.fontSize;
    expect(rivalPrice(treeOne)).toBe(30);
    expect(rivalPrice(tree3)).toBe(26);
    expect(byRole(tree3, "prices")[0]!.props.style?.gap).toBe(10);
    expect(byRole(treeOne, "prices")[0]!.props.style?.gap).toBe(14);
  });
});
