-- More rival stores read through the VTEX catalog API (docs/verification/data.md V13 to V16). Idempotent: safe to apply twice.
INSERT OR IGNORE INTO stores (id, name, enabled) VALUES
  ('cetrogar', 'Cetrogar', 1),
  ('naldo', 'Naldo', 1),
  ('carrefour', 'Carrefour', 1),
  ('oncity', 'On City', 1);
