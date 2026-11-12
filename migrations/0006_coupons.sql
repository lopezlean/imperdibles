-- Daily coupons: published coupons and the per-post extraction attempts.
-- Apply by hand (pnpm db:migrate:remote).
CREATE TABLE coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('amount', 'percent')),
  discount_value INTEGER NOT NULL CHECK (discount_value > 0),
  min_purchase INTEGER,
  cap INTEGER,
  scope TEXT NOT NULL DEFAULT '',
  valid_from TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'published', 'removed')),
  source_message_id INTEGER NOT NULL,
  source_text TEXT NOT NULL,
  channel_message_id INTEGER,
  owner_message_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source_message_id, code)
);

CREATE INDEX idx_coupons_code_valid_until ON coupons (code, valid_until);
CREATE INDEX idx_coupons_status_valid_until ON coupons (status, valid_until);
CREATE INDEX idx_coupons_owner_message ON coupons (owner_message_id);

CREATE TABLE coupon_posts (
  source_message_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('failed', 'done', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TEXT NOT NULL
);
