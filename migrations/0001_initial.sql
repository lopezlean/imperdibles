-- imperdibles.ar phase 1: initial schema (spec section 4, "Modelo de datos").
-- Prices are integer pesos. Dates are ISO 8601 text.

CREATE TABLE tiendas (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  habilitada INTEGER NOT NULL DEFAULT 1 CHECK (habilitada IN (0, 1))
);

CREATE TABLE modelos (
  id TEXT PRIMARY KEY,
  categoria TEXT NOT NULL,
  marca TEXT NOT NULL,
  codigo_modelo TEXT NOT NULL,
  clave TEXT NOT NULL UNIQUE,
  gtin TEXT,
  ml_product_id TEXT,
  titulo TEXT NOT NULL,
  imagen_url TEXT,
  creado_en TEXT NOT NULL
);

CREATE TABLE publicaciones_tienda (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tienda_id TEXT NOT NULL REFERENCES tiendas (id),
  modelo_id TEXT REFERENCES modelos (id),
  ref_externa TEXT NOT NULL,
  titulo TEXT NOT NULL,
  url TEXT NOT NULL,
  vendedor TEXT,
  condicion TEXT,
  primera_vez TEXT NOT NULL,
  ultima_vez TEXT NOT NULL,
  UNIQUE (tienda_id, ref_externa)
);

CREATE TABLE corridas (
  id TEXT PRIMARY KEY,
  fecha TEXT NOT NULL,
  categoria TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('ok', 'parcial', 'fallida')),
  modelos_comparados INTEGER NOT NULL DEFAULT 0,
  consultas_usadas INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  iniciada_en TEXT NOT NULL,
  terminada_en TEXT
);

CREATE TABLE observaciones_precio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publicacion_id INTEGER NOT NULL REFERENCES publicaciones_tienda (id),
  precio_ars INTEGER NOT NULL,
  observado_en TEXT NOT NULL,
  corrida_id TEXT NOT NULL REFERENCES corridas (id)
);

CREATE TABLE emparejados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  modelo_id TEXT NOT NULL REFERENCES modelos (id),
  publicacion_id INTEGER NOT NULL REFERENCES publicaciones_tienda (id),
  confianza TEXT NOT NULL CHECK (confianza IN ('alta', 'dudosa')),
  regla TEXT NOT NULL,
  evidencia TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('auto', 'rechazado')),
  creado_en TEXT NOT NULL,
  UNIQUE (modelo_id, publicacion_id)
);

CREATE TABLE candidatos (
  id TEXT PRIMARY KEY,
  corrida_id TEXT NOT NULL REFERENCES corridas (id),
  modelo_id TEXT NOT NULL REFERENCES modelos (id),
  payload TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('pendiente', 'elegido', 'validado', 'descartado', 'publicado', 'invalidado')),
  enlace_afiliado TEXT,
  telegram_file_id TEXT,
  telegram_mensaje_id INTEGER,
  validado_en TEXT
);

CREATE TABLE salidas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidato_id TEXT NOT NULL REFERENCES candidatos (id),
  canal TEXT NOT NULL CHECK (canal IN ('telegram_canal', 'x', 'x_manual')),
  mensaje_externo_id TEXT,
  publicado_en TEXT NOT NULL,
  UNIQUE (candidato_id, canal)
);

CREATE TABLE paginas (
  clave TEXT PRIMARY KEY,
  html TEXT NOT NULL,
  generada_en TEXT NOT NULL
);

CREATE TABLE config (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

CREATE TABLE tokens_ml (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expira_en TEXT NOT NULL
);

CREATE INDEX idx_observaciones_publicacion_fecha ON observaciones_precio (publicacion_id, observado_en);
CREATE INDEX idx_candidatos_corrida_estado ON candidatos (corrida_id, estado);
CREATE INDEX idx_corridas_fecha ON corridas (fecha);
