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
  category: "aspiradoras-robot",
  brand: "Roborock",
  model_code: id.toUpperCase(),
  gtin: null,
  ml_product_id: "MLA1",
  title: "Roborock",
  image_url: null,
});

const listing = (price: number, observed_at: string, ref = "R1", store = "fravega"): Listing => ({
  store,
  title: "Roborock Q7",
  brand: "Roborock",
  model: "Q7",
  gtin: null,
  external_ref: ref,
  url: `https://x.test/${ref}`,
  price_ars: price,
  seller: null,
  item_condition: "nuevo",
  observed_at,
});

async function setup() {
  const db = createSqliteClient();
  await startRun(db, { id: "run1", run_date: "2026-11-10", category: "aspiradoras-robot", started_at: NOW });
  return db;
}

describe("repo", () => {
  it("stores every observation, repeated ones included", async () => {
    const db = await setup();
    await saveObservations(db, "run1", [listing(100, "2026-11-10T06:00:00-03:00")]);
    await saveObservations(db, "run1", [listing(100, "2026-11-10T06:30:00-03:00")]);
    expect((await db.all("SELECT * FROM price_observations")).length).toBe(2);
    const pubs = await db.all<{ first_seen_at: string; last_seen_at: string }>("SELECT * FROM store_listings");
    expect(pubs.length).toBe(1);
    expect(pubs[0]).toMatchObject({ first_seen_at: "2026-11-10T06:00:00-03:00", last_seen_at: "2026-11-10T06:30:00-03:00" });
  });

  it("returns history inside the date range only, ordered by observed_at", async () => {
    const db = await setup();
    await saveObservations(db, "run1", [listing(300, "2026-11-12T06:00:00-03:00")]);
    await saveObservations(db, "run1", [listing(100, "2026-11-08T06:00:00-03:00")]);
    await saveObservations(db, "run1", [listing(200, "2026-11-10T23:30:00-03:00")]);
    await saveObservations(db, "run1", [listing(400, "2026-11-20T06:00:00-03:00")]);
    const id = (await db.all<{ id: number }>("SELECT id FROM store_listings"))[0]!.id;
    const rows = await priceHistory(db, id, "2026-11-08", "2026-11-12");
    expect(rows.map((r) => r.price_ars)).toEqual([100, 200, 300]);
    expect(rows[0]).toEqual({ price_ars: 100, observed_at: "2026-11-08T06:00:00-03:00", run_id: "run1" });
  });

  it("saveCandidates writes all rows or none", async () => {
    const db = await setup();
    await upsertModels(db, [model("m1")], NOW);
    const offer = {
      store: "fravega",
      listing_title: "t",
      url: "https://x.test/1",
      price_ars: 200,
      observed_at: NOW,
      external_ref: "R1",
      seller: null,
    };
    const cand = (id: string, model_id: string) => ({
      candidate_id: id,
      model_id,
      brand: "Roborock",
      title: "t",
      image_url: null,
      ml: { ...offer, store: "ml" as const, ml_product_id: "MLA1", ml_seller_id: "1", price_ars: 100 },
      others: [offer],
      difference_ars: 100,
      difference_pct: 50,
      confidence: "high" as const,
      match_rule: "gtin" as const,
    });
    const list = (cs: ReturnType<typeof cand>[]): CandidateList => ({
      version: 1,
      run_id: "run1",
      run_date: "2026-11-10",
      category: "aspiradoras-robot",
      threshold_pct: 15,
      models_compared: 2,
      candidates: cs,
    });
    await expect(saveCandidates(db, list([cand("c1", "m1"), cand("c1", "m1")]))).rejects.toThrow();
    await expect(saveCandidates(db, list([cand("c1", "m1"), cand("c2", "nope")]))).rejects.toThrow();
    expect((await db.all("SELECT * FROM candidates")).length).toBe(0);

    await saveCandidates(db, list([cand("c1", "m1"), cand("c2", "m1")]));
    const rows = await db.all<{ id: string; status: string; payload: string }>("SELECT * FROM candidates ORDER BY id");
    expect(rows.map((r) => [r.id, r.status])).toEqual([["c1", "pending"], ["c2", "pending"]]);
    expect(JSON.parse(rows[0]!.payload).candidate_id).toBe("c1");
  });

  it("saveMatches never overwrites a rejected pair", async () => {
    const db = await setup();
    await upsertModels(db, [model("m1")], NOW);
    await saveObservations(db, "run1", [listing(100, NOW)]);
    const row = {
      model_id: "m1",
      store: "fravega",
      external_ref: "R1",
      match: { confidence: "high" as const, rule: "gtin" as const, evidence: { gtin: "1" } },
    };
    await saveMatches(db, [row], NOW);
    expect(await rejectedRefs(db, "m1")).toEqual(new Set());
    await db.run("UPDATE matches SET status = 'rejected'");
    await saveMatches(db, [{ ...row, match: { confidence: "doubtful", rule: "partial", evidence: {} } }], NOW);
    const rows = await db.all<{ status: string; confidence: string; rule: string }>("SELECT * FROM matches");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "rejected", confidence: "high", rule: "gtin" });
    expect(await rejectedRefs(db, "m1")).toEqual(new Set(["fravega:R1"]));
  });

  it("saveMatches refreshes an auto pair", async () => {
    const db = await setup();
    await upsertModels(db, [model("m1")], NOW);
    await saveObservations(db, "run1", [listing(100, NOW)]);
    const base = { model_id: "m1", store: "fravega", external_ref: "R1" };
    await saveMatches(db, [{ ...base, match: { confidence: "doubtful", rule: "partial", evidence: {} } }], NOW);
    await saveMatches(db, [{ ...base, match: { confidence: "high", rule: "gtin", evidence: { a: 1 } } }], NOW);
    const rows = await db.all<{ confidence: string; status: string; evidence: string }>("SELECT * FROM matches");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ confidence: "high", status: "auto", evidence: '{"a":1}' });
  });

  it("upsertModels sets model_key equal to id", async () => {
    const db = await setup();
    await upsertModels(db, [model("m1"), model("m2")], NOW);
    await upsertModels(db, [{ ...model("m1"), title: "Nuevo" }], "2026-11-11T06:00:00-03:00");
    const rows = await db.all<{ id: string; model_key: string; title: string; created_at: string }>("SELECT * FROM models ORDER BY id");
    expect(rows.map((r) => [r.id, r.model_key, r.title])).toEqual([["m1", "m1", "Nuevo"], ["m2", "m2", "Roborock"]]);
    expect(rows[0]!.created_at).toBe(NOW);
  });

  it("findRunOfDay ignores runs of other ART dates and runs still failed", async () => {
    const db = createSqliteClient();
    const mk = (id: string, run_date: string, t: string) =>
      startRun(db, { id, run_date, category: "c", started_at: t });
    await mk("other", "2026-11-09", "2026-11-09T06:00:00-03:00");
    await finishRun(db, "other", { status: "ok", models_compared: 1, queries_used: 1, error: null, finished_at: NOW });
    await mk("open", "2026-11-10", "2026-11-10T06:00:00-03:00");
    expect(await findRunOfDay(db, "2026-11-10")).toBeNull();
    await finishRun(db, "open", { status: "failed", models_compared: 0, queries_used: 0, error: "x", finished_at: NOW });
    expect(await findRunOfDay(db, "2026-11-10")).toBeNull();
    await mk("p1", "2026-11-10", "2026-11-10T07:00:00-03:00");
    await finishRun(db, "p1", { status: "partial", models_compared: 1, queries_used: 1, error: null, finished_at: NOW });
    await mk("ok1", "2026-11-10", "2026-11-10T08:00:00-03:00");
    await finishRun(db, "ok1", { status: "ok", models_compared: 1, queries_used: 1, error: null, finished_at: NOW });
    await mk("open2", "2026-11-10", "2026-11-10T09:00:00-03:00");
    expect(await findRunOfDay(db, "2026-11-10")).toEqual({ id: "ok1", status: "ok" });
  });
});
