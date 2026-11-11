INSERT INTO stores (id, name, enabled) VALUES
  ('ml', 'Mercado Libre', 1),
  ('fravega', 'Frávega', 1);

INSERT INTO config (name, value) VALUES
  ('threshold_pct', '15'),
  ('query_budget', '150'),
  ('collect_time', '06:00'),
  ('notify_time', '07:30'),
  ('revalidate_time', '10:45'),
  ('publish_time', '11:00'),
  ('categories', '[{"id":"aspiradoras-robot","name":"Aspiradoras robot","terms":["aspiradora robot"]}]');
