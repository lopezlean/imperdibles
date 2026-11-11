import { describe, expect, it } from "vitest";
import type { Candidate } from "../../src/contract/candidate-list.js";
import { AFFILIATE_LEGEND, NOT_AFFILIATED, PRICE_LABEL, storeName } from "../../src/output/copy.js";
import {
  formatArs,
  formatDateLong,
  formatDateShort,
  formatPct,
  formatThreshold,
  pctTenths,
  truncate,
} from "../../src/output/format.js";

const offer = (store: string, price_ars: number) => ({
  store,
  listing_title: "x",
  url: "https://example.test/x",
  price_ars,
  observed_at: "2026-11-10T10:00:00-03:00",
  external_ref: "r",
  seller: null,
});

function c(ml: number, ...others: number[]): Pick<Candidate, "ml" | "others"> {
  return {
    ml: { ...offer("ml", ml), store: "ml", ml_product_id: "p", ml_seller_id: "s" },
    others: others.map((p) => offer("fravega", p)),
  } as Pick<Candidate, "ml" | "others">;
}

describe("formatArs", () => {
  it("uses dot thousands separators", () => {
    expect(formatArs(264699)).toBe("$264.699");
    expect(formatArs(1199999)).toBe("$1.199.999");
    expect(formatArs(999)).toBe("$999");
  });
});

describe("pctTenths / formatPct", () => {
  it("truncates to one decimal, never rounds up", () => {
    expect(formatPct(c(264699, 329999))).toBe("19,7"); // design mock shows 19,8; spec truncates
    expect(formatPct(c(329999, 399999))).toBe("17,5");
    expect(formatPct(c(994899, 1199999))).toBe("17,0");
    expect(formatPct(c(569000, 669899))).toBe("15,0");
    expect(formatPct(c(85000, 100000))).toBe("15,0");
  });
  it("compares against the cheapest rival", () => {
    expect(formatPct(c(85000, 100000, 120000))).toBe("15,0");
    expect(formatPct(c(85000, 120000, 100000))).toBe("15,0");
  });
  it("returns tenths as an integer", () => {
    expect(pctTenths(85000, 100000)).toBe(150);
    expect(pctTenths(264699, 329999)).toBe(197);
  });
});

describe("formatThreshold", () => {
  it("renders integers plain and decimals with a comma", () => {
    expect(formatThreshold(15)).toBe("15");
    expect(formatThreshold(12.5)).toBe("12,5");
  });
});

describe("dates", () => {
  it("formats long and short", () => {
    expect(formatDateLong("2026-11-10")).toBe("10 de noviembre de 2026");
    expect(formatDateLong("2026-03-01")).toBe("1 de marzo de 2026");
    expect(formatDateShort("2026-11-01")).toBe("01/11/2026");
    expect(formatDateShort("2026-11-10")).toBe("10/11/2026");
  });
});

describe("truncate", () => {
  it("adds an ellipsis within max characters", () => {
    expect(truncate("a".repeat(70), 60)).toHaveLength(60);
    expect(truncate("a".repeat(70), 60).endsWith("…")).toBe(true);
    expect(truncate("corto", 60)).toBe("corto");
  });
});

describe("copy", () => {
  it("maps store ids to names with id fallback", () => {
    expect(storeName("ml")).toBe("Mercado Libre");
    expect(storeName("fravega")).toBe("Frávega");
    expect(storeName("tienda-nueva")).toBe("tienda-nueva");
  });
  it("carries the spec-fixed legends", () => {
    expect(PRICE_LABEL).toBe("actual");
    expect(AFFILIATE_LEGEND).toBe(
      "Los enlaces a Mercado Libre son de afiliado: recibimos una comisión por cada compra, sin costo adicional.",
    );
    expect(NOT_AFFILIATED).toBe("imperdibles.com.ar no pertenece a Mercado Libre ni a las tiendas comparadas.");
  });
});
