-- Rival stores read through the VTEX catalog API (docs/verification/data.md). Idempotent: safe to apply twice.
INSERT OR IGNORE INTO stores (id, name, enabled) VALUES
  ('jumbo', 'Jumbo', 1),
  ('easy', 'Easy', 1),
  ('coppel', 'Coppel', 1);
