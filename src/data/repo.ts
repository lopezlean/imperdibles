import type { CandidateList } from "../contract/candidate-list.js";
import type { SqlClient } from "../shared/db/sql-client.js";
import type { Match } from "./matching/match.js";
import type { Listing } from "./types.js";

export type ModelRow = {
  id: string;
  categoria: string;
  marca: string;
  codigo_modelo: string;
  gtin: string | null;
  ml_product_id: string | null;
  titulo: string;
  imagen_url: string | null;
};

export type MatchRow = { modelo_id: string; tienda: string; ref_externa: string; match: Match };

/** Opens a run. It stays 'fallida' until finishRun says otherwise. */
export async function startRun(
  db: SqlClient,
  run: { id: string; fecha: string; categoria: string; iniciada_en: string },
): Promise<void> {
  await db.run(
    "INSERT INTO corridas (id, fecha, categoria, estado, iniciada_en) VALUES (?, ?, ?, 'fallida', ?)",
    [run.id, run.fecha, run.categoria, run.iniciada_en],
  );
}

export async function finishRun(
  db: SqlClient,
  id: string,
  r: {
    estado: "ok" | "parcial" | "fallida";
    modelos_comparados: number;
    consultas_usadas: number;
    error: string | null;
    terminada_en: string;
  },
): Promise<void> {
  await db.run(
    "UPDATE corridas SET estado = ?, modelos_comparados = ?, consultas_usadas = ?, error = ?, terminada_en = ? WHERE id = ?",
    [r.estado, r.modelos_comparados, r.consultas_usadas, r.error, r.terminada_en, id],
  );
}

/** Latest finished (ok or parcial) run of an ART date; fallida or still-open runs never count. */
export async function findRunOfDay(
  db: SqlClient,
  fecha: string,
): Promise<{ id: string; estado: "ok" | "parcial" } | null> {
  const rows = await db.all<{ id: string; estado: "ok" | "parcial" }>(
    "SELECT id, estado FROM corridas WHERE fecha = ? AND estado IN ('ok', 'parcial') ORDER BY iniciada_en DESC, rowid DESC LIMIT 1",
    [fecha],
  );
  return rows[0] ?? null;
}

/** Every price read is kept: upsert the listing, then append one observation per listing. */
export async function saveObservations(db: SqlClient, corridaId: string, listings: Listing[]): Promise<void> {
  if (listings.length === 0) return;
  const json = JSON.stringify(
    listings.map((l) => ({
      tienda: l.tienda,
      ref: l.ref_externa,
      titulo: l.titulo,
      url: l.url,
      vendedor: l.vendedor,
      condicion: l.condicion,
      precio: l.precio_ars,
      en: l.observado_en,
    })),
  );
  await db.run(
    `INSERT INTO publicaciones_tienda (tienda_id, ref_externa, titulo, url, vendedor, condicion, primera_vez, ultima_vez)
     SELECT json_extract(value, '$.tienda'), json_extract(value, '$.ref'), json_extract(value, '$.titulo'),
            json_extract(value, '$.url'), json_extract(value, '$.vendedor'), json_extract(value, '$.condicion'),
            json_extract(value, '$.en'), json_extract(value, '$.en')
     FROM json_each(?) WHERE true
     ON CONFLICT (tienda_id, ref_externa) DO UPDATE SET
       titulo = excluded.titulo, url = excluded.url, vendedor = excluded.vendedor,
       condicion = excluded.condicion, ultima_vez = excluded.ultima_vez`,
    [json],
  );
  await db.run(
    `INSERT INTO observaciones_precio (publicacion_id, precio_ars, observado_en, corrida_id)
     SELECT p.id, json_extract(j.value, '$.precio'), json_extract(j.value, '$.en'), ?
     FROM json_each(?) j
     JOIN publicaciones_tienda p
       ON p.tienda_id = json_extract(j.value, '$.tienda') AND p.ref_externa = json_extract(j.value, '$.ref')`,
    [corridaId, json],
  );
}

export async function upsertModels(db: SqlClient, models: ModelRow[], now: string): Promise<void> {
  if (models.length === 0) return;
  await db.run(
    `INSERT INTO modelos (id, categoria, marca, codigo_modelo, clave, gtin, ml_product_id, titulo, imagen_url, creado_en)
     SELECT json_extract(value, '$.id'), json_extract(value, '$.categoria'), json_extract(value, '$.marca'),
            json_extract(value, '$.codigo_modelo'), json_extract(value, '$.id'), json_extract(value, '$.gtin'),
            json_extract(value, '$.ml_product_id'), json_extract(value, '$.titulo'),
            json_extract(value, '$.imagen_url'), ?
     FROM json_each(?) WHERE true
     ON CONFLICT (id) DO UPDATE SET
       categoria = excluded.categoria, marca = excluded.marca, codigo_modelo = excluded.codigo_modelo,
       gtin = excluded.gtin, ml_product_id = excluded.ml_product_id, titulo = excluded.titulo,
       imagen_url = excluded.imagen_url`,
    [now, JSON.stringify(models)],
  );
}

/** Pairs are keyed by (modelo, publicacion); a 'rechazado' pair is never touched. */
export async function saveMatches(db: SqlClient, rows: MatchRow[], now: string): Promise<void> {
  if (rows.length === 0) return;
  const json = JSON.stringify(
    rows.map((r) => ({
      modelo_id: r.modelo_id,
      tienda: r.tienda,
      ref: r.ref_externa,
      confianza: r.match.confianza,
      regla: r.match.regla,
      evidencia: JSON.stringify(
        r.match.motivo === undefined ? r.match.evidencia : { ...r.match.evidencia, motivo: r.match.motivo },
      ),
    })),
  );
  await db.run(
    `INSERT INTO emparejados (modelo_id, publicacion_id, confianza, regla, evidencia, estado, creado_en)
     SELECT json_extract(j.value, '$.modelo_id'), p.id, json_extract(j.value, '$.confianza'),
            json_extract(j.value, '$.regla'), json_extract(j.value, '$.evidencia'), 'auto', ?
     FROM json_each(?) j
     JOIN publicaciones_tienda p
       ON p.tienda_id = json_extract(j.value, '$.tienda') AND p.ref_externa = json_extract(j.value, '$.ref')
     WHERE true
     ON CONFLICT (modelo_id, publicacion_id) DO UPDATE SET
       confianza = excluded.confianza, regla = excluded.regla, evidencia = excluded.evidencia
     WHERE emparejados.estado <> 'rechazado'`,
    [now, json],
  );
}

/** "<tienda>:<ref_externa>" of every listing the owner rejected for this model. */
export async function rejectedRefs(db: SqlClient, modeloId: string): Promise<Set<string>> {
  const rows = await db.all<{ tienda_id: string; ref_externa: string }>(
    `SELECT p.tienda_id, p.ref_externa FROM emparejados e
     JOIN publicaciones_tienda p ON p.id = e.publicacion_id
     WHERE e.modelo_id = ? AND e.estado = 'rechazado'`,
    [modeloId],
  );
  return new Set(rows.map((r) => `${r.tienda_id}:${r.ref_externa}`));
}

/** One statement: every candidate is inserted or none (duplicate id or unknown model fails it whole). */
export async function saveCandidates(db: SqlClient, list: CandidateList): Promise<void> {
  if (list.candidatos.length === 0) return;
  await db.run(
    `INSERT INTO candidatos (id, corrida_id, modelo_id, payload, estado)
     SELECT json_extract(value, '$.candidato_id'), ?, json_extract(value, '$.modelo_id'), json_extract(value, '$'), 'pendiente'
     FROM json_each(?)`,
    [list.corrida_id, JSON.stringify(list.candidatos)],
  );
}

/** Observations of a listing between two ART dates (YYYY-MM-DD), both inclusive, oldest first. */
export async function priceHistory(
  db: SqlClient,
  publicacionId: number,
  from: string,
  to: string,
): Promise<{ precio_ars: number; observado_en: string; corrida_id: string }[]> {
  return db.all(
    `SELECT precio_ars, observado_en, corrida_id FROM observaciones_precio
     WHERE publicacion_id = ? AND substr(observado_en, 1, 10) BETWEEN substr(?, 1, 10) AND substr(?, 1, 10)
     ORDER BY observado_en, id`,
    [publicacionId, from, to],
  );
}
