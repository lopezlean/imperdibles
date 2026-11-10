import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyPrices,
  buildCandidateList,
  passesThreshold,
  type MatchedGroup,
} from "../../src/data/filter.js";
import { parseCandidateList, type Candidate, type StoreOffer } from "../../src/contract/candidate-list.js";

type Other = Exclude<StoreOffer, { tienda: "ml" }>;
type Ml = Extract<StoreOffer, { tienda: "ml" }>;

const ml = (precio: number, id = "1"): Ml => ({
  tienda: "ml",
  titulo_listado: "t",
  url: `https://www.mercadolibre.com.ar/p/MLA${id}`,
  precio_ars: precio,
  observado_en: "2026-11-10T06:12:00-03:00",
  ref_externa: `MLA${id}`,
  vendedor: "Tienda oficial",
  ml_product_id: `MLA${id}`,
  ml_seller_id: "10",
});
const other = (precio: number, tienda = "fravega"): Other => ({
  tienda,
  titulo_listado: "t",
  url: `https://www.${tienda}.com/p/x`,
  precio_ars: precio,
  observado_en: "2026-11-10T06:14:00-03:00",
  ref_externa: "X",
  vendedor: null,
});
const group = (
  modelo_id: string,
  mlPrice: number,
  rivals: { offer: Other; regla?: "gtin" | "marca_codigo_variante" }[],
): MatchedGroup => ({
  modelo_id,
  marca: "Marca",
  titulo: `Titulo ${modelo_id}`,
  imagen_url: null,
  ml: ml(mlPrice),
  otras: rivals.map((r) => ({ offer: r.offer, regla: r.regla ?? "marca_codigo_variante" })),
});
const base = { corrida_id: "run1", fecha: "2026-11-10", categoria: "cat", umbral_pct: 15 };

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
    expect(list.candidatos).toHaveLength(1);
    const c = list.candidatos[0]!;
    expect(c.candidato_id).toBe("run1:A");
    expect(c.diferencia_ars).toBe(15000);
    expect(c.otras.map((o) => o.precio_ars)).toEqual([100000, 120000]);
  });

  it("excludes a model that only beats a pricier rival", () => {
    const list = buildCandidateList({
      ...base,
      groups: [group("A", 90000, [{ offer: other(120000, "cetrogar") }, { offer: other(100000) }])],
    });
    expect(list.candidatos).toEqual([]);
    expect(list.modelos_comparados).toBe(1);
  });

  it("takes the rule from the cheapest rival and ties by tienda", () => {
    const list = buildCandidateList({
      ...base,
      groups: [
        group("A", 50000, [
          { offer: other(100000, "musimundo"), regla: "gtin" },
          { offer: other(100000, "cetrogar"), regla: "marca_codigo_variante" },
        ]),
      ],
    });
    const c = list.candidatos[0]!;
    expect(c.otras.map((o) => o.tienda)).toEqual(["cetrogar", "musimundo"]);
    expect(c.regla_emparejado).toBe("marca_codigo_variante");
  });

  it("is deterministic and sorted by diferencia_pct desc, ties by modelo_id", () => {
    const groups = [
      group("B", 80000, [{ offer: other(100000) }]),
      group("C", 70000, [{ offer: other(100000) }]),
      group("A", 80000, [{ offer: other(100000) }]),
    ];
    const first = buildCandidateList({ ...base, groups });
    expect(buildCandidateList({ ...base, groups })).toEqual(first);
    expect(first.candidatos.map((c) => c.modelo_id)).toEqual(["C", "A", "B"]);
  });

  it("counts only groups with rivals as compared", () => {
    const list = buildCandidateList({
      ...base,
      groups: [group("A", 90000, [{ offer: other(100000) }]), group("B", 90000, [])],
    });
    expect(list.candidatos).toEqual([]);
    expect(list.modelos_comparados).toBe(1);
  });

  it("rebuilds the candidatos of the valid fixture", () => {
    const fixture = parseCandidateList(
      JSON.parse(readFileSync("fixtures/lista-candidatos/valid-2026-11-10.json", "utf8")),
    );
    const groups: MatchedGroup[] = fixture.candidatos.map((c) => ({
      modelo_id: c.modelo_id,
      marca: c.marca,
      titulo: c.titulo,
      imagen_url: c.imagen_url,
      ml: c.ml,
      otras: [...c.otras].reverse().map((offer) => ({ offer, regla: c.regla_emparejado })),
    }));
    const list = buildCandidateList({
      corrida_id: fixture.corrida_id,
      fecha: fixture.fecha,
      categoria: fixture.categoria,
      umbral_pct: fixture.umbral_pct,
      groups: [...groups].reverse(),
    });
    expect(list.candidatos).toHaveLength(fixture.candidatos.length);
    list.candidatos.forEach((c, i) => {
      const f = fixture.candidatos[i]!;
      expect(c.candidato_id).toBe(f.candidato_id);
      expect(c.diferencia_ars).toBe(f.diferencia_ars);
      expect(Math.abs(c.diferencia_pct - f.diferencia_pct)).toBeLessThan(1e-9);
      expect(c.regla_emparejado).toBe(f.regla_emparejado);
    });
  });
});

describe("applyPrices", () => {
  it("sorts rivals and recomputes differences, keeping other fields", () => {
    const candidate: Candidate = {
      candidato_id: "run1:A",
      modelo_id: "A",
      marca: "M",
      titulo: "T",
      imagen_url: null,
      ml: ml(90000),
      otras: [other(300000)],
      diferencia_ars: 210000,
      diferencia_pct: 70,
      confianza: "alta",
      regla_emparejado: "gtin",
    };
    const next = applyPrices(candidate, ml(85000), [other(120000, "cetrogar"), other(100000)]);
    expect(next.otras.map((o) => o.precio_ars)).toEqual([100000, 120000]);
    expect(next.diferencia_ars).toBe(15000);
    expect(Math.abs(next.diferencia_pct - 15)).toBeLessThan(1e-9);
    expect(next.ml.precio_ars).toBe(85000);
    expect({ ...next, ml: 0, otras: 0, diferencia_ars: 0, diferencia_pct: 0 }).toEqual({
      ...candidate,
      ml: 0,
      otras: 0,
      diferencia_ars: 0,
      diferencia_pct: 0,
    });
  });
});
