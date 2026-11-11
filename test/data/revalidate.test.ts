import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { candidateSchema, type Candidate } from "../../src/contract/candidate-list.js";
import type { LocalOutputHooks, OwnerAlert, RevalidationReport } from "../../src/contract/local-hooks.js";
import { BudgetExhaustedError, NetworkError, UpstreamError } from "../../src/data/http.js";
import { MlAuthError } from "../../src/data/ml/auth.js";
import type { MlCatalog, MlOffer } from "../../src/data/ml/catalog.js";
import { revalidateChosen, runRevalidate } from "../../src/data/revalidate.js";
import { main, runDaily, USAGE, type RunDeps } from "../../src/data/run-daily.js";
import { fravegaSearchUrl } from "../../src/data/stores/fravega.js";
import { StoreFormatError, type Listing, type StoreAdapter } from "../../src/data/types.js";
import { loadConfig, type AppConfig } from "../../src/shared/config.js";
import type { SqlClient } from "../../src/shared/db/sql-client.js";
import type { LocalEnv } from "../../src/shared/env.js";
import { createSqliteClient } from "../support/sqlite-client.js";

const NOW = new Date("2026-11-10T13:45:00Z"); // 10:45 ART
const RUN = "2026-11-10-aspiradoras-robot-060000";
const OLD_RUN = "2026-11-09-aspiradoras-robot-060000";
const MIN = 60_000;

type Db = ReturnType<typeof createSqliteClient>;

function candidate(over: { id?: string; modelo?: string; ml?: number; rivals?: [string, string, number][] } = {}): Candidate {
  const modelo = over.modelo ?? "FAKE:AAA111";
  const ml = over.ml ?? 100000;
  const rivals = over.rivals ?? [["fravega", "/p/fake-aaa111-1", 150000]];
  return candidateSchema.parse({
    candidato_id: over.id ?? `${RUN}:${modelo}`,
    modelo_id: modelo,
    marca: "Fake",
    titulo: "Aspiradora Robot Fake AAA111",
    imagen_url: null,
    ml: {
      tienda: "ml",
      titulo_listado: "Aspiradora Robot Fake AAA111",
      url: "https://www.mercadolibre.com.ar/p/MLA00000099",
      precio_ars: ml,
      observado_en: "2026-11-10T06:00:00-03:00",
      ref_externa: "MLA90000990",
      vendedor: "3001",
      ml_product_id: "MLA00000099",
      ml_seller_id: "3001",
    },
    otras: rivals.map(([tienda, ref, precio]) => ({
      tienda,
      titulo_listado: "Robot Fake AAA111",
      url: `https://example.test${ref}`,
      precio_ars: precio,
      observado_en: "2026-11-10T06:00:00-03:00",
      ref_externa: ref,
      vendedor: "Frávega",
    })),
    diferencia_ars: [...rivals].sort((a, b) => a[2] - b[2])[0]![2] - ml,
    diferencia_pct: (([...rivals].sort((a, b) => a[2] - b[2])[0]![2] - ml) * 100) / [...rivals].sort((a, b) => a[2] - b[2])[0]![2],
    confianza: "alta",
    regla_emparejado: "gtin",
  });
}

async function seedRun(db: Db, id: string, fecha: string) {
  await db.run("INSERT INTO corridas (id, fecha, categoria, estado, iniciada_en) VALUES (?, ?, 'aspiradoras-robot', 'ok', ?)", [id, fecha, `${fecha}T06:00:00-03:00`]);
}

async function seedModel(db: Db, id = "FAKE:AAA111", code = "AAA111") {
  await db.run("INSERT INTO modelos (id, categoria, marca, codigo_modelo, clave, ml_product_id, titulo, creado_en) VALUES (?, 'aspiradoras-robot', 'Fake', ?, ?, 'MLA00000099', 'Fake', '2026-11-10T06:00:00-03:00')", [id, code, id]);
}

async function seedCandidate(
  db: Db,
  c: Candidate,
  o: { estado?: string; corrida?: string; validado_en?: string | null; telegram_file_id?: string | null; enlace?: string | null } = {},
) {
  await db.run(
    "INSERT INTO candidatos (id, corrida_id, modelo_id, payload, estado, enlace_afiliado, telegram_file_id, validado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [c.candidato_id, o.corrida ?? RUN, c.modelo_id, JSON.stringify(c), o.estado ?? "elegido", o.enlace ?? null, o.telegram_file_id ?? null, o.validado_en ?? null],
  );
}

const offer = (precio_ars: number, condicion = "new", item_id = "MLA90000990"): MlOffer => ({ item_id, seller_id: "3001", precio_ars, condicion });
const listing = (tienda: string, ref: string, precio_ars: number): Listing => ({
  tienda,
  titulo: "Robot Fake AAA111",
  marca: "Fake",
  modelo: "AAA111",
  gtin: null,
  precio_ars,
  ref_externa: ref,
  url: `https://example.test${ref}`,
  vendedor: "Frávega",
  condicion: null,
  observado_en: "2026-11-10T10:45:00-03:00",
});

type Reads = { offers: string[]; searches: { store: string; term: string }[] };
function fakes(opts: {
  offers?: Record<string, MlOffer[] | Error>;
  stores?: Record<string, Record<string, Listing[] | Error>>;
}) {
  const reads: Reads = { offers: [], searches: [] };
  const catalog: MlCatalog = {
    searchProducts: async () => {
      throw new Error("not used");
    },
    getProduct: async () => {
      throw new Error("not used");
    },
    async getOffers(id) {
      reads.offers.push(id);
      const r = opts.offers?.[id];
      if (r instanceof Error) throw r;
      return r ?? [];
    },
  };
  const stores: StoreAdapter[] = Object.entries(opts.stores ?? {}).map(([id, byTerm]) => ({
    id,
    async search(term) {
      reads.searches.push({ store: id, term });
      const r = byTerm[term];
      if (r instanceof Error) throw r;
      return r ?? [];
    },
  }));
  return { catalog, stores, reads };
}

async function config(db: SqlClient): Promise<AppConfig> {
  return loadConfig(db);
}

async function setupDb(): Promise<Db> {
  const db = createSqliteClient();
  await seedRun(db, RUN, "2026-11-10");
  await seedModel(db);
  return db;
}

const stateOf = (db: Db, id: string) =>
  db.all<{ estado: string; validado_en: string | null; telegram_file_id: string | null; payload: string; enlace_afiliado: string | null }>(
    "SELECT estado, validado_en, telegram_file_id, payload, enlace_afiliado FROM candidatos WHERE id = ?",
    [id],
  ).then((r) => r[0]!);

const FAKE_MODEL_TERM = "Fake AAA111";
const okReads = (rivalPrice = 150000, mlPrice = 100000) =>
  fakes({
    offers: { MLA00000099: [offer(mlPrice)] },
    stores: { fravega: { [FAKE_MODEL_TERM]: [listing("fravega", "/p/fake-aaa111-1", rivalPrice)] } },
  });

async function revalidateAll(db: Db, f: ReturnType<typeof fakes>) {
  return revalidateChosen({ db, catalog: f.catalog, stores: f.stores, config: await config(db), now: () => NOW });
}
async function revalidate(db: Db, f: ReturnType<typeof fakes>) {
  return (await revalidateAll(db, f)).report;
}

describe("revalidateChosen", () => {
  it("validates a chosen candidate that still passes and stamps validado_en", async () => {
    const db = await setupDb();
    const c = candidate();
    await seedCandidate(db, c);
    const report = await revalidate(db, okReads());
    expect(report).toEqual({ fecha: "2026-11-10", validated: [c.candidato_id], invalidated: [] });
    expect(await stateOf(db, c.candidato_id)).toMatchObject({ estado: "validado", validado_en: "2026-11-10T10:45:00-03:00" });
  });

  it("reads the model with '<marca> <codigo_modelo>' in every rival store", async () => {
    const db = await setupDb();
    await seedCandidate(db, candidate());
    const f = okReads();
    await revalidate(db, f);
    expect(f.reads.offers).toEqual(["MLA00000099"]);
    expect(f.reads.searches).toEqual([{ store: "fravega", term: "Fake AAA111" }]);
  });

  it("invalidates below_threshold when the rival price dropped", async () => {
    const db = await setupDb();
    const c = candidate();
    await seedCandidate(db, c);
    const report = await revalidate(db, okReads(110000)); // 9.09% cheaper, threshold is 15
    expect(report.validated).toEqual([]);
    expect(report.invalidated).toEqual([{ candidato_id: c.candidato_id, titulo: c.titulo, reason: "below_threshold" }]);
    expect((await stateOf(db, c.candidato_id)).estado).toBe("invalidado");
  });

  it("invalidates below_threshold when the ML price rose", async () => {
    const db = await setupDb();
    const c = candidate();
    await seedCandidate(db, c);
    const report = await revalidate(db, okReads(150000, 140000));
    expect(report.invalidated.map((i) => i.reason)).toEqual(["below_threshold"]);
  });

  it("invalidates offer_missing when the rival listing disappeared", async () => {
    const db = await setupDb();
    const c = candidate();
    await seedCandidate(db, c);
    const f = fakes({ offers: { MLA00000099: [offer(100000)] }, stores: { fravega: { [FAKE_MODEL_TERM]: [] } } });
    const report = await revalidate(db, f);
    expect(report.invalidated).toEqual([{ candidato_id: c.candidato_id, titulo: c.titulo, reason: "offer_missing" }]);
    expect((await stateOf(db, c.candidato_id)).estado).toBe("invalidado");
  });

  it("invalidates offer_missing when the search returns other listings but not the same ref_externa", async () => {
    const db = await setupDb();
    const c = candidate();
    await seedCandidate(db, c);
    const f = fakes({ offers: { MLA00000099: [offer(100000)] }, stores: { fravega: { [FAKE_MODEL_TERM]: [listing("fravega", "/p/other-2", 150000)] } } });
    expect((await revalidate(db, f)).invalidated.map((i) => i.reason)).toEqual(["offer_missing"]);
  });

  it("invalidates offer_missing when ML has no new offer left", async () => {
    const db = await setupDb();
    const c = candidate();
    await seedCandidate(db, c);
    const f = fakes({ offers: { MLA00000099: [offer(90000, "used")] }, stores: { fravega: { [FAKE_MODEL_TERM]: [listing("fravega", "/p/fake-aaa111-1", 150000)] } } });
    expect((await revalidate(db, f)).invalidated.map((i) => i.reason)).toEqual(["offer_missing"]);
  });

  const untouched = async (db: Db, c: Candidate, before: Awaited<ReturnType<typeof stateOf>>) => expect(await stateOf(db, c.candidato_id)).toEqual(before);

  it.each([
    ["a network failure reading ML", fakes({ offers: { MLA00000099: new NetworkError("fetch failed") }, stores: { fravega: { [FAKE_MODEL_TERM]: [listing("fravega", "/p/fake-aaa111-1", 150000)] } } })],
    ["an upstream error reading ML", fakes({ offers: { MLA00000099: new UpstreamError(503, "https://api.mercadolibre.com/x") }, stores: { fravega: {} } })],
    ["the request budget running out", fakes({ offers: { MLA00000099: new BudgetExhaustedError() }, stores: { fravega: {} } })],
    ["an upstream error from the rival store", fakes({ offers: { MLA00000099: [offer(100000)] }, stores: { fravega: { [FAKE_MODEL_TERM]: new UpstreamError(503, "https://example.test") } } })],
    ["a missing adapter for the rival store", fakes({ offers: { MLA00000099: [offer(100000)] }, stores: { cetrogar: {} } })],
  ])("leaves a chosen candidate untouched and skipped on %s", async (_name, f) => {
    const db = await setupDb();
    const c = candidate();
    await seedCandidate(db, c, { telegram_file_id: "AgACfile" });
    const before = await stateOf(db, c.candidato_id);
    const { report, skipped } = await revalidateAll(db, f);
    expect(report).toEqual({ fecha: "2026-11-10", validated: [], invalidated: [] });
    expect(skipped).toMatchObject([{ candidato_id: c.candidato_id, titulo: c.titulo, tienda: null }]);
    expect(skipped[0]!.reason).not.toBe("");
    await untouched(db, c, before);
    expect(before).toMatchObject({ estado: "elegido", validado_en: null, telegram_file_id: "AgACfile" });
  });

  it("leaves the candidate untouched and names the store on a StoreFormatError", async () => {
    const db = await setupDb();
    const c = candidate();
    await seedCandidate(db, c);
    const before = await stateOf(db, c.candidato_id);
    const f = fakes({ offers: { MLA00000099: [offer(100000)] }, stores: { fravega: { [FAKE_MODEL_TERM]: new StoreFormatError("fravega", "layout changed") } } });
    const { report, skipped } = await revalidateAll(db, f);
    expect(report.invalidated).toEqual([]);
    expect(skipped).toMatchObject([{ candidato_id: c.candidato_id, tienda: "fravega" }]);
    await untouched(db, c, before);
  });

  it("does not validate on the remaining rival when another rival store fails to read", async () => {
    const db = await setupDb();
    await db.run("INSERT INTO tiendas (id, nombre) VALUES ('cetrogar', 'Cetrogar')");
    const c = candidate({ rivals: [["fravega", "/p/fake-aaa111-1", 150000], ["cetrogar", "/p/fake-aaa111-c", 160000]] });
    await seedCandidate(db, c);
    const before = await stateOf(db, c.candidato_id);
    const f = fakes({
      offers: { MLA00000099: [offer(100000)] },
      stores: {
        fravega: { [FAKE_MODEL_TERM]: new UpstreamError(503, "https://example.test") },
        cetrogar: { [FAKE_MODEL_TERM]: [listing("cetrogar", "/p/fake-aaa111-c", 160000)] },
      },
    });
    const { report, skipped } = await revalidateAll(db, f);
    expect(report).toEqual({ fecha: "2026-11-10", validated: [], invalidated: [] });
    expect(skipped).toHaveLength(1);
    await untouched(db, c, before);
  });

  it("keeps the old validado_en of a previously validated candidate whose re-read failed", async () => {
    const db = await setupDb();
    const c = candidate();
    await seedCandidate(db, c, { estado: "validado", validado_en: "2026-11-10T09:00:00-03:00", telegram_file_id: "AgACfile" });
    const before = await stateOf(db, c.candidato_id);
    const f = fakes({ offers: { MLA00000099: new NetworkError("fetch failed") }, stores: { fravega: {} } });
    const { skipped } = await revalidateAll(db, f);
    expect(skipped).toHaveLength(1);
    await untouched(db, c, before);
    expect(before).toMatchObject({ estado: "validado", validado_en: "2026-11-10T09:00:00-03:00" });
  });

  it("still invalidates a candidate whose ML offer is confirmed gone even if a rival store fails", async () => {
    const db = await setupDb();
    const c = candidate();
    await seedCandidate(db, c);
    const f = fakes({ offers: { MLA00000099: [offer(90000, "used")] }, stores: { fravega: { [FAKE_MODEL_TERM]: new UpstreamError(503, "x") } } });
    const { report, skipped } = await revalidateAll(db, f);
    expect(report.invalidated.map((i) => i.reason)).toEqual(["offer_missing"]);
    expect(skipped).toEqual([]);
  });

  it("validates the candidate that read fine and skips the one that did not, in the same run", async () => {
    const db = await setupDb();
    await seedModel(db, "FAKE:BBB222", "BBB222");
    const good = candidate();
    const bad = candidate({ modelo: "FAKE:BBB222", rivals: [["fravega", "/p/fake-bbb222-1", 150000]] });
    await seedCandidate(db, good);
    await seedCandidate(db, bad);
    const beforeBad = await stateOf(db, bad.candidato_id);
    const f = fakes({
      offers: { MLA00000099: [offer(100000)] },
      stores: { fravega: { "Fake AAA111": [listing("fravega", "/p/fake-aaa111-1", 150000)], "Fake BBB222": new UpstreamError(500, "x") } },
    });
    const { report, skipped } = await revalidateAll(db, f);
    expect(report).toEqual({ fecha: "2026-11-10", validated: [good.candidato_id], invalidated: [] });
    expect(skipped.map((k) => k.candidato_id)).toEqual([bad.candidato_id]);
    expect((await stateOf(db, good.candidato_id)).estado).toBe("validado");
    await untouched(db, bad, beforeBad);
  });

  it("saves the observations that were read even when the candidate is skipped", async () => {
    const db = await setupDb();
    await seedCandidate(db, candidate());
    const f = fakes({ offers: { MLA00000099: [offer(100000)] }, stores: { fravega: { [FAKE_MODEL_TERM]: new UpstreamError(503, "x") } } });
    await revalidateAll(db, f);
    const n = await db.all<{ n: number }>("SELECT COUNT(*) AS n FROM observaciones_precio WHERE corrida_id = ?", [RUN]);
    expect(n[0]!.n).toBe(1);
  });

  it("lets an authorization failure through and leaves the candidate untouched", async () => {
    const db = await setupDb();
    const c = candidate();
    await seedCandidate(db, c);
    const f = fakes({ offers: { MLA00000099: new MlAuthError("not_authorized") }, stores: { fravega: {} } });
    await expect(revalidate(db, f)).rejects.toBeInstanceOf(MlAuthError);
    expect((await stateOf(db, c.candidato_id)).estado).toBe("elegido");
  });

  it("rewrites payload prices and clears telegram_file_id when a price changed but still passes", async () => {
    const db = await setupDb();
    const c = candidate();
    await seedCandidate(db, c, { telegram_file_id: "AgACfile" });
    const report = await revalidate(db, okReads(140000, 100000));
    expect(report.validated).toEqual([c.candidato_id]);
    const row = await stateOf(db, c.candidato_id);
    expect(row).toMatchObject({ estado: "validado", telegram_file_id: null });
    const payload = JSON.parse(row.payload) as Candidate;
    expect(payload.otras[0]).toMatchObject({ precio_ars: 140000, observado_en: "2026-11-10T10:45:00-03:00" });
    expect(payload.ml).toMatchObject({ precio_ars: 100000, observado_en: "2026-11-10T10:45:00-03:00" });
    expect(payload.diferencia_ars).toBe(40000);
    expect(payload.diferencia_pct).toBeCloseTo((40000 * 100) / 140000, 10);
  });

  it("clears telegram_file_id when the ML price changed", async () => {
    const db = await setupDb();
    const c = candidate();
    await seedCandidate(db, c, { telegram_file_id: "AgACfile" });
    await revalidate(db, okReads(150000, 95000));
    const row = await stateOf(db, c.candidato_id);
    expect(row.telegram_file_id).toBeNull();
    expect((JSON.parse(row.payload) as Candidate).ml.precio_ars).toBe(95000);
  });

  it("keeps telegram_file_id when no price changed", async () => {
    const db = await setupDb();
    const c = candidate();
    await seedCandidate(db, c, { telegram_file_id: "AgACfile" });
    await revalidate(db, okReads());
    const row = await stateOf(db, c.candidato_id);
    expect(row).toMatchObject({ estado: "validado", telegram_file_id: "AgACfile" });
    expect((JSON.parse(row.payload) as Candidate).otras[0]!.observado_en).toBe("2026-11-10T10:45:00-03:00");
  });

  it("drops a missing rival, keeps the other and clears telegram_file_id because the shown list changed", async () => {
    const db = await setupDb();
    await db.run("INSERT INTO tiendas (id, nombre) VALUES ('cetrogar', 'Cetrogar')");
    const c = candidate({ rivals: [["fravega", "/p/fake-aaa111-1", 150000], ["cetrogar", "/p/fake-aaa111-c", 160000]] });
    await seedCandidate(db, c, { telegram_file_id: "AgACfile" });
    const f = fakes({
      offers: { MLA00000099: [offer(100000)] },
      stores: { fravega: { [FAKE_MODEL_TERM]: [] }, cetrogar: { [FAKE_MODEL_TERM]: [listing("cetrogar", "/p/fake-aaa111-c", 160000)] } },
    });
    const report = await revalidate(db, f);
    expect(report.validated).toEqual([c.candidato_id]);
    const row = await stateOf(db, c.candidato_id);
    const payload = JSON.parse(row.payload) as Candidate;
    expect(payload.otras.map((o) => o.tienda)).toEqual(["cetrogar"]);
    expect(payload.diferencia_ars).toBe(60000);
    expect(row.telegram_file_id).toBeNull();
  });

  it("revalidates when the cheapest rival changes to another store, keeping rivals sorted", async () => {
    const db = await setupDb();
    await db.run("INSERT INTO tiendas (id, nombre) VALUES ('cetrogar', 'Cetrogar')");
    const c = candidate({ rivals: [["fravega", "/p/fake-aaa111-1", 150000], ["cetrogar", "/p/fake-aaa111-c", 160000]] });
    await seedCandidate(db, c);
    const f = fakes({
      offers: { MLA00000099: [offer(100000)] },
      stores: {
        fravega: { [FAKE_MODEL_TERM]: [listing("fravega", "/p/fake-aaa111-1", 170000)] },
        cetrogar: { [FAKE_MODEL_TERM]: [listing("cetrogar", "/p/fake-aaa111-c", 155000)] },
      },
    });
    await revalidate(db, f);
    const payload = JSON.parse((await stateOf(db, c.candidato_id)).payload) as Candidate;
    expect(payload.otras.map((o) => [o.tienda, o.precio_ars])).toEqual([["cetrogar", 155000], ["fravega", 170000]]);
    expect(payload.diferencia_ars).toBe(55000);
  });

  it("revalidates validado older than 30 minutes and ignores fresher ones", async () => {
    const db = await setupDb();
    await seedModel(db, "FAKE:BBB222", "BBB222");
    await seedModel(db, "FAKE:CCC333", "CCC333");
    const old = candidate({ modelo: "FAKE:AAA111" });
    const fresh = candidate({ modelo: "FAKE:BBB222" });
    const edge = candidate({ modelo: "FAKE:CCC333" });
    await seedCandidate(db, old, { estado: "validado", validado_en: "2026-11-10T10:10:00-03:00" }); // 35 min
    await seedCandidate(db, fresh, { estado: "validado", validado_en: "2026-11-10T10:16:00-03:00" }); // 29 min
    await seedCandidate(db, edge, { estado: "validado", validado_en: "2026-11-10T10:15:00-03:00" }); // exactly 30 min: not older
    const f = okReads();
    const report = await revalidate(db, f);
    expect(report.validated).toEqual([old.candidato_id]);
    expect((await stateOf(db, old.candidato_id)).validado_en).toBe("2026-11-10T10:45:00-03:00");
    expect((await stateOf(db, fresh.candidato_id)).validado_en).toBe("2026-11-10T10:16:00-03:00");
    expect((await stateOf(db, edge.candidato_id)).validado_en).toBe("2026-11-10T10:15:00-03:00");
    expect(f.reads.offers).toHaveLength(1);
  });

  it("can invalidate a validado older than 30 minutes", async () => {
    const db = await setupDb();
    const c = candidate();
    await seedCandidate(db, c, { estado: "validado", validado_en: "2026-11-10T09:00:00-03:00" });
    const report = await revalidate(db, okReads(110000));
    expect(report.invalidated.map((i) => i.reason)).toEqual(["below_threshold"]);
  });

  it("ignores candidates in any other state", async () => {
    const db = await setupDb();
    const states = ["pendiente", "descartado", "publicado", "invalidado"];
    for (const [i, estado] of states.entries()) {
      await seedModel(db, `FAKE:S${i}`, `S${i}`);
      await seedCandidate(db, candidate({ modelo: `FAKE:S${i}` }), { estado });
    }
    const f = okReads();
    const report = await revalidate(db, f);
    expect(report).toEqual({ fecha: "2026-11-10", validated: [], invalidated: [] });
    expect(f.reads.offers).toEqual([]);
    expect(f.reads.searches).toEqual([]);
  });

  it("ignores chosen candidates of previous ART days", async () => {
    const db = await setupDb();
    await seedRun(db, OLD_RUN, "2026-11-09");
    const stale = candidate({ id: `${OLD_RUN}:FAKE:AAA111` });
    await seedCandidate(db, stale, { corrida: OLD_RUN });
    const f = okReads();
    const report = await revalidate(db, f);
    expect(report).toEqual({ fecha: "2026-11-10", validated: [], invalidated: [] });
    expect(f.reads.offers).toEqual([]);
    expect((await stateOf(db, stale.candidato_id)).estado).toBe("elegido");
  });

  it("uses the ART day near midnight UTC", async () => {
    const db = await setupDb();
    await seedCandidate(db, candidate());
    const f = okReads();
    const { report } = await revalidateChosen({ db, catalog: f.catalog, stores: f.stores, config: await config(db), now: () => new Date("2026-11-11T01:30:00Z") });
    expect(report.fecha).toBe("2026-11-10");
    expect(report.validated).toHaveLength(1);
  });

  it("stores a payload that passes candidateSchema after a price change", async () => {
    const db = await setupDb();
    const c = candidate();
    await seedCandidate(db, c);
    await revalidate(db, okReads(180000, 120000));
    const parsed = candidateSchema.safeParse(JSON.parse((await stateOf(db, c.candidato_id)).payload));
    expect(parsed.success).toBe(true);
  });

  it("invalidates instead of storing when the stored payload is not a valid candidate", async () => {
    const db = await setupDb();
    await db.run("INSERT INTO candidatos (id, corrida_id, modelo_id, payload, estado) VALUES ('broken', ?, 'FAKE:AAA111', '{\"nope\":1}', 'elegido')", [RUN]);
    const report = await revalidate(db, okReads());
    expect(report.invalidated).toEqual([{ candidato_id: "broken", titulo: "broken", reason: "offer_missing" }]);
    expect((await stateOf(db, "broken")).estado).toBe("invalidado");
  });

  it("saves every re-read price as an observation under the original corrida_id", async () => {
    const db = await setupDb();
    await seedCandidate(db, candidate());
    const f = fakes({
      offers: { MLA00000099: [offer(100000), offer(130000, "new", "MLA90000991"), offer(80000, "used", "MLA90000992")] },
      stores: { fravega: { [FAKE_MODEL_TERM]: [listing("fravega", "/p/fake-aaa111-1", 150000), listing("fravega", "/p/fake-aaa111-2", 155000)] } },
    });
    await revalidate(db, f);
    const rows = await db.all<{ tienda_id: string; ref_externa: string; precio_ars: number; corrida_id: string; observado_en: string }>(
      `SELECT p.tienda_id, p.ref_externa, o.precio_ars, o.corrida_id, o.observado_en FROM observaciones_precio o
       JOIN publicaciones_tienda p ON p.id = o.publicacion_id ORDER BY p.tienda_id, p.ref_externa`,
    );
    expect(rows).toEqual([
      { tienda_id: "fravega", ref_externa: "/p/fake-aaa111-1", precio_ars: 150000, corrida_id: RUN, observado_en: "2026-11-10T10:45:00-03:00" },
      { tienda_id: "fravega", ref_externa: "/p/fake-aaa111-2", precio_ars: 155000, corrida_id: RUN, observado_en: "2026-11-10T10:45:00-03:00" },
      { tienda_id: "ml", ref_externa: "MLA90000990", precio_ars: 100000, corrida_id: RUN, observado_en: "2026-11-10T10:45:00-03:00" },
      { tienda_id: "ml", ref_externa: "MLA90000991", precio_ars: 130000, corrida_id: RUN, observado_en: "2026-11-10T10:45:00-03:00" },
      { tienda_id: "ml", ref_externa: "MLA90000992", precio_ars: 80000, corrida_id: RUN, observado_en: "2026-11-10T10:45:00-03:00" },
    ]);
  });

  it("saves the observations of an invalidated candidate too", async () => {
    const db = await setupDb();
    await seedCandidate(db, candidate());
    await revalidate(db, okReads(110000));
    const n = await db.all<{ n: number }>("SELECT COUNT(*) AS n FROM observaciones_precio WHERE corrida_id = ?", [RUN]);
    expect(n[0]!.n).toBe(2);
  });

  it("never changes enlace_afiliado", async () => {
    const db = await setupDb();
    await seedModel(db, "FAKE:BBB222", "BBB222");
    const link = "https://meli.la/2AbCdEf?x=1&y=%20z";
    const a = candidate();
    const b = candidate({ modelo: "FAKE:BBB222" });
    await seedCandidate(db, a, { enlace: link });
    await seedCandidate(db, b, { enlace: link });
    const f = fakes({
      offers: { MLA00000099: [offer(100000)] },
      stores: { fravega: { "Fake AAA111": [listing("fravega", "/p/fake-aaa111-1", 140000)], "Fake BBB222": [] } },
    });
    await revalidate(db, f);
    expect((await stateOf(db, a.candidato_id)).enlace_afiliado).toBe(link);
    expect((await stateOf(db, b.candidato_id))).toMatchObject({ estado: "invalidado", enlace_afiliado: link });
  });

  it("does not overwrite a candidate whose state changed while it was being re-read", async () => {
    const db = await setupDb();
    const c = candidate();
    await seedCandidate(db, c);
    const f = okReads();
    const slow: MlCatalog = {
      ...f.catalog,
      async getOffers(id) {
        await db.run("UPDATE candidatos SET estado = 'publicado' WHERE id = ?", [c.candidato_id]);
        return f.catalog.getOffers(id);
      },
    };
    const { report } = await revalidateChosen({ db, catalog: slow, stores: f.stores, config: await config(db), now: () => NOW });
    expect(report).toEqual({ fecha: "2026-11-10", validated: [], invalidated: [] });
    expect((await stateOf(db, c.candidato_id)).estado).toBe("publicado");
  });
});

// ---- the command: composed replay from existing fixtures plus synthetic -derived ones ----

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = (...parts: string[]) => path.join(ROOT, "fixtures", ...parts);
const read = (...parts: string[]) => readFileSync(fixture(...parts), "utf8");
const FRAVEGA_HTML = read("fravega", "listing-aspiradoras-robot.html");
const FRAVEGA_NONE = read("fravega", "listing-no-results.html");
const ML = "https://api.mercadolibre.com";
const searchUrl = (q: string) => `${ML}/products/search?site_id=MLA&status=active&q=${encodeURIComponent(q)}`;
const itemsUrl = (id: string) => `${ML}/products/${id}/items`;

const SECRETS = { token: "tok-SECRET-access", clientSecret: "client-SECRET-value", cfToken: "cf-SECRET-token", refresh: "refresh-SECRET-value" };
const ENV: LocalEnv = {
  mlAppId: "app-id",
  mlClientSecret: SECRETS.clientSecret,
  mlRedirectUri: "https://imperdibles.ar",
  cfAccountId: "acct",
  cfApiToken: SECRETS.cfToken,
  d1DatabaseId: "db",
  telegramBotToken: "",
  telegramOwnerChatId: "",
  telegramChannelId: "",
  publishNowSecret: "",
  workerBaseUrl: "",
};

type Routes = Map<string, () => Response>;
function composedRoutes(): Routes {
  const json = (body: string) => () => new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  const html = (body: string) => () => new Response(body, { status: 200, headers: { "content-type": "text/html" } });
  return new Map<string, () => Response>([
    [fravegaSearchUrl("aspiradora robot"), html(FRAVEGA_HTML)],
    [fravegaSearchUrl("Philco PHRA26N"), html(FRAVEGA_HTML)],
    [searchUrl("Philco PHRA26N"), json(read("ml", "products-search-philco-phra26n-derived.json"))],
    [itemsUrl("MLA00000011"), json(read("ml", "product-items-philco-derived.json"))],
    [searchUrl("Irobot M611330"), json(read("ml", "products-search-irobot-m611330-derived.json"))],
    [itemsUrl("MLA00000012"), json(read("ml", "product-items-irobot-derived.json"))],
    [searchUrl("Smartlife SLRVCL050"), json(read("ml", "product-items-empty-derived.json"))],
  ]);
}

type Hooks = LocalOutputHooks & { reports: RevalidationReport[]; alerts: OwnerAlert[] };
function setup(opts: { routes?: Routes; fetchImpl?: typeof fetch } = {}) {
  const sqlite = createSqliteClient();
  sqlite.raw.prepare("INSERT INTO tokens_ml (id, access_token, refresh_token, expira_en) VALUES (1, ?, ?, '2026-11-12T00:00:00.000Z')").run(SECRETS.token, SECRETS.refresh);
  const routes = opts.routes ?? composedRoutes();
  const fetched: string[] = [];
  const routed: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    fetched.push(url);
    const route = routes.get(url);
    if (!route) throw new Error(`unrecorded URL: ${url}`);
    return route();
  };
  const hooks: Hooks = {
    reports: [],
    alerts: [],
    onCandidatesReady: async () => {},
    onRevalidated: async (r) => void hooks.reports.push(r),
    notifyOwner: async (a) => void hooks.alerts.push(a),
  };
  const out: string[] = [];
  const err: string[] = [];
  const clock = { now: new Date("2026-11-10T09:00:00Z") }; // 06:00 ART
  const logPath = path.join(mkdtempSync(path.join(tmpdir(), "imperdibles-reval-")), "var", "run-log.jsonl");
  const deps: RunDeps = {
    db: sqlite,
    fetch: opts.fetchImpl ?? routed,
    env: ENV,
    now: () => clock.now,
    sleep: async () => {},
    hooks,
    logPath,
    stdout: (s) => void out.push(s),
    stderr: (s) => void err.push(s),
  };
  return { deps, sqlite, hooks, out, err, fetched, routes, logPath, clock };
}
type Setup = ReturnType<typeof setup>;

const PHILCO = `${RUN}:PHILCO:PHRA26N`;
const logLine = (p: string) => JSON.parse(readFileSync(p, "utf8").trim().split("\n").at(-1)!) as Record<string, string>;
async function collectAndChoose(s: Setup): Promise<void> {
  expect((await runDaily(s.deps, { force: false })).exitCode).toBe(0);
  await s.sqlite.run("UPDATE candidatos SET estado = 'elegido', telegram_file_id = 'AgACfile', enlace_afiliado = 'https://meli.la/abc' WHERE id = ?", [PHILCO]);
  s.fetched.length = 0;
  s.out.length = 0;
  s.clock.now = new Date("2026-11-10T13:45:00Z"); // 10:45 ART
}

describe("imperdibles revalidar", () => {
  it("replays the run: validates the chosen candidate, reports it to the hook and reads only what it needs", async () => {
    const s = setup();
    await collectAndChoose(s);
    const before = await s.sqlite.all<{ n: number }>("SELECT COUNT(*) AS n FROM observaciones_precio");
    expect(await runRevalidate(s.deps)).toBe(0);
    expect(s.hooks.reports).toEqual([{ fecha: "2026-11-10", validated: [PHILCO], invalidated: [] }]);
    expect(s.fetched).toEqual([itemsUrl("MLA00000011"), fravegaSearchUrl("Philco PHRA26N")]);
    const row = await stateOf(s.sqlite, PHILCO);
    expect(row).toMatchObject({ estado: "validado", validado_en: "2026-11-10T10:45:00-03:00", telegram_file_id: "AgACfile", enlace_afiliado: "https://meli.la/abc" });
    const after = await s.sqlite.all<{ n: number }>("SELECT COUNT(*) AS n FROM observaciones_precio");
    expect(after[0]!.n).toBeGreaterThan(before[0]!.n);
    expect(s.out.join("")).toBe("Revalidación 2026-11-10: 1 validados, 0 invalidados.\n");
  });

  it("invalidates offer_missing when the other store no longer lists the product", async () => {
    const s = setup();
    await collectAndChoose(s);
    s.routes.set(fravegaSearchUrl("Philco PHRA26N"), () => new Response(FRAVEGA_NONE, { status: 200 }));
    expect(await runRevalidate(s.deps)).toBe(0);
    expect(s.hooks.reports).toHaveLength(1);
    expect(s.hooks.reports[0]!.invalidated).toMatchObject([{ candidato_id: PHILCO, reason: "offer_missing" }]);
    expect((await stateOf(s.sqlite, PHILCO)).estado).toBe("invalidado");
  });

  it("leaves the candidate untouched, logs it, alerts and exits 1 when the other store answers an error", async () => {
    const s = setup();
    await collectAndChoose(s);
    const before = await stateOf(s.sqlite, PHILCO);
    s.routes.set(fravegaSearchUrl("Philco PHRA26N"), () => new Response("nope", { status: 500 }));
    expect(await runRevalidate(s.deps)).toBe(1);
    expect(await stateOf(s.sqlite, PHILCO)).toEqual(before);
    expect(s.hooks.reports).toEqual([{ fecha: "2026-11-10", validated: [], invalidated: [] }]);
    expect(s.hooks.alerts).toHaveLength(1);
    expect(s.hooks.alerts[0]).toMatchObject({ kind: "run_failed", corrida_id: null });
    expect(JSON.stringify(s.hooks.alerts[0])).toContain(PHILCO);
    expect(readFileSync(s.logPath, "utf8")).toContain(PHILCO);
    expect(s.err.join("")).toContain("sin cambios");
  });

  it("alerts store_format_error naming the store when the other store's page changed shape", async () => {
    const s = setup();
    await collectAndChoose(s);
    const before = await stateOf(s.sqlite, PHILCO);
    s.routes.set(fravegaSearchUrl("Philco PHRA26N"), () => new Response(read("fravega", "listing-broken-derived.html"), { status: 200 }));
    expect(await runRevalidate(s.deps)).toBe(1);
    expect(s.hooks.alerts).toEqual([{ kind: "store_format_error", tienda: "fravega" }]);
    expect(await stateOf(s.sqlite, PHILCO)).toEqual(before);
  });

  it("reads nothing, but still reports an empty result, when nothing is chosen", async () => {
    const s = setup();
    expect((await runDaily(s.deps, { force: false })).exitCode).toBe(0);
    s.fetched.length = 0;
    s.out.length = 0;
    s.clock.now = new Date("2026-11-10T13:45:00Z");
    expect(await runRevalidate(s.deps)).toBe(0);
    expect(s.fetched).toEqual([]);
    expect(s.hooks.reports).toEqual([{ fecha: "2026-11-10", validated: [], invalidated: [] }]);
    expect(s.out.join("")).toBe("Revalidación 2026-11-10: 0 validados, 0 invalidados.\n");
  });

  it("alerts ml_auth_required and leaves the candidate chosen when authorization is lost", async () => {
    const s = setup();
    await collectAndChoose(s);
    s.routes.set(itemsUrl("MLA00000011"), () => new Response("{}", { status: 401 }));
    s.routes.set(`${ML}/oauth/token`, () => new Response('{"error":"invalid_grant"}', { status: 400 }));
    expect(await runRevalidate(s.deps)).toBe(1);
    expect(s.hooks.alerts).toEqual([{ kind: "ml_auth_required" }]);
    expect(s.hooks.reports).toEqual([]);
    expect((await stateOf(s.sqlite, PHILCO)).estado).toBe("elegido");
  });

  it("scrubs secrets from the log, stderr and alerts when the hook fails", async () => {
    const s = setup();
    await collectAndChoose(s);
    s.hooks.onRevalidated = async () => {
      throw new Error(`boom ${Object.values(SECRETS).join(" | ")} https://api.telegram.org/bot111222:ABC-def_ghi/sendMessage`);
    };
    expect(await runRevalidate(s.deps)).toBe(1);
    const everything = [readFileSync(s.logPath, "utf8"), s.out.join(""), s.err.join(""), JSON.stringify(s.hooks.alerts)].join("\n");
    for (const secret of Object.values(SECRETS)) expect(everything).not.toContain(secret);
    expect(everything).not.toContain("111222:ABC-def_ghi");
    expect(everything).toContain("boom");
    expect(s.hooks.alerts).toMatchObject([{ kind: "run_failed", corrida_id: null }]);
  });

  it("leaves the chosen candidate untouched, alerts and exits 1 when the network is down", async () => {
    const s = setup();
    await collectAndChoose(s);
    const before = await stateOf(s.sqlite, PHILCO);
    s.deps.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await runRevalidate(s.deps)).toBe(1);
    expect(await stateOf(s.sqlite, PHILCO)).toEqual(before);
    expect(s.hooks.reports).toEqual([{ fecha: "2026-11-10", validated: [], invalidated: [] }]);
    expect(s.hooks.alerts).toMatchObject([{ kind: "run_failed", corrida_id: null }]);
    expect(logLine(s.logPath)).toMatchObject({ corrida_id: null, estado: "fallida" });
    expect(logLine(s.logPath).error).toContain(PHILCO);
  });

  it("still reports the skipped candidates when the hook fails", async () => {
    const s = setup();
    await collectAndChoose(s);
    s.deps.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    s.hooks.onRevalidated = async () => {
      throw new Error("hook down");
    };
    expect(await runRevalidate(s.deps)).toBe(1);
    expect(readFileSync(s.logPath, "utf8")).toContain(PHILCO);
    expect(s.hooks.alerts.length).toBeGreaterThanOrEqual(1);
  });

  it("does not let a failing notifyOwner hide the exit code", async () => {
    const s = setup();
    await collectAndChoose(s);
    s.hooks.onRevalidated = async () => {
      throw new Error("telegram down");
    };
    s.hooks.notifyOwner = async () => {
      throw new Error("also down");
    };
    expect(await runRevalidate(s.deps)).toBe(1);
  });
});

describe("main", () => {
  it("routes 'revalidar' and rejects flags", async () => {
    const s = setup();
    expect(await main(["revalidar"], s.deps)).toBe(0);
    expect(s.hooks.reports).toHaveLength(1);
    expect(await main(["revalidar", "--forzar"], s.deps)).toBe(2);
    expect(s.err.join("")).toContain(USAGE);
  });

  it("documents revalidar in the usage text", () => {
    expect(USAGE).toContain("imperdibles revalidar");
  });
});

describe("bin/imperdibles", () => {
  it("creates var/ before running, because launchd does not create the log directory", () => {
    const root = mkdtempSync(path.join(tmpdir(), "imperdibles-bin-"));
    mkdirSync(path.join(root, "bin"));
    mkdirSync(path.join(root, "stub"));
    copyFileSync(path.join(ROOT, "bin", "imperdibles"), path.join(root, "bin", "imperdibles"));
    chmodSync(path.join(root, "bin", "imperdibles"), 0o755);
    writeFileSync(path.join(root, "stub", "pnpm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    expect(existsSync(path.join(root, "var"))).toBe(false);
    const r = spawnSync(path.join(root, "bin", "imperdibles"), ["revalidar"], { env: { PATH: `${path.join(root, "stub")}:/usr/bin:/bin` } });
    expect(r.status).toBe(0);
    expect(existsSync(path.join(root, "var"))).toBe(true);
  });
});
