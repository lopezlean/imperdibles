import { describe, expect, it } from "vitest";
import {
  extractModelCodes,
  extractVariants,
  hasAccessoryWords,
  normalizeBrand,
} from "../../../src/data/matching/normalize.js";
import { matchListings, pickCatalogProduct } from "../../../src/data/matching/match.js";
import type { Comparable } from "../../../src/data/types.js";
import type { MlProduct } from "../../../src/data/ml/catalog.js";

type Spec = string | { titulo: string; gtin?: string | null; marca?: string | null; modelo?: string | null; precio?: number | null };

function spec(s: Spec) {
  return typeof s === "string" ? { titulo: s } : s;
}

// ML side: brand taken from the catalog `marca` attribute (first title word in these tests).
function ml(s: Spec, precio: number | null = null): Comparable {
  const x = spec(s);
  return {
    tienda: "mercadolibre",
    titulo: x.titulo,
    marca: x.marca !== undefined ? x.marca : x.titulo.split(" ")[0]!,
    modelo: x.modelo ?? null,
    gtin: x.gtin ?? null,
    precio_ars: x.precio ?? precio,
  };
}

// Store side: title-only listing, brand unknown.
function other(s: Spec, precio: number | null = null): Comparable {
  const x = spec(s);
  return {
    tienda: "fravega",
    titulo: x.titulo,
    marca: x.marca ?? null,
    modelo: x.modelo ?? null,
    gtin: x.gtin ?? null,
    precio_ars: x.precio ?? precio,
  };
}

function p(titulo: string): MlProduct {
  return { ...ml(titulo), id: `MLA-${titulo}`, url: "https://example.test/p", imagen_url: null };
}

// PLACEHOLDER pair: docs/verification/data.md V7 is still PENDING OWNER, so these titles
// are NOT the owner's doubtful pair. Replace with the real titles once V7 is written.
const V7_ML_TITLE = "Xiaomi Robot Vacuum E5";
const V7_OTHER_TITLE = "Xiaomi Robot Vacuum E5 Pro Plus";

describe("matchListings table", () => {
  it.each([
    [{ titulo: "Xiaomi Robot Vacuum S40C", gtin: "6941812700000" }, { titulo: "Aspiradora Xiaomi S40C", gtin: "6941812700000" }, "alta", "gtin"],
    [{ titulo: "Xiaomi Robot Vacuum S40C", gtin: "6941812700000" }, { titulo: "Xiaomi S40C", gtin: "6941812700017" }, null, null],
    ["Xiaomi Robot Vacuum S40C", "Aspiradora Robot Xiaomi S40C Negra", "alta", "marca_codigo_variante"],
    ["Smartlife RVCL050, mapeo láser", "Robot Aspiradora Smartlife RVC-L050", "alta", "marca_codigo_variante"],
    ["Xiaomi Robot Vacuum H50 Pro", "Xiaomi Robot Vacuum H50", "dudosa", "parcial"],
    ["Xiaomi Robot Vacuum H50 Pro", "Xiaomi H50Pro", "alta", "marca_codigo_variante"],
    ["Roborock S8+", "Roborock S8 Plus", "alta", "marca_codigo_variante"],
    ["Xiaomi S40", "Xiaomi S40C", "dudosa", "parcial"],
    ["Xiaomi S40C", "Samsung S40C", null, null],
    ["Electrolux ERB80 4000Pa", "Electrolux ERB80", "alta", "marca_codigo_variante"],
    [V7_ML_TITLE, V7_OTHER_TITLE, "dudosa", expect.any(String)],
  ])("%j vs %j", (a, b, confianza, regla) => {
    const m = matchListings(ml(a as Spec), other(b as Spec));
    if (confianza === null) {
      expect(m).toBeNull();
    } else {
      expect(m).toMatchObject({ confianza, regla });
    }
  });
});

describe("normalize", () => {
  it("normalizes brand", () => {
    expect(normalizeBrand("Électrolux ")).toBe("ELECTROLUX");
  });
  it("extracts codes", () => {
    expect(extractModelCodes("Xiaomi Robot Vacuum H50Pro")).toEqual(["H50"]);
    expect(extractModelCodes("Smartlife RVC-L050 4000Pa 5200mAh 2.5L 40W")).toEqual(["RVCL050"]);
    expect(extractModelCodes("Roborock S8+")).toEqual(["S8"]);
  });
  it("extracts variants", () => {
    expect(extractVariants("Xiaomi H50Pro")).toEqual(["PRO"]);
    expect(extractVariants("Roborock S8+")).toEqual(["PLUS"]);
    expect(extractVariants("Xiaomi Ultra Pro S1")).toEqual(["PRO", "ULTRA"]);
  });
  it("detects accessory words", () => {
    expect(hasAccessoryWords("Aspiradora robot para pisos Xiaomi S40C")).toBe(false);
    expect(hasAccessoryWords("Kit de repuestos Xiaomi S40C")).toBe(true);
    expect(hasAccessoryWords("Base de autovaciado Xiaomi S40C")).toBe(true);
    expect(hasAccessoryWords("Aspiradora con base Xiaomi S40C")).toBe(false);
  });
});

describe("guards and brand source", () => {
  it("reads the brand from the title when the store marca is null", () => {
    expect(matchListings(ml("Xiaomi S40C", 329999), other("Aspiradora Robot Xiaomi S40C Negra", 399999))).toMatchObject({ confianza: "alta" });
  });
  it("lowers packs", () => {
    expect(matchListings(ml("Xiaomi S40C", 329999), other("Pack x2 Xiaomi S40C", 699998))?.confianza).toBe("dudosa");
  });
  it("lowers accessories", () => {
    expect(matchListings(ml("Xiaomi S40C", 329999), other("Filtro HEPA para Xiaomi S40C", 15999))?.motivo).toBe("accesorio");
  });
  it("lowers a leading 'base' (Review Focus 1)", () => {
    expect(matchListings(ml("Xiaomi S40C", 329999), other("Base de autovaciado Xiaomi S40C", 249999))?.confianza).toBe("dudosa");
  });
  it("lowers a spare-parts kit priced within range", () => {
    const m = matchListings(ml("Xiaomi S40C", 329999), other("Kit de repuestos para Xiaomi S40C", 300000));
    expect(m).toMatchObject({ confianza: "dudosa", motivo: "accesorio" });
  });
  it("lowers an implausible price ratio", () => {
    expect(matchListings(ml("Xiaomi S40C", 329999), other("Xiaomi S40C", 120000))?.motivo).toBe("cociente_precio");
  });
  it("applies the guards to a GTIN match too", () => {
    const m = matchListings(
      ml({ titulo: "Xiaomi S40C", gtin: "6941812700000" }, 329999),
      other({ titulo: "Xiaomi S40C", gtin: "6941812700000" }, 120000),
    );
    expect(m).toMatchObject({ confianza: "dudosa", regla: "gtin", motivo: "cociente_precio" });
  });
  it("returns null when no brand can be established", () => {
    expect(matchListings(ml({ titulo: "S40C", marca: null }), other("Xiaomi S40C"))).toBeNull();
  });
  it("prefers the ML modelo attribute over the title", () => {
    const m = matchListings(ml({ titulo: "Xiaomi Robot Aspirador Premium", modelo: "S40C" }), other("Xiaomi S40C"));
    expect(m).toMatchObject({ confianza: "alta" });
  });
  it("is dudosa with two model codes on one side", () => {
    expect(matchListings(ml("Xiaomi S40C"), other("Xiaomi S40C X10"))?.confianza).toBe("dudosa");
  });
});

describe("pickCatalogProduct", () => {
  it("rejects several alta candidates", () => {
    expect(pickCatalogProduct(other("Xiaomi S40C"), [p("Xiaomi S40C"), p("Xiaomi S40C Negro")])).toEqual({ product: null, reason: "multiple_alta" });
  });
  it("rejects when nothing is alta", () => {
    expect(pickCatalogProduct(other("Xiaomi S40C"), [p("Xiaomi S40")])).toEqual({ product: null, reason: "no_alta" });
  });
  it("returns the single alta product", () => {
    const r = pickCatalogProduct(other("Xiaomi S40C"), [p("Xiaomi S40"), p("Xiaomi S40C")]);
    expect(r.product?.titulo).toBe("Xiaomi S40C");
    expect(r.product && r.match.confianza).toBe("alta");
  });
});
