import { describe, expect, it } from "vitest";
import { createSqliteClient } from "../support/sqlite-client.js";
import {
  findRunOfDay,
  finishRun,
  priceHistory,
  rejectedRefs,
  saveCandidates,
  saveMatches,
  saveObservations,
  startRun,
  upsertModels,
  type ModelRow,
} from "../../src/data/repo.js";
import type { Listing } from "../../src/data/types.js";
import type { CandidateList } from "../../src/contract/candidate-list.js";

const NOW = "2026-11-10T06:00:00-03:00";

const model = (id: string): ModelRow => ({
  id,
  categoria: "aspiradoras-robot",
  marca: "Roborock",
  codigo_modelo: id.toUpperCase(),
  gtin: null,
  ml_product_id: "MLA1",
  titulo: "Roborock",
  imagen_url: null,
});

const listing = (precio: number, observado_en: string, ref = "R1", tienda = "fravega"): Listing => ({
  tienda,
  titulo: "Roborock Q7",
  marca: "Roborock",
  modelo: "Q7",
  gtin: null,
  ref_externa: ref,
  url: `https://x.test/${ref}`,
  precio_ars: precio,
  vendedor: null,
  condicion: "nuevo",
  observado_en,
});

async function setup() {
  const db = createSqliteClient();
  await startRun(db, { id: "run1", fecha: "2026-11-10", categoria: "aspiradoras-robot", iniciada_en: NOW });
  return db;
}

describe("repo", () => {
  it("stores every observation, repeated ones included", async () => {
    const db = await setup();
    await saveObservations(db, "run1", [listing(100, "2026-11-10T06:00:00-03:00")]);
    await saveObservations(db, "run1", [listing(100, "2026-11-10T06:30:00-03:00")]);
    expect((await db.all("SELECT * FROM observaciones_precio")).length).toBe(2);
    const pubs = await db.all<{ primera_vez: string; ultima_vez: string }>("SELECT * FROM publicaciones_tienda");
    expect(pubs.length).toBe(1);
    expect(pubs[0]).toMatchObject({ primera_vez: "2026-11-10T06:00:00-03:00", ultima_vez: "2026-11-10T06:30:00-03:00" });
  });

  it("returns history inside the date range only, ordered by observado_en", async () => {
    const db = await setup();
    await saveObservations(db, "run1", [listing(300, "2026-11-12T06:00:00-03:00")]);
    await saveObservations(db, "run1", [listing(100, "2026-11-08T06:00:00-03:00")]);
    await saveObservations(db, "run1", [listing(200, "2026-11-10T23:30:00-03:00")]);
    await saveObservations(db, "run1", [listing(400, "2026-11-20T06:00:00-03:00")]);
    const id = (await db.all<{ id: number }>("SELECT id FROM publicaciones_tienda"))[0]!.id;
    const rows = await priceHistory(db, id, "2026-11-08", "2026-11-12");
    expect(rows.map((r) => r.precio_ars)).toEqual([100, 200, 300]);
    expect(rows[0]).toEqual({ precio_ars: 100, observado_en: "2026-11-08T06:00:00-03:00", corrida_id: "run1" });
  });

  it("saveCandidates writes all rows or none", async () => {
    const db = await setup();
    await upsertModels(db, [model("m1")], NOW);
    const offer = {
      tienda: "fravega",
      titulo_listado: "t",
      url: "https://x.test/1",
      precio_ars: 200,
      observado_en: NOW,
      ref_externa: "R1",
      vendedor: null,
    };
    const cand = (id: string, modelo_id: string) => ({
      candidato_id: id,
      modelo_id,
      marca: "Roborock",
      titulo: "t",
      imagen_url: null,
      ml: { ...offer, tienda: "ml" as const, ml_product_id: "MLA1", ml_seller_id: "1", precio_ars: 100 },
      otras: [offer],
      diferencia_ars: 100,
      diferencia_pct: 50,
      confianza: "alta" as const,
      regla_emparejado: "gtin" as const,
    });
    const list = (cs: ReturnType<typeof cand>[]): CandidateList => ({
      version: 1,
      corrida_id: "run1",
      fecha: "2026-11-10",
      categoria: "aspiradoras-robot",
      umbral_pct: 15,
      modelos_comparados: 2,
      candidatos: cs,
    });
    await expect(saveCandidates(db, list([cand("c1", "m1"), cand("c1", "m1")]))).rejects.toThrow();
    await expect(saveCandidates(db, list([cand("c1", "m1"), cand("c2", "nope")]))).rejects.toThrow();
    expect((await db.all("SELECT * FROM candidatos")).length).toBe(0);

    await saveCandidates(db, list([cand("c1", "m1"), cand("c2", "m1")]));
    const rows = await db.all<{ id: string; estado: string; payload: string }>("SELECT * FROM candidatos ORDER BY id");
    expect(rows.map((r) => [r.id, r.estado])).toEqual([["c1", "pendiente"], ["c2", "pendiente"]]);
    expect(JSON.parse(rows[0]!.payload).candidato_id).toBe("c1");
  });

  it("saveMatches never overwrites a rechazado pair", async () => {
    const db = await setup();
    await upsertModels(db, [model("m1")], NOW);
    await saveObservations(db, "run1", [listing(100, NOW)]);
    const row = {
      modelo_id: "m1",
      tienda: "fravega",
      ref_externa: "R1",
      match: { confianza: "alta" as const, regla: "gtin" as const, evidencia: { gtin: "1" } },
    };
    await saveMatches(db, [row], NOW);
    expect(await rejectedRefs(db, "m1")).toEqual(new Set());
    await db.run("UPDATE emparejados SET estado = 'rechazado'");
    await saveMatches(db, [{ ...row, match: { confianza: "dudosa", regla: "parcial", evidencia: {} } }], NOW);
    const rows = await db.all<{ estado: string; confianza: string; regla: string }>("SELECT * FROM emparejados");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ estado: "rechazado", confianza: "alta", regla: "gtin" });
    expect(await rejectedRefs(db, "m1")).toEqual(new Set(["fravega:R1"]));
  });

  it("saveMatches refreshes an auto pair", async () => {
    const db = await setup();
    await upsertModels(db, [model("m1")], NOW);
    await saveObservations(db, "run1", [listing(100, NOW)]);
    const base = { modelo_id: "m1", tienda: "fravega", ref_externa: "R1" };
    await saveMatches(db, [{ ...base, match: { confianza: "dudosa", regla: "parcial", evidencia: {} } }], NOW);
    await saveMatches(db, [{ ...base, match: { confianza: "alta", regla: "gtin", evidencia: { a: 1 } } }], NOW);
    const rows = await db.all<{ confianza: string; estado: string; evidencia: string }>("SELECT * FROM emparejados");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ confianza: "alta", estado: "auto", evidencia: '{"a":1}' });
  });

  it("upsertModels sets clave equal to id", async () => {
    const db = await setup();
    await upsertModels(db, [model("m1"), model("m2")], NOW);
    await upsertModels(db, [{ ...model("m1"), titulo: "Nuevo" }], "2026-11-11T06:00:00-03:00");
    const rows = await db.all<{ id: string; clave: string; titulo: string; creado_en: string }>("SELECT * FROM modelos ORDER BY id");
    expect(rows.map((r) => [r.id, r.clave, r.titulo])).toEqual([["m1", "m1", "Nuevo"], ["m2", "m2", "Roborock"]]);
    expect(rows[0]!.creado_en).toBe(NOW);
  });

  it("findRunOfDay ignores runs of other ART dates and runs still fallida", async () => {
    const db = createSqliteClient();
    const mk = (id: string, fecha: string, t: string) =>
      startRun(db, { id, fecha, categoria: "c", iniciada_en: t });
    await mk("other", "2026-11-09", "2026-11-09T06:00:00-03:00");
    await finishRun(db, "other", { estado: "ok", modelos_comparados: 1, consultas_usadas: 1, error: null, terminada_en: NOW });
    await mk("open", "2026-11-10", "2026-11-10T06:00:00-03:00");
    expect(await findRunOfDay(db, "2026-11-10")).toBeNull();
    await finishRun(db, "open", { estado: "fallida", modelos_comparados: 0, consultas_usadas: 0, error: "x", terminada_en: NOW });
    expect(await findRunOfDay(db, "2026-11-10")).toBeNull();
    await mk("p1", "2026-11-10", "2026-11-10T07:00:00-03:00");
    await finishRun(db, "p1", { estado: "parcial", modelos_comparados: 1, consultas_usadas: 1, error: null, terminada_en: NOW });
    await mk("ok1", "2026-11-10", "2026-11-10T08:00:00-03:00");
    await finishRun(db, "ok1", { estado: "ok", modelos_comparados: 1, consultas_usadas: 1, error: null, terminada_en: NOW });
    await mk("open2", "2026-11-10", "2026-11-10T09:00:00-03:00");
    expect(await findRunOfDay(db, "2026-11-10")).toEqual({ id: "ok1", estado: "ok" });
  });
});
