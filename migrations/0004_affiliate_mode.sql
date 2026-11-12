-- Automatic affiliate mode. 'manual' (default): the owner replies with a meli.la link.
-- 'auto': the link is built from the product URL using affiliate_word and affiliate_tool,
-- which stay empty here and are set by the owner on the remote database.
INSERT OR IGNORE INTO config (name, value) VALUES
  ('affiliate_mode', 'manual'),
  ('affiliate_word', ''),
  ('affiliate_tool', '');
