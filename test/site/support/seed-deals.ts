import type { SqlClient } from "../../../src/shared/db/sql-client.js";

export type SeedDeal = {
  id: string;
  run_date: string;
  model_id: string;
  runId?: string;
  title?: string;
  ml?: number;
  rival?: number;
  category?: string;
  models_compared?: number;
  publishedAt?: string | null;
  link?: string | null;
  payload?: string;
  status?: string;
};

function payloadFor(id: string, modelId: string, title: string, ml: number, rival: number): string {
  const offer = (store: string, price: number) => ({
    store,
    listing_title: title,
    url: `https://example.test/${store}`,
    price_ars: price,
    observed_at: "2026-11-10T10:00:00-03:00",
    external_ref: `${store}-1`,
    seller: null,
  });
  return JSON.stringify({
    candidate_id: id,
    model_id: modelId,
    brand: "Fake",
    title,
    image_url: null,
    ml: { ...offer("ml", ml), ml_product_id: "MLA1", ml_seller_id: "1" },
    others: [offer("fravega", rival)],
    difference_ars: rival - ml,
    difference_pct: 17.5,
    confidence: "high",
    match_rule: "gtin",
  });
}

/** Seeds one candidate with its run (reused by id), model and optional telegram post. */
export async function seedDeal(db: SqlClient, o: SeedDeal): Promise<void> {
  const category = o.category ?? "aspiradoras-robot";
  const runId = o.runId ?? `run-${o.run_date}-${category}`;
  const started = `${o.run_date}T06:00:00-03:00`;
  await db.run(
    "INSERT OR IGNORE INTO runs (id, run_date, category, status, started_at, models_compared) VALUES (?, ?, ?, 'ok', ?, ?)",
    [runId, o.run_date, category, started, o.models_compared ?? 0],
  );
  await db.run(
    "INSERT OR IGNORE INTO models (id, category, brand, model_code, model_key, title, created_at) VALUES (?, ?, 'Fake', ?, ?, 'Fake', ?)",
    [o.model_id, category, o.model_id, o.model_id, started],
  );
  const link = o.link === undefined ? `https://meli.la/${o.id}` : o.link;
  await db.run(
    "INSERT INTO candidates (id, run_id, model_id, payload, status, affiliate_link, telegram_file_id, validated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      o.id,
      runId,
      o.model_id,
      o.payload ?? payloadFor(o.id, o.model_id, o.title ?? `Robot ${o.id}`, o.ml ?? 329999, o.rival ?? 399999),
      o.status ?? "published",
      link,
      `file-${o.id}`,
      started,
    ],
  );
  if (o.publishedAt) {
    await db.run("INSERT INTO posts (candidate_id, channel, external_message_id, published_at) VALUES (?, 'telegram_channel', '1', ?)", [
      o.id,
      o.publishedAt,
    ]);
  }
}
