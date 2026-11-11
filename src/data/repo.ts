import type { CandidateList } from "../contract/candidate-list.js";
import type { SqlClient } from "../shared/db/sql-client.js";
import type { Match } from "./matching/match.js";
import type { Listing } from "./types.js";

export type ModelRow = {
  id: string;
  category: string;
  brand: string;
  model_code: string;
  gtin: string | null;
  ml_product_id: string | null;
  title: string;
  image_url: string | null;
};

export type MatchRow = { model_id: string; store: string; external_ref: string; match: Match };

/** Opens a run. It stays 'failed' until finishRun says otherwise. */
export async function startRun(
  db: SqlClient,
  run: { id: string; run_date: string; category: string; started_at: string },
): Promise<void> {
  await db.run(
    "INSERT INTO runs (id, run_date, category, status, started_at) VALUES (?, ?, ?, 'failed', ?)",
    [run.id, run.run_date, run.category, run.started_at],
  );
}

export async function finishRun(
  db: SqlClient,
  id: string,
  r: {
    status: "ok" | "partial" | "failed";
    models_compared: number;
    queries_used: number;
    error: string | null;
    finished_at: string;
  },
): Promise<void> {
  await db.run(
    "UPDATE runs SET status = ?, models_compared = ?, queries_used = ?, error = ?, finished_at = ? WHERE id = ?",
    [r.status, r.models_compared, r.queries_used, r.error, r.finished_at, id],
  );
}

/** Latest finished (ok or partial) run of an ART date; failed or still-open runs never count. */
export async function findRunOfDay(
  db: SqlClient,
  run_date: string,
): Promise<{ id: string; status: "ok" | "partial" } | null> {
  const rows = await db.all<{ id: string; status: "ok" | "partial" }>(
    "SELECT id, status FROM runs WHERE run_date = ? AND status IN ('ok', 'partial') ORDER BY started_at DESC, rowid DESC LIMIT 1",
    [run_date],
  );
  return rows[0] ?? null;
}

/** Every price read is kept: upsert the listing, then append one observation per listing. */
export async function saveObservations(db: SqlClient, runId: string, listings: Listing[]): Promise<void> {
  if (listings.length === 0) return;
  const json = JSON.stringify(
    listings.map((l) => ({
      store: l.store,
      ref: l.external_ref,
      title: l.title,
      url: l.url,
      seller: l.seller,
      item_condition: l.item_condition,
      price: l.price_ars,
      en: l.observed_at,
    })),
  );
  await db.run(
    `INSERT INTO store_listings (store_id, external_ref, title, url, seller, item_condition, first_seen_at, last_seen_at)
     SELECT json_extract(value, '$.store'), json_extract(value, '$.ref'), json_extract(value, '$.title'),
            json_extract(value, '$.url'), json_extract(value, '$.seller'), json_extract(value, '$.item_condition'),
            json_extract(value, '$.en'), json_extract(value, '$.en')
     FROM json_each(?) WHERE true
     ON CONFLICT (store_id, external_ref) DO UPDATE SET
       title = excluded.title, url = excluded.url, seller = excluded.seller,
       item_condition = excluded.item_condition, last_seen_at = excluded.last_seen_at`,
    [json],
  );
  await db.run(
    `INSERT INTO price_observations (listing_id, price_ars, observed_at, run_id)
     SELECT p.id, json_extract(j.value, '$.price'), json_extract(j.value, '$.en'), ?
     FROM json_each(?) j
     JOIN store_listings p
       ON p.store_id = json_extract(j.value, '$.store') AND p.external_ref = json_extract(j.value, '$.ref')`,
    [runId, json],
  );
}

export async function upsertModels(db: SqlClient, models: ModelRow[], now: string): Promise<void> {
  if (models.length === 0) return;
  await db.run(
    `INSERT INTO models (id, category, brand, model_code, model_key, gtin, ml_product_id, title, image_url, created_at)
     SELECT json_extract(value, '$.id'), json_extract(value, '$.category'), json_extract(value, '$.brand'),
            json_extract(value, '$.model_code'), json_extract(value, '$.id'), json_extract(value, '$.gtin'),
            json_extract(value, '$.ml_product_id'), json_extract(value, '$.title'),
            json_extract(value, '$.image_url'), ?
     FROM json_each(?) WHERE true
     ON CONFLICT (id) DO UPDATE SET
       category = excluded.category, brand = excluded.brand, model_code = excluded.model_code,
       gtin = excluded.gtin, ml_product_id = excluded.ml_product_id, title = excluded.title,
       image_url = excluded.image_url`,
    [now, JSON.stringify(models)],
  );
}

/** Pairs are keyed by (model, publicacion); a 'rejected' pair is never touched. */
export async function saveMatches(db: SqlClient, rows: MatchRow[], now: string): Promise<void> {
  if (rows.length === 0) return;
  const json = JSON.stringify(
    rows.map((r) => ({
      model_id: r.model_id,
      store: r.store,
      ref: r.external_ref,
      confidence: r.match.confidence,
      rule: r.match.rule,
      evidence: JSON.stringify(
        r.match.reason === undefined ? r.match.evidence : { ...r.match.evidence, reason: r.match.reason },
      ),
    })),
  );
  await db.run(
    `INSERT INTO matches (model_id, listing_id, confidence, rule, evidence, status, created_at)
     SELECT json_extract(j.value, '$.model_id'), p.id, json_extract(j.value, '$.confidence'),
            json_extract(j.value, '$.rule'), json_extract(j.value, '$.evidence'), 'auto', ?
     FROM json_each(?) j
     JOIN store_listings p
       ON p.store_id = json_extract(j.value, '$.store') AND p.external_ref = json_extract(j.value, '$.ref')
     WHERE true
     ON CONFLICT (model_id, listing_id) DO UPDATE SET
       confidence = excluded.confidence, rule = excluded.rule, evidence = excluded.evidence
     WHERE matches.status <> 'rejected'`,
    [now, json],
  );
}

/** "<store>:<external_ref>" of every listing the owner rejected for this model. */
export async function rejectedRefs(db: SqlClient, modelId: string): Promise<Set<string>> {
  const rows = await db.all<{ store_id: string; external_ref: string }>(
    `SELECT p.store_id, p.external_ref FROM matches e
     JOIN store_listings p ON p.id = e.listing_id
     WHERE e.model_id = ? AND e.status = 'rejected'`,
    [modelId],
  );
  return new Set(rows.map((r) => `${r.store_id}:${r.external_ref}`));
}

/** One statement: every candidate is inserted or none (duplicate id or unknown model fails it whole). */
export async function saveCandidates(db: SqlClient, list: CandidateList): Promise<void> {
  if (list.candidates.length === 0) return;
  await db.run(
    `INSERT INTO candidates (id, run_id, model_id, payload, status)
     SELECT json_extract(value, '$.candidate_id'), ?, json_extract(value, '$.model_id'), json_extract(value, '$'), 'pending'
     FROM json_each(?)`,
    [list.run_id, JSON.stringify(list.candidates)],
  );
}

/** Observations of a listing between two ART dates (YYYY-MM-DD), both inclusive, oldest first. */
export async function priceHistory(
  db: SqlClient,
  listingId: number,
  from: string,
  to: string,
): Promise<{ price_ars: number; observed_at: string; run_id: string }[]> {
  return db.all(
    `SELECT price_ars, observed_at, run_id FROM price_observations
     WHERE listing_id = ? AND substr(observed_at, 1, 10) BETWEEN substr(?, 1, 10) AND substr(?, 1, 10)
     ORDER BY observed_at, id`,
    [listingId, from, to],
  );
}
