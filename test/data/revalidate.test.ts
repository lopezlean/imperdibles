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

function candidate(over: { id?: string; model?: string; ml?: number; rivals?: [string, string, number][] } = {}): Candidate {
  const model = over.model ?? "FAKE:AAA111";
  const ml = over.ml ?? 100000;
  const rivals = over.rivals ?? [["fravega", "/p/fake-aaa111-1", 150000]];
  return candidateSchema.parse({
    candidate_id: over.id ?? `${RUN}:${model}`,
    model_id: model,
    brand: "Fake",
    title: "Aspiradora Robot Fake AAA111",
    image_url: null,
    ml: {
      store: "ml",
      listing_title: "Aspiradora Robot Fake AAA111",
      url: "https://www.mercadolibre.com.ar/p/MLA00000099",
      price_ars: ml,
      observed_at: "2026-11-10T06:00:00-03:00",
      external_ref: "MLA90000990",
      seller: "3001",
      ml_product_id: "MLA00000099",
      ml_seller_id: "3001",
    },
    others: rivals.map(([store, ref, price]) => ({
      store,
      listing_title: "Robot Fake AAA111",
      url: `https://example.test${ref}`,
      price_ars: price,
      observed_at: "2026-11-10T06:00:00-03:00",
      external_ref: ref,
      seller: "Frávega",
    })),
    difference_ars: [...rivals].sort((a, b) => a[2] - b[2])[0]![2] - ml,
    difference_pct: (([...rivals].sort((a, b) => a[2] - b[2])[0]![2] - ml) * 100) / [...rivals].sort((a, b) => a[2] - b[2])[0]![2],
    confidence: "high",
    match_rule: "gtin",
  });
}

async function seedRun(db: Db, id: string, run_date: string) {
  await db.run("INSERT INTO runs (id, run_date, category, status, started_at) VALUES (?, ?, 'aspiradoras-robot', 'ok', ?)", [id, run_date, `${run_date}T06:00:00-03:00`]);
}

async function seedModel(db: Db, id = "FAKE:AAA111", code = "AAA111") {
  await db.run("INSERT INTO models (id, category, brand, model_code, model_key, ml_product_id, title, created_at) VALUES (?, 'aspiradoras-robot', 'Fake', ?, ?, 'MLA00000099', 'Fake', '2026-11-10T06:00:00-03:00')", [id, code, id]);
}

async function seedCandidate(
  db: Db,
  c: Candidate,
  o: { status?: string; run?: string; validated_at?: string | null; telegram_file_id?: string | null; enlace?: string | null } = {},
) {
  await db.run(
    "INSERT INTO candidates (id, run_id, model_id, payload, status, affiliate_link, telegram_file_id, validated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [c.candidate_id, o.run ?? RUN, c.model_id, JSON.stringify(c), o.status ?? "chosen", o.enlace ?? null, o.telegram_file_id ?? null, o.validated_at ?? null],
  );
}

const offer = (price_ars: number, item_condition = "new", item_id = "MLA90000990"): MlOffer => ({ item_id, seller_id: "3001", price_ars, item_condition });
const listing = (store: string, ref: string, price_ars: number): Listing => ({
  store,
  title: "Robot Fake AAA111",
  brand: "Fake",
  model: "AAA111",
  gtin: null,
  price_ars,
  external_ref: ref,
  url: `https://example.test${ref}`,
  seller: "Frávega",
  item_condition: null,
  observed_at: "2026-11-10T10:45:00-03:00",
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
  db.all<{ status: string; validated_at: string | null; telegram_file_id: string | null; payload: string; affiliate_link: string | null }>(
    "SELECT status, validated_at, telegram_file_id, payload, affiliate_link FROM candidates WHERE id = ?",
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
  it("validates a chosen candidate that still passes and stamps validated_at", async () => {
    const db = await setupDb();
    const c = candidate();
    await seedCandidate(db, c);
    const report = await revalidate(db, okReads());
    expect(report).toEqual({ run_date: "2026-11-10", validated: [c.candidate_id], invalidated: [] });
    expect(await stateOf(db, c.candidate_id)).toMatchObject({ status: "validated", validated_at: "2026-11-10T10:45:00-03:00" });
  });

  it("reads the model with '<brand> <model_code>' in every rival store", async () => {
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
    expect(report.invalidated).toEqual([{ candidate_id: c.candidate_id, title: c.title, reason: "below_threshold" }]);
    expect((await stateOf(db, c.candidate_id)).status).toBe("invalidated");
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
    expect(report.invalidated).toEqual([{ candidate_id: c.candidate_id, title: c.title, reason: "offer_missing" }]);
    expect((await stateOf(db, c.candidate_id)).status).toBe("invalidated");
  });

  it("invalidates offer_missing when the search returns other listings but not the same external_ref", async () => {
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

  const untouched = async (db: Db, c: Candidate, before: Awaited<ReturnType<typeof stateOf>>) => expect(await stateOf(db, c.candidate_id)).toEqual(before);

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
    const before = await stateOf(db, c.candidate_id);
    const { report, skipped } = await revalidateAll(db, f);
    expect(report).toEqual({ run_date: "2026-11-10", validated: [], invalidated: [] });
    expect(skipped).toMatchObject([{ candidate_id: c.candidate_id, title: c.title, store: null }]);
    expect(skipped[0]!.reason).not.toBe("");
    await untouched(db, c, before);
    expect(before).toMatchObject({ status: "chosen", validated_at: null, telegram_file_id: "AgACfile" });
  });

  it("leaves the candidate untouched and names the store on a StoreFormatError", async () => {
    const db = await setupDb();
    const c = candidate();
    await seedCandidate(db, c);
    const before = await stateOf(db, c.candidate_id);
    const f = fakes({ offers: { MLA00000099: [offer(100000)] }, stores: { fravega: { [FAKE_MODEL_TERM]: new StoreFormatError("fravega", "layout changed") } } });
    const { report, skipped } = await revalidateAll(db, f);
    expect(report.invalidated).toEqual([]);
    expect(skipped).toMatchObject([{ candidate_id: c.candidate_id, store: "fravega" }]);
    await untouched(db, c, before);
  });

  it("does not validate on the remaining rival when another rival store fails to read", async () => {
    const db = await setupDb();
    await db.run("INSERT INTO stores (id, name) VALUES ('cetrogar', 'Cetrogar')");
    const c = candidate({ rivals: [["fravega", "/p/fake-aaa111-1", 150000], ["cetrogar", "/p/fake-aaa111-c", 160000]] });
    await seedCandidate(db, c);
    const before = await stateOf(db, c.candidate_id);
    const f = fakes({
      offers: { MLA00000099: [offer(100000)] },
      stores: {
        fravega: { [FAKE_MODEL_TERM]: new UpstreamError(503, "https://example.test") },
        cetrogar: { [FAKE_MODEL_TERM]: [listing("cetrogar", "/p/fake-aaa111-c", 160000)] },
      },
    });
    const { report, skipped } = await revalidateAll(db, f);
    expect(report).toEqual({ run_date: "2026-11-10", validated: [], invalidated: [] });
    expect(skipped).toHaveLength(1);
    await untouched(db, c, before);
  });

  it("keeps the old validated_at of a previously validated candidate whose re-read failed", async () => {
    const db = await setupDb();
    const c = candidate();
    await seedCandidate(db, c, { status: "validated", validated_at: "2026-11-10T09:00:00-03:00", telegram_file_id: "AgACfile" });
    const before = await stateOf(db, c.candidate_id);
    const f = fakes({ offers: { MLA00000099: new NetworkError("fetch failed") }, stores: { fravega: {} } });
    const { skipped } = await revalidateAll(db, f);
    expect(skipped).toHaveLength(1);
    await untouched(db, c, before);
    expect(before).toMatchObject({ status: "validated", validated_at: "2026-11-10T09:00:00-03:00" });
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
    const bad = candidate({ model: "FAKE:BBB222", rivals: [["fravega", "/p/fake-bbb222-1", 150000]] });
    await seedCandidate(db, good);
    await seedCandidate(db, bad);
    const beforeBad = await stateOf(db, bad.candidate_id);
    const f = fakes({
      offers: { MLA00000099: [offer(100000)] },
      stores: { fravega: { "Fake AAA111": [listing("fravega", "/p/fake-aaa111-1", 150000)], "Fake BBB222": new UpstreamError(500, "x") } },
    });
    const { report, skipped } = await revalidateAll(db, f);
    expect(report).toEqual({ run_date: "2026-11-10", validated: [good.candidate_id], invalidated: [] });
    expect(skipped.map((k) => k.candidate_id)).toEqual([bad.candidate_id]);
    expect((await stateOf(db, good.candidate_id)).status).toBe("validated");
    await untouched(db, bad, beforeBad);
  });

  it("saves the observations that were read even when the candidate is skipped", async () => {
    const db = await setupDb();
    await seedCandidate(db, candidate());
    const f = fakes({ offers: { MLA00000099: [offer(100000)] }, stores: { fravega: { [FAKE_MODEL_TERM]: new UpstreamError(503, "x") } } });
    await revalidateAll(db, f);
    const n = await db.all<{ n: number }>("SELECT COUNT(*) AS n FROM price_observations WHERE run_id = ?", [RUN]);
    expect(n[0]!.n).toBe(1);
  });

  it("lets an authorization failure through and leaves the candidate untouched", async () => {
    const db = await setupDb();
    const c = candidate();
    await seedCandidate(db, c);
    const f = fakes({ offers: { MLA00000099: new MlAuthError("not_authorized") }, stores: { fravega: {} } });
    await expect(revalidate(db, f)).rejects.toBeInstanceOf(MlAuthError);
    expect((await stateOf(db, c.candidate_id)).status).toBe("chosen");
  });

  it("rewrites payload prices and clears telegram_file_id when a price changed but still passes", async () => {
    const db = await setupDb();
    const c = candidate();
    await seedCandidate(db, c, { telegram_file_id: "AgACfile" });
    const report = await revalidate(db, okReads(140000, 100000));
    expect(report.validated).toEqual([c.candidate_id]);
    const row = await stateOf(db, c.candidate_id);
    expect(row).toMatchObject({ status: "validated", telegram_file_id: null });
    const payload = JSON.parse(row.payload) as Candidate;
    expect(payload.others[0]).toMatchObject({ price_ars: 140000, observed_at: "2026-11-10T10:45:00-03:00" });
    expect(payload.ml).toMatchObject({ price_ars: 100000, observed_at: "2026-11-10T10:45:00-03:00" });
    expect(payload.difference_ars).toBe(40000);
    expect(payload.difference_pct).toBeCloseTo((40000 * 100) / 140000, 10);
  });

  it("clears telegram_file_id when the ML price changed", async () => {
    const db = await setupDb();
    const c = candidate();
    await seedCandidate(db, c, { telegram_file_id: "AgACfile" });
    await revalidate(db, okReads(150000, 95000));
    const row = await stateOf(db, c.candidate_id);
    expect(row.telegram_file_id).toBeNull();
    expect((JSON.parse(row.payload) as Candidate).ml.price_ars).toBe(95000);
  });

  it("keeps telegram_file_id when no price changed", async () => {
    const db = await setupDb();
    const c = candidate();
    await seedCandidate(db, c, { telegram_file_id: "AgACfile" });
    await revalidate(db, okReads());
    const row = await stateOf(db, c.candidate_id);
    expect(row).toMatchObject({ status: "validated", telegram_file_id: "AgACfile" });
    expect((JSON.parse(row.payload) as Candidate).others[0]!.observed_at).toBe("2026-11-10T10:45:00-03:00");
  });

  it("drops a missing rival, keeps the other and clears telegram_file_id because the shown list changed", async () => {
    const db = await setupDb();
    await db.run("INSERT INTO stores (id, name) VALUES ('cetrogar', 'Cetrogar')");
    const c = candidate({ rivals: [["fravega", "/p/fake-aaa111-1", 150000], ["cetrogar", "/p/fake-aaa111-c", 160000]] });
    await seedCandidate(db, c, { telegram_file_id: "AgACfile" });
    const f = fakes({
      offers: { MLA00000099: [offer(100000)] },
      stores: { fravega: { [FAKE_MODEL_TERM]: [] }, cetrogar: { [FAKE_MODEL_TERM]: [listing("cetrogar", "/p/fake-aaa111-c", 160000)] } },
    });
    const report = await revalidate(db, f);
    expect(report.validated).toEqual([c.candidate_id]);
    const row = await stateOf(db, c.candidate_id);
    const payload = JSON.parse(row.payload) as Candidate;
    expect(payload.others.map((o) => o.store)).toEqual(["cetrogar"]);
    expect(payload.difference_ars).toBe(60000);
    expect(row.telegram_file_id).toBeNull();
  });

  it("revalidates when the cheapest rival changes to another store, keeping rivals sorted", async () => {
    const db = await setupDb();
    await db.run("INSERT INTO stores (id, name) VALUES ('cetrogar', 'Cetrogar')");
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
    const payload = JSON.parse((await stateOf(db, c.candidate_id)).payload) as Candidate;
    expect(payload.others.map((o) => [o.store, o.price_ars])).toEqual([["cetrogar", 155000], ["fravega", 170000]]);
    expect(payload.difference_ars).toBe(55000);
  });

  it("revalidates validated older than 30 minutes and ignores fresher ones", async () => {
    const db = await setupDb();
    await seedModel(db, "FAKE:BBB222", "BBB222");
    await seedModel(db, "FAKE:CCC333", "CCC333");
    const old = candidate({ model: "FAKE:AAA111" });
    const fresh = candidate({ model: "FAKE:BBB222" });
    const edge = candidate({ model: "FAKE:CCC333" });
    await seedCandidate(db, old, { status: "validated", validated_at: "2026-11-10T10:10:00-03:00" }); // 35 min
    await seedCandidate(db, fresh, { status: "validated", validated_at: "2026-11-10T10:16:00-03:00" }); // 29 min
    await seedCandidate(db, edge, { status: "validated", validated_at: "2026-11-10T10:15:00-03:00" }); // exactly 30 min: not older
    const f = okReads();
    const report = await revalidate(db, f);
    expect(report.validated).toEqual([old.candidate_id]);
    expect((await stateOf(db, old.candidate_id)).validated_at).toBe("2026-11-10T10:45:00-03:00");
    expect((await stateOf(db, fresh.candidate_id)).validated_at).toBe("2026-11-10T10:16:00-03:00");
    expect((await stateOf(db, edge.candidate_id)).validated_at).toBe("2026-11-10T10:15:00-03:00");
    expect(f.reads.offers).toHaveLength(1);
  });

  it("can invalidate a validated candidate older than 30 minutes", async () => {
    const db = await setupDb();
    const c = candidate();
    await seedCandidate(db, c, { status: "validated", validated_at: "2026-11-10T09:00:00-03:00" });
    const report = await revalidate(db, okReads(110000));
    expect(report.invalidated.map((i) => i.reason)).toEqual(["below_threshold"]);
  });

  it("ignores candidates in any other state", async () => {
    const db = await setupDb();
    const states = ["pending", "discarded", "published", "invalidated"];
    for (const [i, status] of states.entries()) {
      await seedModel(db, `FAKE:S${i}`, `S${i}`);
      await seedCandidate(db, candidate({ model: `FAKE:S${i}` }), { status });
    }
    const f = okReads();
    const report = await revalidate(db, f);
    expect(report).toEqual({ run_date: "2026-11-10", validated: [], invalidated: [] });
    expect(f.reads.offers).toEqual([]);
    expect(f.reads.searches).toEqual([]);
  });

  it("ignores chosen candidates of previous ART days", async () => {
    const db = await setupDb();
    await seedRun(db, OLD_RUN, "2026-11-09");
    const stale = candidate({ id: `${OLD_RUN}:FAKE:AAA111` });
    await seedCandidate(db, stale, { run: OLD_RUN });
    const f = okReads();
    const report = await revalidate(db, f);
    expect(report).toEqual({ run_date: "2026-11-10", validated: [], invalidated: [] });
    expect(f.reads.offers).toEqual([]);
    expect((await stateOf(db, stale.candidate_id)).status).toBe("chosen");
  });

  it("uses the ART day near midnight UTC", async () => {
    const db = await setupDb();
    await seedCandidate(db, candidate());
    const f = okReads();
    const { report } = await revalidateChosen({ db, catalog: f.catalog, stores: f.stores, config: await config(db), now: () => new Date("2026-11-11T01:30:00Z") });
    expect(report.run_date).toBe("2026-11-10");
    expect(report.validated).toHaveLength(1);
  });

  it("stores a payload that passes candidateSchema after a price change", async () => {
    const db = await setupDb();
    const c = candidate();
    await seedCandidate(db, c);
    await revalidate(db, okReads(180000, 120000));
    const parsed = candidateSchema.safeParse(JSON.parse((await stateOf(db, c.candidate_id)).payload));
    expect(parsed.success).toBe(true);
  });

  it("invalidates instead of storing when the stored payload is not a valid candidate", async () => {
    const db = await setupDb();
    await db.run("INSERT INTO candidates (id, run_id, model_id, payload, status) VALUES ('broken', ?, 'FAKE:AAA111', '{\"nope\":1}', 'chosen')", [RUN]);
    const report = await revalidate(db, okReads());
    expect(report.invalidated).toEqual([{ candidate_id: "broken", title: "broken", reason: "offer_missing" }]);
    expect((await stateOf(db, "broken")).status).toBe("invalidated");
  });

  it("saves every re-read price as an observation under the original run_id", async () => {
    const db = await setupDb();
    await seedCandidate(db, candidate());
    const f = fakes({
      offers: { MLA00000099: [offer(100000), offer(130000, "new", "MLA90000991"), offer(80000, "used", "MLA90000992")] },
      stores: { fravega: { [FAKE_MODEL_TERM]: [listing("fravega", "/p/fake-aaa111-1", 150000), listing("fravega", "/p/fake-aaa111-2", 155000)] } },
    });
    await revalidate(db, f);
    const rows = await db.all<{ store_id: string; external_ref: string; price_ars: number; run_id: string; observed_at: string }>(
      `SELECT p.store_id, p.external_ref, o.price_ars, o.run_id, o.observed_at FROM price_observations o
       JOIN store_listings p ON p.id = o.listing_id ORDER BY p.store_id, p.external_ref`,
    );
    expect(rows).toEqual([
      { store_id: "fravega", external_ref: "/p/fake-aaa111-1", price_ars: 150000, run_id: RUN, observed_at: "2026-11-10T10:45:00-03:00" },
      { store_id: "fravega", external_ref: "/p/fake-aaa111-2", price_ars: 155000, run_id: RUN, observed_at: "2026-11-10T10:45:00-03:00" },
      { store_id: "ml", external_ref: "MLA90000990", price_ars: 100000, run_id: RUN, observed_at: "2026-11-10T10:45:00-03:00" },
      { store_id: "ml", external_ref: "MLA90000991", price_ars: 130000, run_id: RUN, observed_at: "2026-11-10T10:45:00-03:00" },
      { store_id: "ml", external_ref: "MLA90000992", price_ars: 80000, run_id: RUN, observed_at: "2026-11-10T10:45:00-03:00" },
    ]);
  });

  it("saves the observations of an invalidated candidate too", async () => {
    const db = await setupDb();
    await seedCandidate(db, candidate());
    await revalidate(db, okReads(110000));
    const n = await db.all<{ n: number }>("SELECT COUNT(*) AS n FROM price_observations WHERE run_id = ?", [RUN]);
    expect(n[0]!.n).toBe(2);
  });

  it("never changes affiliate_link", async () => {
    const db = await setupDb();
    await seedModel(db, "FAKE:BBB222", "BBB222");
    const link = "https://meli.la/2AbCdEf?x=1&y=%20z";
    const a = candidate();
    const b = candidate({ model: "FAKE:BBB222" });
    await seedCandidate(db, a, { enlace: link });
    await seedCandidate(db, b, { enlace: link });
    const f = fakes({
      offers: { MLA00000099: [offer(100000)] },
      stores: { fravega: { "Fake AAA111": [listing("fravega", "/p/fake-aaa111-1", 140000)], "Fake BBB222": [] } },
    });
    await revalidate(db, f);
    expect((await stateOf(db, a.candidate_id)).affiliate_link).toBe(link);
    expect((await stateOf(db, b.candidate_id))).toMatchObject({ status: "invalidated", affiliate_link: link });
  });

  it("does not overwrite a candidate whose state changed while it was being re-read", async () => {
    const db = await setupDb();
    const c = candidate();
    await seedCandidate(db, c);
    const f = okReads();
    const slow: MlCatalog = {
      ...f.catalog,
      async getOffers(id) {
        await db.run("UPDATE candidates SET status = 'published' WHERE id = ?", [c.candidate_id]);
        return f.catalog.getOffers(id);
      },
    };
    const { report } = await revalidateChosen({ db, catalog: slow, stores: f.stores, config: await config(db), now: () => NOW });
    expect(report).toEqual({ run_date: "2026-11-10", validated: [], invalidated: [] });
    expect((await stateOf(db, c.candidate_id)).status).toBe("published");
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
  mlRedirectUri: "https://imperdibles.com.ar",
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
    [fravegaSearchUrl("aspiradora robot", 1), html(FRAVEGA_NONE)],
    [fravegaSearchUrl("Philco PHRA26N"), html(FRAVEGA_HTML)],
    [searchUrl("Philco PHRA26N"), json(read("ml", "products-search-philco-phra26n-derived.json"))],
    [itemsUrl("MLA00000011"), json(read("ml", "product-items-philco-derived.json"))],
    [searchUrl("Irobot M611330"), json(read("ml", "products-search-irobot-m611330-derived.json"))],
    [itemsUrl("MLA00000012"), json(read("ml", "product-items-irobot-derived.json"))],
    [searchUrl("Smartlife SLRVCL050"), json(read("ml", "product-items-empty-derived.json"))],
    [searchUrl("SL-RVCL050"), json(read("ml", "product-items-empty-derived.json"))],
  ]);
}

type Hooks = LocalOutputHooks & { reports: RevalidationReport[]; alerts: OwnerAlert[] };
function setup(opts: { routes?: Routes; fetchImpl?: typeof fetch } = {}) {
  const sqlite = createSqliteClient();
  sqlite.raw.prepare("INSERT INTO ml_tokens (id, access_token, refresh_token, expires_at) VALUES (1, ?, ?, '2026-11-12T00:00:00.000Z')").run(SECRETS.token, SECRETS.refresh);
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
  await s.sqlite.run("UPDATE candidates SET status = 'chosen', telegram_file_id = 'AgACfile', affiliate_link = 'https://meli.la/abc' WHERE id = ?", [PHILCO]);
  s.fetched.length = 0;
  s.out.length = 0;
  s.clock.now = new Date("2026-11-10T13:45:00Z"); // 10:45 ART
}

describe("imperdibles revalidar", () => {
  it("replays the run: validates the chosen candidate, reports it to the hook and reads only what it needs", async () => {
    const s = setup();
    await collectAndChoose(s);
    const before = await s.sqlite.all<{ n: number }>("SELECT COUNT(*) AS n FROM price_observations");
    expect(await runRevalidate(s.deps)).toBe(0);
    expect(s.hooks.reports).toEqual([{ run_date: "2026-11-10", validated: [PHILCO], invalidated: [] }]);
    expect(s.fetched).toEqual([itemsUrl("MLA00000011"), fravegaSearchUrl("Philco PHRA26N")]);
    const row = await stateOf(s.sqlite, PHILCO);
    expect(row).toMatchObject({ status: "validated", validated_at: "2026-11-10T10:45:00-03:00", telegram_file_id: "AgACfile", affiliate_link: "https://meli.la/abc" });
    const after = await s.sqlite.all<{ n: number }>("SELECT COUNT(*) AS n FROM price_observations");
    expect(after[0]!.n).toBeGreaterThan(before[0]!.n);
    expect(s.out.join("")).toBe("Revalidación 2026-11-10: 1 validados, 0 invalidados.\n");
  });

  it("invalidates offer_missing when the other store no longer lists the product", async () => {
    const s = setup();
    await collectAndChoose(s);
    s.routes.set(fravegaSearchUrl("Philco PHRA26N"), () => new Response(FRAVEGA_NONE, { status: 200 }));
    expect(await runRevalidate(s.deps)).toBe(0);
    expect(s.hooks.reports).toHaveLength(1);
    expect(s.hooks.reports[0]!.invalidated).toMatchObject([{ candidate_id: PHILCO, reason: "offer_missing" }]);
    expect((await stateOf(s.sqlite, PHILCO)).status).toBe("invalidated");
  });

  it("leaves the candidate untouched, logs it, alerts and exits 1 when the other store answers an error", async () => {
    const s = setup();
    await collectAndChoose(s);
    const before = await stateOf(s.sqlite, PHILCO);
    s.routes.set(fravegaSearchUrl("Philco PHRA26N"), () => new Response("nope", { status: 500 }));
    expect(await runRevalidate(s.deps)).toBe(1);
    expect(await stateOf(s.sqlite, PHILCO)).toEqual(before);
    expect(s.hooks.reports).toEqual([{ run_date: "2026-11-10", validated: [], invalidated: [] }]);
    expect(s.hooks.alerts).toHaveLength(1);
    expect(s.hooks.alerts[0]).toMatchObject({ kind: "run_failed", run_id: null });
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
    expect(s.hooks.alerts).toEqual([{ kind: "store_format_error", store: "fravega" }]);
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
    expect(s.hooks.reports).toEqual([{ run_date: "2026-11-10", validated: [], invalidated: [] }]);
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
    expect((await stateOf(s.sqlite, PHILCO)).status).toBe("chosen");
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
    expect(s.hooks.alerts).toMatchObject([{ kind: "run_failed", run_id: null }]);
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
    expect(s.hooks.reports).toEqual([{ run_date: "2026-11-10", validated: [], invalidated: [] }]);
    expect(s.hooks.alerts).toMatchObject([{ kind: "run_failed", run_id: null }]);
    expect(logLine(s.logPath)).toMatchObject({ run_id: null, status: "failed" });
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
