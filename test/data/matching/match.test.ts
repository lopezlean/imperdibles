import { describe, expect, it } from "vitest";
import {
  extractModelCodes,
  extractVariants,
  hasAccessoryWords,
  hasBundleWords,
  hasConditionWords,
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

const X = "Xiaomi";
const mlX = (titulo: string, precio: number | null = null) => ml({ titulo, marca: X }, precio);
const otherX = (titulo: string, precio: number | null = null) => other({ titulo, marca: X }, precio);

describe("fix round 1: accessories (findings 1 and 2)", () => {
  it("lowers an accessory priced near the robot (station for the model)", () => {
    const m = matchListings(ml("Xiaomi S40C", 329999), other("Estación de autovaciado para Xiaomi S40C", 249999));
    expect(m).toMatchObject({ confianza: "dudosa", motivo: "accesorio" });
  });
  it.each([
    "Dock de carga Xiaomi S40C",
    "Accesorios Xiaomi S40C",
    "Mopa Xiaomi S40C",
    "Paño Xiaomi S40C",
    "Rodillo Xiaomi S40C",
    "Cargador Xiaomi S40C",
    "Cargador compatible Xiaomi S40C",
    "Repuesto Xiaomi S40C",
  ])("recognises the accessory title %s", (t) => {
    expect(hasAccessoryWords(t)).toBe(true);
    expect(matchListings(mlX("Xiaomi S40C", 329999), otherX(t, 300000))?.confianza).toBe("dudosa");
  });
  it("lowers when 'para' or 'compatible con' comes before the brand", () => {
    expect(matchListings(mlX("Xiaomi S40C", 329999), otherX("Soporte para Xiaomi S40C", 300000))?.confianza).toBe("dudosa");
    expect(matchListings(mlX("Xiaomi S40C", 329999), otherX("Pieza compatible con Xiaomi S40C", 300000))?.confianza).toBe("dudosa");
  });
  it("lowers when BOTH titles have accessory words", () => {
    const m = matchListings(mlX("Filtro HEPA Xiaomi S40C", 15999), otherX("Kit cepillos Xiaomi S40C", 15999));
    expect(m).toMatchObject({ confianza: "dudosa", motivo: "accesorio" });
  });
  it("control: a complete robot with extra descriptive title words stays alta", () => {
    const m = matchListings(mlX("Aspiradora Robot Xiaomi Robot Vacuum S40C Negra", 329999), otherX("Xiaomi Robot Vacuum S40C", 329999));
    expect(m).toMatchObject({ confianza: "alta", regla: "marca_codigo_variante" });
  });
  it("control: a robot sold 'con estación' is not an accessory", () => {
    expect(hasAccessoryWords("Xiaomi S40C con estación de autovaciado")).toBe(false);
  });
});

describe("fix round 1: variants (finding 3)", () => {
  it.each(["OMNI", "NEO", "TURBO", "EVO", "AI"])("%s is a variant word", (v) => {
    expect(extractVariants(`Ecovacs Deebot T30 ${v}`)).toEqual([v]);
  });
  it("lowers T30 vs T30 Omni", () => {
    const m = matchListings(ml({ titulo: "Ecovacs Deebot T30", marca: "Ecovacs" }), other("Ecovacs Deebot T30 Omni"));
    expect(m?.confianza).toBe("dudosa");
  });
  it("structural guard: an unlisted word right after the model code lowers", () => {
    const m = matchListings(ml({ titulo: "Ecovacs Deebot T30", marca: "Ecovacs" }), other("Ecovacs Deebot T30 Hyper"));
    expect(m).toMatchObject({ confianza: "dudosa", regla: "marca_codigo_variante", motivo: "sufijo_modelo" });
  });
  it("structural guard: the same suffix word on both sides stays alta", () => {
    const m = matchListings(ml({ titulo: "Ecovacs Deebot T30 Hyper", marca: "Ecovacs" }), other("Ecovacs Deebot T30 Hyper"));
    expect(m).toMatchObject({ confianza: "alta" });
  });
  it("control: colour and punctuated descriptors after the code stay alta", () => {
    expect(matchListings(mlX("Xiaomi S40C Negro"), otherX("Xiaomi S40C"))?.confianza).toBe("alta");
    expect(matchListings(mlX("Xiaomi S40C, mapeo láser"), otherX("Xiaomi S40C"))?.confianza).toBe("alta");
  });
});

describe("fix round 1: condition (finding 4)", () => {
  it("lowers a refurbished unit", () => {
    const m = matchListings(mlX("Xiaomi Robot Vacuum S40C", 329999), otherX("Xiaomi Robot Vacuum S40C Reacondicionado", 300000));
    expect(m).toMatchObject({ confianza: "dudosa", motivo: "condicion" });
  });
  it("lowers when the ML side is the used one", () => {
    expect(matchListings(mlX("Xiaomi S40C Usado", 329999), otherX("Xiaomi S40C", 329999))).toMatchObject({ confianza: "dudosa", motivo: "condicion" });
  });
  it.each(["Xiaomi S40C Reacondicionada", "Xiaomi S40C Open Box", "Xiaomi S40C Exhibición", "Xiaomi S40C Outlet", "Xiaomi S40C usado"])(
    "detects condition words in %s",
    (t) => {
      expect(hasConditionWords(t)).toBe(true);
    },
  );
  it("does not flag a new unit", () => {
    expect(hasConditionWords("Xiaomi S40C nuevo, caja abierta por fuera no")).toBe(false);
    expect(hasConditionWords("Xiaomi S40C Open")).toBe(false);
  });
});

describe("fix round 1: GTIN cross-check (finding 5)", () => {
  const g = "6941812700000";
  it("equal GTIN with conflicting brands is dudosa", () => {
    const m = matchListings(ml({ titulo: "Xiaomi S40C", marca: "Xiaomi", gtin: g }, 329999), other({ titulo: "Samsung S40C", marca: "Samsung", gtin: g }, 329999));
    expect(m).toMatchObject({ confianza: "dudosa", regla: "gtin", motivo: "marca_conflicto" });
  });
  it("equal GTIN with codes that share nothing is dudosa", () => {
    const m = matchListings(ml({ titulo: "Xiaomi S40C", marca: "Xiaomi", gtin: g }, 329999), other({ titulo: "Xiaomi X10", gtin: g }, 329999));
    expect(m).toMatchObject({ confianza: "dudosa", regla: "gtin", motivo: "codigo_conflicto" });
  });
  it("control: a side without brand or code does not block the GTIN rule", () => {
    expect(matchListings(ml({ titulo: "Xiaomi S40C", marca: "Xiaomi", gtin: g }, 329999), other({ titulo: "Aspiradora robot", gtin: g }, 329999))).toMatchObject({ confianza: "alta", regla: "gtin" });
    expect(matchListings(ml({ titulo: "Xiaomi S40C", marca: "Xiaomi", gtin: g }, 329999), other({ titulo: "Aspiradora Xiaomi S40C", gtin: g }, 329999))).toMatchObject({ confianza: "alta", regla: "gtin" });
  });
});

describe("fix round 1: bundle vs bare unit (finding 6)", () => {
  it("lowers a bundle against the bare unit", () => {
    const m = matchListings(ml({ titulo: "Electrolux ERB80 con base de autolimpieza", marca: "Electrolux" }, 329999), other("Electrolux ERB80", 329999));
    expect(m).toMatchObject({ confianza: "dudosa", motivo: "bundle" });
    const r = matchListings(ml({ titulo: "Electrolux ERB80", marca: "Electrolux" }, 329999), other("Electrolux ERB80 + dock", 329999));
    expect(r).toMatchObject({ confianza: "dudosa", motivo: "bundle" });
  });
  it("control: bundle on both sides is unaffected", () => {
    const m = matchListings(
      ml({ titulo: "Electrolux ERB80 con base de autolimpieza", marca: "Electrolux" }, 329999),
      other("Electrolux ERB80 con base de autolimpieza", 329999),
    );
    expect(m).toMatchObject({ confianza: "alta", regla: "marca_codigo_variante" });
  });
  it("detects bundle words only after con, y or +", () => {
    expect(hasBundleWords("Electrolux ERB80 con base")).toBe(true);
    expect(hasBundleWords("Electrolux ERB80 y estación")).toBe(true);
    expect(hasBundleWords("Electrolux ERB80 + dock")).toBe(true);
    expect(hasBundleWords("Base Electrolux ERB80")).toBe(false);
    expect(hasBundleWords("Electrolux ERB80")).toBe(false);
  });
});
