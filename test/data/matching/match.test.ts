import { describe, expect, it } from "vitest";
import {
  extractModelCodes,
  extractVariants,
  hasAccessoryWords,
  hasBundleWords,
  hasConditionWords,
  normalizeBrand,
  writtenModelCode,
} from "../../../src/data/matching/normalize.js";
import { matchListings, pickCatalogProduct } from "../../../src/data/matching/match.js";
import type { Comparable } from "../../../src/data/types.js";
import type { MlProduct } from "../../../src/data/ml/catalog.js";

type Spec = string | { title: string; gtin?: string | null; brand?: string | null; model?: string | null; price?: number | null };

function spec(s: Spec) {
  return typeof s === "string" ? { title: s } : s;
}

// ML side: brand taken from the catalog `brand` attribute (first title word in these tests).
function ml(s: Spec, price: number | null = null): Comparable {
  const x = spec(s);
  return {
    store: "mercadolibre",
    title: x.title,
    brand: x.brand !== undefined ? x.brand : x.title.split(" ")[0]!,
    model: x.model ?? null,
    gtin: x.gtin ?? null,
    price_ars: x.price ?? price,
  };
}

// Store side: title-only listing, brand unknown.
function other(s: Spec, price: number | null = null): Comparable {
  const x = spec(s);
  return {
    store: "fravega",
    title: x.title,
    brand: x.brand ?? null,
    model: x.model ?? null,
    gtin: x.gtin ?? null,
    price_ars: x.price ?? price,
  };
}

function p(title: string): MlProduct {
  return { ...ml(title), id: `MLA-${title}`, url: "https://example.test/p", image_url: null };
}

// PLACEHOLDER pair: docs/verification/data.md V7 is still PENDING OWNER, so these titles
// are NOT the owner's doubtful pair. Replace with the real titles once V7 is written.
const V7_ML_TITLE = "Xiaomi Robot Vacuum E5";
const V7_OTHER_TITLE = "Xiaomi Robot Vacuum E5 Pro Plus";

describe("matchListings table", () => {
  it.each([
    [{ title: "Xiaomi Robot Vacuum S40C", gtin: "6941812700000" }, { title: "Aspiradora Xiaomi S40C", gtin: "6941812700000" }, "high", "gtin"],
    [{ title: "Xiaomi Robot Vacuum S40C", gtin: "6941812700000" }, { title: "Xiaomi S40C", gtin: "6941812700017" }, null, null],
    ["Xiaomi Robot Vacuum S40C", "Aspiradora Robot Xiaomi S40C Negra", "high", "brand_code_variant"],
    ["Smartlife RVCL050, mapeo láser", "Robot Aspiradora Smartlife RVC-L050", "high", "brand_code_variant"],
    ["Xiaomi Robot Vacuum H50 Pro", "Xiaomi Robot Vacuum H50", "doubtful", "partial"],
    ["Xiaomi Robot Vacuum H50 Pro", "Xiaomi H50Pro", "high", "brand_code_variant"],
    ["Roborock S8+", "Roborock S8 Plus", "high", "brand_code_variant"],
    ["Xiaomi S40", "Xiaomi S40C", "doubtful", "partial"],
    ["Xiaomi S40C", "Samsung S40C", null, null],
    ["Electrolux ERB80 4000Pa", "Electrolux ERB80", "high", "brand_code_variant"],
    [V7_ML_TITLE, V7_OTHER_TITLE, "doubtful", expect.any(String)],
  ])("%j vs %j", (a, b, confidence, rule) => {
    const m = matchListings(ml(a as Spec), other(b as Spec));
    if (confidence === null) {
      expect(m).toBeNull();
    } else {
      expect(m).toMatchObject({ confidence, rule });
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

describe("writtenModelCode", () => {
  it("returns the code with the store's punctuation", () => {
    expect(writtenModelCode("Aspiradora Robot Smartlife Sensor Láser SL-RVCL050", "SLRVCL050")).toBe("SL-RVCL050");
    expect(writtenModelCode("Robot (SL-RVCL050), negro", "SLRVCL050")).toBe("SL-RVCL050");
  });
  it("returns the plain token when there is no punctuation and null when no token matches", () => {
    expect(writtenModelCode("Robot Philco PHRA26N", "PHRA26N")).toBe("PHRA26N");
    expect(writtenModelCode("Robot Philco", "PHRA26N")).toBeNull();
  });
});

describe("guards and brand source", () => {
  it("reads the brand from the title when the store brand is null", () => {
    expect(matchListings(ml("Xiaomi S40C", 329999), other("Aspiradora Robot Xiaomi S40C Negra", 399999))).toMatchObject({ confidence: "high" });
  });
  it("lowers packs", () => {
    expect(matchListings(ml("Xiaomi S40C", 329999), other("Pack x2 Xiaomi S40C", 699998))?.confidence).toBe("doubtful");
  });
  it("lowers accessories", () => {
    expect(matchListings(ml("Xiaomi S40C", 329999), other("Filtro HEPA para Xiaomi S40C", 15999))?.reason).toBe("accessory");
  });
  it("lowers a leading 'base' (Review Focus 1)", () => {
    expect(matchListings(ml("Xiaomi S40C", 329999), other("Base de autovaciado Xiaomi S40C", 249999))?.confidence).toBe("doubtful");
  });
  it("lowers a spare-parts kit priced within range", () => {
    const m = matchListings(ml("Xiaomi S40C", 329999), other("Kit de repuestos para Xiaomi S40C", 300000));
    expect(m).toMatchObject({ confidence: "doubtful", reason: "accessory" });
  });
  it("lowers an implausible price ratio", () => {
    expect(matchListings(ml("Xiaomi S40C", 329999), other("Xiaomi S40C", 120000))?.reason).toBe("price_ratio");
  });
  it("applies the guards to a GTIN match too", () => {
    const m = matchListings(
      ml({ title: "Xiaomi S40C", gtin: "6941812700000" }, 329999),
      other({ title: "Xiaomi S40C", gtin: "6941812700000" }, 120000),
    );
    expect(m).toMatchObject({ confidence: "doubtful", rule: "gtin", reason: "price_ratio" });
  });
  it("returns null when no brand can be established", () => {
    expect(matchListings(ml({ title: "S40C", brand: null }), other("Xiaomi S40C"))).toBeNull();
  });
  it("prefers the ML model attribute over the title", () => {
    const m = matchListings(ml({ title: "Xiaomi Robot Aspirador Premium", model: "S40C" }), other("Xiaomi S40C"));
    expect(m).toMatchObject({ confidence: "high" });
  });
  it("is doubtful with two model codes on one side", () => {
    expect(matchListings(ml("Xiaomi S40C"), other("Xiaomi S40C X10"))?.confidence).toBe("doubtful");
  });
});

describe("pickCatalogProduct", () => {
  it("rejects several high candidates", () => {
    expect(pickCatalogProduct(other("Xiaomi S40C"), [p("Xiaomi S40C"), p("Xiaomi S40C Negro")])).toEqual({ product: null, reason: "multiple_high" });
  });
  it("rejects when nothing is high", () => {
    expect(pickCatalogProduct(other("Xiaomi S40C"), [p("Xiaomi S40")])).toEqual({ product: null, reason: "no_high" });
  });
  it("returns the single high product", () => {
    const r = pickCatalogProduct(other("Xiaomi S40C"), [p("Xiaomi S40"), p("Xiaomi S40C")]);
    expect(r.product?.title).toBe("Xiaomi S40C");
    expect(r.product && r.match.confidence).toBe("high");
  });
});

const X = "Xiaomi";
const mlX = (title: string, price: number | null = null) => ml({ title, brand: X }, price);
const otherX = (title: string, price: number | null = null) => other({ title, brand: X }, price);

describe("fix round 1: accessories (findings 1 and 2)", () => {
  it("lowers an accessory priced near the robot (station for the model)", () => {
    const m = matchListings(ml("Xiaomi S40C", 329999), other("Estación de autovaciado para Xiaomi S40C", 249999));
    expect(m).toMatchObject({ confidence: "doubtful", reason: "accessory" });
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
    expect(matchListings(mlX("Xiaomi S40C", 329999), otherX(t, 300000))?.confidence).toBe("doubtful");
  });
  it("lowers when 'para' or 'compatible con' comes before the brand", () => {
    expect(matchListings(mlX("Xiaomi S40C", 329999), otherX("Soporte para Xiaomi S40C", 300000))?.confidence).toBe("doubtful");
    expect(matchListings(mlX("Xiaomi S40C", 329999), otherX("Pieza compatible con Xiaomi S40C", 300000))?.confidence).toBe("doubtful");
  });
  it("lowers when BOTH titles have accessory words", () => {
    const m = matchListings(mlX("Filtro HEPA Xiaomi S40C", 15999), otherX("Kit cepillos Xiaomi S40C", 15999));
    expect(m).toMatchObject({ confidence: "doubtful", reason: "accessory" });
  });
  it("control: a complete robot with extra descriptive title words stays high", () => {
    const m = matchListings(mlX("Aspiradora Robot Xiaomi Robot Vacuum S40C Negra", 329999), otherX("Xiaomi Robot Vacuum S40C", 329999));
    expect(m).toMatchObject({ confidence: "high", rule: "brand_code_variant" });
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
    const m = matchListings(ml({ title: "Ecovacs Deebot T30", brand: "Ecovacs" }), other("Ecovacs Deebot T30 Omni"));
    expect(m?.confidence).toBe("doubtful");
  });
  it("structural guard: an unlisted word right after the model code lowers", () => {
    const m = matchListings(ml({ title: "Ecovacs Deebot T30", brand: "Ecovacs" }), other("Ecovacs Deebot T30 Hyper"));
    expect(m).toMatchObject({ confidence: "doubtful", rule: "brand_code_variant", reason: "model_suffix" });
  });
  it("structural guard: the same suffix word on both sides stays high", () => {
    const m = matchListings(ml({ title: "Ecovacs Deebot T30 Hyper", brand: "Ecovacs" }), other("Ecovacs Deebot T30 Hyper"));
    expect(m).toMatchObject({ confidence: "high" });
  });
  it("control: colour and punctuated descriptors after the code stay high", () => {
    expect(matchListings(mlX("Xiaomi S40C Negro"), otherX("Xiaomi S40C"))?.confidence).toBe("high");
    expect(matchListings(mlX("Xiaomi S40C, mapeo láser"), otherX("Xiaomi S40C"))?.confidence).toBe("high");
  });
});

describe("fix round 1: condition (finding 4)", () => {
  it("lowers a refurbished unit", () => {
    const m = matchListings(mlX("Xiaomi Robot Vacuum S40C", 329999), otherX("Xiaomi Robot Vacuum S40C Reacondicionado", 300000));
    expect(m).toMatchObject({ confidence: "doubtful", reason: "condition" });
  });
  it("lowers when the ML side is the used one", () => {
    expect(matchListings(mlX("Xiaomi S40C Usado", 329999), otherX("Xiaomi S40C", 329999))).toMatchObject({ confidence: "doubtful", reason: "condition" });
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
  it("equal GTIN with conflicting brands is doubtful", () => {
    const m = matchListings(ml({ title: "Xiaomi S40C", brand: "Xiaomi", gtin: g }, 329999), other({ title: "Samsung S40C", brand: "Samsung", gtin: g }, 329999));
    expect(m).toMatchObject({ confidence: "doubtful", rule: "gtin", reason: "brand_conflict" });
  });
  it("equal GTIN with codes that share nothing is doubtful", () => {
    const m = matchListings(ml({ title: "Xiaomi S40C", brand: "Xiaomi", gtin: g }, 329999), other({ title: "Xiaomi X10", gtin: g }, 329999));
    expect(m).toMatchObject({ confidence: "doubtful", rule: "gtin", reason: "code_conflict" });
  });
  it("control: a side without brand or code does not block the GTIN rule", () => {
    expect(matchListings(ml({ title: "Xiaomi S40C", brand: "Xiaomi", gtin: g }, 329999), other({ title: "Aspiradora robot", gtin: g }, 329999))).toMatchObject({ confidence: "high", rule: "gtin" });
    expect(matchListings(ml({ title: "Xiaomi S40C", brand: "Xiaomi", gtin: g }, 329999), other({ title: "Aspiradora Xiaomi S40C", gtin: g }, 329999))).toMatchObject({ confidence: "high", rule: "gtin" });
  });
});

describe("fix round 1: bundle vs bare unit (finding 6)", () => {
  it("lowers a bundle against the bare unit", () => {
    const m = matchListings(ml({ title: "Electrolux ERB80 con base de autolimpieza", brand: "Electrolux" }, 329999), other("Electrolux ERB80", 329999));
    expect(m).toMatchObject({ confidence: "doubtful", reason: "bundle" });
    const r = matchListings(ml({ title: "Electrolux ERB80", brand: "Electrolux" }, 329999), other("Electrolux ERB80 + dock", 329999));
    expect(r).toMatchObject({ confidence: "doubtful", reason: "bundle" });
  });
  it("control: bundle on both sides is unaffected", () => {
    const m = matchListings(
      ml({ title: "Electrolux ERB80 con base de autolimpieza", brand: "Electrolux" }, 329999),
      other("Electrolux ERB80 con base de autolimpieza", 329999),
    );
    expect(m).toMatchObject({ confidence: "high", rule: "brand_code_variant" });
  });
  it("detects bundle words only after con, y or +", () => {
    expect(hasBundleWords("Electrolux ERB80 con base")).toBe(true);
    expect(hasBundleWords("Electrolux ERB80 y estación")).toBe(true);
    expect(hasBundleWords("Electrolux ERB80 + dock")).toBe(true);
    expect(hasBundleWords("Base Electrolux ERB80")).toBe(false);
    expect(hasBundleWords("Electrolux ERB80")).toBe(false);
  });
});

describe("fix round 2: variant, suffix and brand guards on GTIN matches", () => {
  const g = "6941812700000";
  it("lowers a shared GTIN when one title carries a variant word (T30 vs T30 Omni)", () => {
    const m = matchListings(
      ml({ title: "Ecovacs Deebot T30", brand: "Ecovacs", gtin: g }, 329999),
      other({ title: "Ecovacs Deebot T30 Omni", gtin: g }, 329999),
    );
    expect(m).toMatchObject({ confidence: "doubtful", rule: "gtin" });
  });
  it("lowers a shared GTIN when the brand appears only in one title (Xiaomi vs Roborock)", () => {
    const m = matchListings(
      ml({ title: "Xiaomi S40C", brand: "Xiaomi", gtin: g }, 329999),
      other({ title: "Roborock S40C", brand: null, gtin: g }, 329999),
    );
    expect(m).toMatchObject({ confidence: "doubtful", rule: "gtin", reason: "brand_conflict" });
  });
  it("control: same GTIN with the brand repeated in the other title stays high", () => {
    const m = matchListings(
      ml({ title: "Xiaomi Robot Vacuum S40C", brand: "Xiaomi", gtin: g }, 329999),
      other({ title: "Aspiradora Robot Xiaomi Robot Vacuum S40C Negra", gtin: g }, 329999),
    );
    expect(m).toMatchObject({ confidence: "high", rule: "gtin" });
  });
});

// Real ML catalog results for "XIAOMI S40C" on 2026-11-11 (scripts/debug-match.ts): ML's MODEL
// attribute holds the manufacturer code (E101) while the title holds the commercial one (S40C).
describe("MODEL attribute and title codes are evaluated separately", () => {
  const product = (id: string, title: string, brand: string, model: string): MlProduct => ({
    ...ml({ title, brand, model }),
    id,
    url: "https://example.test/p",
    image_url: null,
  });
  const fravega = other({ title: "Aspiradora Robot Trapeadora Xiaomi S40C Láser", brand: "Xiaomi", gtin: "6941812701867" }, 449999);
  const robot = product("MLA67760111", "Xiaomi Robot Vacuum S40c Blanco", "Xiaomi", "E101");
  const realResults = [
    product("MLA72756157", "Cepillo principal para el robot aspirador Xiaomi S40c E101", "iA Casa", "S40c"),
    product("MLA80844351", "Funda de cepillo principal para robot aspirador Xiaomi S40c,", "WLN", "JQHD-DXMSDJ-1"),
    product("MLA70390266", "Funda de cepillo principal para robot aspirador Xiaomi S40c, S40 y H40, color blanco", "DecolTec", "S40C S40 H40"),
    robot,
    product("MLA80135764", "2 filtro de aire para chupar robo Xiaomi vacío S40c", "Xiaomi", "s40c"),
    product("MLA68972850", "Kit de 2 cepillos laterales para robot Xiaomi S40c S30 S20+ X20 Max, color negro", "Th2i", "S40c"),
  ];

  it("matches high when the title has the single store code even if MODEL holds another code", () => {
    expect(matchListings(robot, fravega)).toMatchObject({ confidence: "high", rule: "brand_code_variant" });
  });

  it("picks the robot from the real result list and nothing else", () => {
    const r = pickCatalogProduct(fravega, realResults);
    expect(r.product?.id).toBe("MLA67760111");
  });

  it("keeps a same-brand accessory with the code in MODEL below high", () => {
    expect(matchListings(realResults[4]!, fravega)?.confidence).not.toBe("high");
  });

  it("stays doubtful when neither source has exactly one code equal to the store's", () => {
    const multi = product("MLA1", "Xiaomi Robot S40C H40", "Xiaomi", "E101 E102");
    expect(matchListings(multi, fravega)?.confidence).toBe("doubtful");
  });

  it("does not match when MODEL and title both name a different code", () => {
    const h40 = product("MLA2", "Xiaomi Robot Vacuum H40", "Xiaomi", "D109");
    expect(matchListings(h40, fravega)).toBeNull();
  });
});
