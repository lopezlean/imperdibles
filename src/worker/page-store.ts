import type { Candidate } from "../contract/candidate-list.js";
import { pctTenths } from "../output/format.js";
import { renderHomePage, type PageInput } from "../output/page/render.js";
import { loadConfig } from "../shared/config.js";
import type { SqlClient } from "../shared/db/sql-client.js";
import { artDate, artIso } from "../shared/time.js";

type Deps = { db: SqlClient; now: () => Date; channelUrl: string };

type Row = {
  id: string;
  modelo_id: string;
  payload: string;
  enlace_afiliado: string;
  categoria: string;
  modelos_comparados: number;
  publicado_en: string | null;
};

const ARCHIVE = "archivo";
const HEADERS = { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" };

const tenthsOf = (c: Candidate) => pctTenths(c.ml.precio_ars, Math.min(...c.otras.map((o) => o.precio_ars)));

/** One item per model (earliest published wins), best percentage first, then title. */
function pickItems(rows: Row[]): PageInput["items"] {
  const byModel = new Map<string, Row>();
  for (const r of rows) {
    const kept = byModel.get(r.modelo_id);
    if (!kept || (r.publicado_en ?? "￿") < (kept.publicado_en ?? "￿")) byModel.set(r.modelo_id, r);
  }
  const items: PageInput["items"] = [];
  for (const r of byModel.values()) {
    try {
      items.push({ candidate: JSON.parse(r.payload) as Candidate, enlace_afiliado: r.enlace_afiliado });
    } catch {
      // A payload that does not parse cannot be shown.
    }
  }
  return items.sort(
    (a, b) => tenthsOf(b.candidate) - tenthsOf(a.candidate) || a.candidate.titulo.localeCompare(b.candidate.titulo, "es"),
  );
}

/** Renders both pages first and writes afterwards, so a render failure leaves the stored pages untouched. */
export async function regeneratePages(deps: Deps): Promise<void> {
  const { db } = deps;
  const config = await loadConfig(db);
  const latest = await db.all<{ fecha: string }>(
    `SELECT r.fecha FROM candidatos c JOIN corridas r ON r.id = c.corrida_id
     WHERE c.estado = 'publicado' AND c.enlace_afiliado IS NOT NULL
     ORDER BY r.fecha DESC LIMIT 1`,
  );
  const fecha = latest[0]?.fecha ?? null;
  const rows =
    fecha === null
      ? []
      : await db.all<Row>(
          `SELECT c.id, c.modelo_id, c.payload, c.enlace_afiliado, r.categoria, r.modelos_comparados, s.publicado_en
           FROM candidatos c JOIN corridas r ON r.id = c.corrida_id
           LEFT JOIN salidas s ON s.candidato_id = c.id AND s.canal = 'telegram_canal'
           WHERE r.fecha = ? AND c.estado = 'publicado' AND c.enlace_afiliado IS NOT NULL
           ORDER BY c.id`,
          [fecha],
        );
  const base = { umbral_pct: config.umbral_pct, channelUrl: deps.channelUrl };
  const generatedAt = artIso(deps.now());

  if (fecha === null || rows.length === 0) {
    const html = renderHomePage({ ...base, mode: "none", fecha: null, categoriaNombre: null, modelos_comparados: 0, items: [] });
    await db.run("INSERT OR REPLACE INTO paginas (clave, html, generada_en) VALUES (?, ?, ?)", [ARCHIVE, html, generatedAt]);
    return;
  }

  const categoriaNombre = config.categorias.find((c) => c.id === rows[0]!.categoria)?.nombre ?? null;
  const data = {
    ...base,
    fecha,
    categoriaNombre,
    modelos_comparados: Math.max(...rows.map((r) => r.modelos_comparados)),
    items: pickItems(rows),
  };
  const today = renderHomePage({ ...data, mode: "today" });
  const archive = renderHomePage({ ...data, mode: "archive" });
  await db.run("INSERT OR REPLACE INTO paginas (clave, html, generada_en) VALUES (?, ?, ?)", [`hoy:${fecha}`, today, generatedAt]);
  await db.run("INSERT OR REPLACE INTO paginas (clave, html, generada_en) VALUES (?, ?, ?)", [ARCHIVE, archive, generatedAt]);
}

const page = (html: string) => new Response(html, { status: 200, headers: HEADERS });

/** Serves today's page, else the archive, else the empty page. One query on the normal path. */
export async function servePage(deps: Deps): Promise<Response> {
  const todayKey = `hoy:${artDate(deps.now())}`;
  const rows = await deps.db.all<{ clave: string; html: string }>(
    "SELECT clave, html FROM paginas WHERE clave IN (?, 'archivo')",
    [todayKey],
  );
  const hit = rows.find((r) => r.clave === todayKey) ?? rows.find((r) => r.clave === ARCHIVE);
  if (hit) return page(hit.html);
  const config = await loadConfig(deps.db);
  return page(
    renderHomePage({
      mode: "none",
      fecha: null,
      categoriaNombre: null,
      umbral_pct: config.umbral_pct,
      modelos_comparados: 0,
      items: [],
      channelUrl: deps.channelUrl,
    }),
  );
}
