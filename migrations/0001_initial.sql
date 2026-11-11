-- imperdibles.ar phase 1: initial schema (spec section 4, "Modelo de datos").
-- Prices are integer pesos. Dates are ISO 8601 text.

CREATE TABLE stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);

CREATE TABLE models (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  brand TEXT NOT NULL,
  model_code TEXT NOT NULL,
  model_key TEXT NOT NULL UNIQUE,
  gtin TEXT,
  ml_product_id TEXT,
  title TEXT NOT NULL,
  image_url TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE store_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id TEXT NOT NULL REFERENCES stores (id),
  model_id TEXT REFERENCES models (id),
  external_ref TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  seller TEXT,
  item_condition TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (store_id, external_ref)
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  run_date TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'partial', 'failed')),
  models_compared INTEGER NOT NULL DEFAULT 0,
  queries_used INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE price_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES store_listings (id),
  price_ars INTEGER NOT NULL,
  observed_at TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs (id)
);

CREATE TABLE matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id TEXT NOT NULL REFERENCES models (id),
  listing_id INTEGER NOT NULL REFERENCES store_listings (id),
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'doubtful')),
  rule TEXT NOT NULL,
  evidence TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('auto', 'rejected')),
  created_at TEXT NOT NULL,
  UNIQUE (model_id, listing_id)
);

CREATE TABLE candidates (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs (id),
  model_id TEXT NOT NULL REFERENCES models (id),
  payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'chosen', 'validated', 'discarded', 'published', 'invalidated')),
  affiliate_link TEXT,
  telegram_file_id TEXT,
  telegram_message_id INTEGER,
  validated_at TEXT
);

CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id TEXT NOT NULL REFERENCES candidates (id),
  channel TEXT NOT NULL CHECK (channel IN ('telegram_channel', 'x', 'x_manual')),
  external_message_id TEXT,
  published_at TEXT NOT NULL,
  UNIQUE (candidate_id, channel)
);

CREATE TABLE pages (
  page_key TEXT PRIMARY KEY,
  html TEXT NOT NULL,
  generated_at TEXT NOT NULL
);

CREATE TABLE config (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE ml_tokens (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_price_observations_listing_observed ON price_observations (listing_id, observed_at);
CREATE INDEX idx_candidates_run_status ON candidates (run_id, status);
CREATE INDEX idx_runs_run_date ON runs (run_date);
