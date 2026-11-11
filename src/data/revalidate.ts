import { candidateSchema, type Candidate } from "../contract/candidate-list.js";
import type { OwnerAlert, RevalidationReport } from "../contract/local-hooks.js";
import { appendRunLog } from "../local/run-log.js";
import { loadConfig, type AppConfig } from "../shared/config.js";
import type { SqlClient } from "../shared/db/sql-client.js";
import { artDate, artIso } from "../shared/time.js";
import { applyPrices, passesThreshold } from "./filter.js";
import { BudgetExhaustedError, NetworkError, UpstreamError, createBudgetedHttp } from "./http.js";
import { MlAuthError, createTokenProvider } from "./ml/auth.js";
import { MlPermissionError, cheapestNewOffer, createMlCatalog, type MlCatalog, type MlOffer } from "./ml/catalog.js";
import { saveObservations } from "./repo.js";
import type { RunDeps } from "./run-daily.js";
import { createScrubber } from "./scrub.js";
import { createFravegaAdapter } from "./stores/fravega.js";
import { StoreFormatError, type Listing, type StoreAdapter } from "./types.js";

/** A validated candidate older than this is read again. */
const FRESH_MS = 30 * 60 * 1000;

type Reason = RevalidationReport["invalidated"][number]["reason"];
type Row = { id: string; corrida_id: string; payload: string; estado: "elegido" | "validado"; validado_en: string | null; marca: string; codigo_modelo: string };
type Outcome = { validated: true } | { validated: false; reason: Reason };

/** A read that failed: nothing was decided, so the candidate stays exactly as it is until the next run. */
function isReadFailure(error: unknown): boolean {
  return (
    error instanceof UpstreamError ||
    error instanceof StoreFormatError ||
    error instanceof NetworkError ||
    error instanceof BudgetExhaustedError ||
    error instanceof MissingAdapter
  );
}

class MissingAdapter extends Error {}

/** A candidate left untouched this run because a read failed. `tienda` is set only when a store's format broke. */
export type Skipped = { candidato_id: string; titulo: string; reason: string; tienda: string | null };

export type Revalidation = { report: RevalidationReport; skipped: Skipped[] };

/** Every price a reader of the candidate sees, in display order. A change here makes a cached card stale. */
function shownPrices(c: Candidate): string {
  return JSON.stringify([c.ml.precio_ars, ...c.otras.map((o) => [o.tienda, o.precio_ars])]);
}

/**
 * Reads both prices again for the candidates chosen today (or validated long enough ago) and decides each one.
 * Only a confirmed result invalidates (ML offer gone, every rival listing gone, or below the threshold); a changed
 * price that still passes is rewritten. A failed read, on ML or on any rival, leaves the candidate untouched and
 * skipped: it is never validated on a partial set of rivals and is retried next run.
 * Authorization and database failures stop the run, also leaving candidates untouched.
 */
export async function revalidateChosen(deps: {
  db: SqlClient;
  catalog: MlCatalog;
  stores: StoreAdapter[];
  config: AppConfig;
  now: () => Date;
}): Promise<Revalidation> {
  const { db, catalog, stores, config } = deps;
  const fecha = artDate(deps.now());
  const staleBefore = deps.now().getTime() - FRESH_MS;

  const rows = await db.all<Row>(
    `SELECT c.id, c.corrida_id, c.payload, c.estado, c.validado_en, m.marca, m.codigo_modelo
     FROM candidatos c
     JOIN corridas r ON r.id = c.corrida_id
     JOIN modelos m ON m.id = c.modelo_id
     WHERE r.fecha = ? AND c.estado IN ('elegido', 'validado')
     ORDER BY c.id`,
    [fecha],
  );
  const due = rows.filter((r) => r.estado === "elegido" || r.validado_en === null || Date.parse(r.validado_en) < staleBefore);

  const report: RevalidationReport = { fecha, validated: [], invalidated: [] };
  const skipped: Skipped[] = [];
  for (const row of due) {
    const observed: Listing[] = [];
    let stored: Candidate | null = null;
    let outcome: Outcome;
    let next: Candidate | null = null;
    try {
      stored = candidateSchema.parse(JSON.parse(row.payload));
    } catch {
      stored = null;
    }
    if (stored === null) {
      outcome = { validated: false, reason: "offer_missing" };
    } else {
      try {
        next = await reread(stored, row, observed);
        outcome = next === null
          ? { validated: false, reason: "offer_missing" }
          : passesThreshold(next.ml.precio_ars, next.otras[0]!.precio_ars, config.umbral_pct)
            ? { validated: true }
            : { validated: false, reason: "below_threshold" };
      } catch (error) {
        if (!isReadFailure(error)) throw error;
        // Whatever was read before the failure is still a real observation; the candidate itself is not touched.
        await saveObservations(db, row.corrida_id, observed);
        skipped.push({
          candidato_id: row.id,
          titulo: stored.titulo,
          reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          tienda: error instanceof StoreFormatError ? error.tienda : null,
        });
        continue;
      }
    }

    await saveObservations(db, row.corrida_id, observed);
    const stamp = artIso(deps.now());
    let changes: number;
    if (outcome.validated && next !== null && stored !== null) {
      const stale = shownPrices(stored) !== shownPrices(next);
      ({ changes } = await db.run(
        `UPDATE candidatos SET estado = 'validado', validado_en = ?, payload = ?${stale ? ", telegram_file_id = NULL" : ""}
         WHERE id = ? AND estado = ?`,
        [stamp, JSON.stringify(next), row.id, row.estado],
      ));
      if (changes > 0) report.validated.push(row.id);
    } else if (!outcome.validated) {
      ({ changes } = await db.run("UPDATE candidatos SET estado = 'invalidado' WHERE id = ? AND estado = ?", [row.id, row.estado]));
      if (changes > 0) report.invalidated.push({ candidato_id: row.id, titulo: stored?.titulo ?? row.id, reason: outcome.reason });
    }
  }
  return { report, skipped };

  /** The candidate with fresh prices, or null when the ML offer or every rival is gone. */
  async function reread(c: Candidate, row: Row, observed: Listing[]): Promise<Candidate | null> {
    const stamp = artIso(deps.now());
    const offers = await catalog.getOffers(c.ml.ml_product_id);
    for (const o of offers) observed.push(mlListing(c, o, stamp));
    const best = cheapestNewOffer(offers);
    if (best === null) return null; // confirmed: ML has no new offer, whatever the rivals say

    const term = `${row.marca} ${row.codigo_modelo}`;
    const reads = new Map<string, Listing[]>();
    for (const tienda of new Set(c.otras.map((o) => o.tienda))) {
      const adapter = stores.find((s) => s.id === tienda);
      if (adapter === undefined) throw new MissingAdapter(`no adapter for store ${tienda}`);
      const listings = await adapter.search(term);
      observed.push(...listings);
      reads.set(tienda, listings);
    }

    const survivors = c.otras.flatMap((o) => {
      const fresh = reads.get(o.tienda)?.find((l) => l.ref_externa === o.ref_externa);
      return fresh === undefined ? [] : [{ ...o, precio_ars: fresh.precio_ars, observado_en: fresh.observado_en }];
    });
    if (survivors.length === 0) return null;

    const ml = { ...c.ml, precio_ars: best.precio_ars, observado_en: stamp, ref_externa: best.item_id, vendedor: best.seller_id, ml_seller_id: best.seller_id };
    const result = candidateSchema.safeParse(applyPrices(c, ml, survivors));
    return result.success ? result.data : null;
  }
}

function mlListing(c: Candidate, offer: MlOffer, observado_en: string): Listing {
  return {
    tienda: "ml",
    titulo: c.ml.titulo_listado,
    marca: null,
    modelo: null,
    gtin: null,
    precio_ars: offer.precio_ars,
    ref_externa: offer.item_id,
    url: c.ml.url,
    vendedor: offer.seller_id,
    condicion: offer.condicion,
    observado_en,
  };
}

/** `imperdibles revalidar`: revalidate, then hand the result to the output side. Exit 0 unless the run itself broke. */
export async function runRevalidate(deps: RunDeps): Promise<number> {
  const { db, hooks } = deps;
  const { holdStoredTokens, scrub } = createScrubber(db, deps.env);
  const fecha = artDate(deps.now());
  let networkDown = false;
  const trackedFetch: typeof fetch = async (input, init) => {
    try {
      return await deps.fetch(input, init);
    } catch (error) {
      if (error instanceof TypeError) networkDown = true;
      throw error;
    }
  };
  const notify = async (alert: OwnerAlert): Promise<void> => {
    try {
      await hooks.notifyOwner(alert);
    } catch (error) {
      deps.stderr(`No se pudo avisar al dueño: ${scrub(error instanceof Error ? error.message : String(error))}\n`);
    }
  };

  /** Skipped candidates were left as they were; the owner hears why, and the next run tries again. */
  const reportSkipped = async (skipped: Skipped[]): Promise<void> => {
    const detail = scrub(skipped.map((k) => `${k.candidato_id} (${k.reason})`).join("; "));
    deps.stderr(`No se pudo releer ${skipped.length} candidato(s); quedan sin cambios y se reintentan en la próxima revalidación: ${detail}\n`);
    try {
      await appendRunLog(deps.logPath, { corrida_id: null, fecha, estado: "fallida", error: `revalidar: sin releer: ${detail}`, at: artIso(deps.now()) });
    } catch (logError) {
      deps.stderr(`No se pudo escribir el registro local: ${scrub(logError instanceof Error ? logError.message : String(logError))}\n`);
    }
    // A broken store format will not fix itself on retry, so it gets its own alert; everything else is one run_failed.
    const formatStores = [...new Set(skipped.flatMap((k) => (k.tienda === null ? [] : [k.tienda])))];
    for (const tienda of formatStores) await notify({ kind: "store_format_error", tienda });
    const others = skipped.filter((k) => k.tienda === null);
    if (others.length > 0) {
      const text = scrub(others.map((k) => `${k.candidato_id} (${k.reason})`).join("; "));
      await notify({ kind: "run_failed", corrida_id: null, reason: `revalidar: sin releer ${others.length} candidato(s), sin cambios: ${text}` });
    }
  };

  try {
    const config = await loadConfig(db);
    const token = createTokenProvider({ db, fetch: trackedFetch, env: deps.env, now: deps.now });
    const http = createBudgetedHttp({ fetch: deps.fetch, budget: config.presupuesto_consultas, sleep: deps.sleep });
    await holdStoredTokens();
    const { report, skipped } = await revalidateChosen({
      db,
      catalog: createMlCatalog({ http, token }),
      stores: [createFravegaAdapter({ http, now: deps.now })], // Tasks 16 and 17 add Cetrogar and Musimundo
      config,
      now: deps.now,
    });
    await holdStoredTokens();
    // The skipped candidates are reported even if the hook fails; the hook's own failure is raised afterwards.
    let hookError: unknown = null;
    try {
      await hooks.onRevalidated(report);
    } catch (error) {
      hookError = error;
    }
    if (skipped.length > 0) await reportSkipped(skipped);
    if (hookError !== null) throw hookError;
    deps.stdout(
      `Revalidación ${report.fecha}: ${report.validated.length} validados, ${report.invalidated.length} invalidados${skipped.length > 0 ? `, ${skipped.length} sin releer` : ""}.\n`,
    );
    return skipped.length > 0 ? 1 : 0;
  } catch (error) {
    await holdStoredTokens();
    const message = scrub(error instanceof Error ? error.message : String(error));
    let alert: OwnerAlert;
    if (error instanceof MlAuthError && !networkDown) alert = { kind: "ml_auth_required" };
    else if (error instanceof MlPermissionError) alert = { kind: "ml_permission_denied", path: error.path };
    else alert = { kind: "run_failed", corrida_id: null, reason: `revalidar: ${message}` };

    if (networkDown) deps.stderr("Sin conexión: no se pudieron leer los precios. No se publicó nada.\n");
    else if (alert.kind === "ml_auth_required") deps.stderr("Hay que volver a autorizar Mercado Libre: ejecuta pnpm ml:authorize. No se publicó nada.\n");
    else deps.stderr(`La revalidación falló: ${message}\n`);

    try {
      await appendRunLog(deps.logPath, { corrida_id: null, fecha, estado: "fallida", error: `revalidar: ${message}`, at: artIso(deps.now()) });
    } catch (logError) {
      deps.stderr(`No se pudo escribir el registro local: ${scrub(logError instanceof Error ? logError.message : String(logError))}\n`);
    }
    await notify(alert);
    return 1;
  }
}
