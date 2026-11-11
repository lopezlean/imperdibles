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
import { enabledSecondaryStores } from "./stores/index.js";
import { StoreFormatError, type Listing, type StoreAdapter } from "./types.js";

/** A validated candidate older than this is read again. */
const FRESH_MS = 30 * 60 * 1000;

type Reason = RevalidationReport["invalidated"][number]["reason"];
type Row = { id: string; run_id: string; payload: string; status: "chosen" | "validated"; validated_at: string | null; brand: string; model_code: string };
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

/** A candidate left untouched this run because a read failed. `store` is set only when a store's format broke. */
export type Skipped = { candidate_id: string; title: string; reason: string; store: string | null };

export type Revalidation = { report: RevalidationReport; skipped: Skipped[] };

/** Every price a reader of the candidate sees, in display order. A change here makes a cached card stale. */
function shownPrices(c: Candidate): string {
  return JSON.stringify([c.ml.price_ars, ...c.others.map((o) => [o.store, o.price_ars])]);
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
  const run_date = artDate(deps.now());
  const staleBefore = deps.now().getTime() - FRESH_MS;

  const rows = await db.all<Row>(
    `SELECT c.id, c.run_id, c.payload, c.status, c.validated_at, m.brand, m.model_code
     FROM candidates c
     JOIN runs r ON r.id = c.run_id
     JOIN models m ON m.id = c.model_id
     WHERE r.run_date = ? AND c.status IN ('chosen', 'validated')
     ORDER BY c.id`,
    [run_date],
  );
  const due = rows.filter((r) => r.status === "chosen" || r.validated_at === null || Date.parse(r.validated_at) < staleBefore);

  const report: RevalidationReport = { run_date, validated: [], invalidated: [] };
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
          : passesThreshold(next.ml.price_ars, next.others[0]!.price_ars, config.threshold_pct)
            ? { validated: true }
            : { validated: false, reason: "below_threshold" };
      } catch (error) {
        if (!isReadFailure(error)) throw error;
        // Whatever was read before the failure is still a real observation; the candidate itself is not touched.
        await saveObservations(db, row.run_id, observed);
        skipped.push({
          candidate_id: row.id,
          title: stored.title,
          reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          store: error instanceof StoreFormatError ? error.store : null,
        });
        continue;
      }
    }

    await saveObservations(db, row.run_id, observed);
    const stamp = artIso(deps.now());
    let changes: number;
    if (outcome.validated && next !== null && stored !== null) {
      const stale = shownPrices(stored) !== shownPrices(next);
      ({ changes } = await db.run(
        `UPDATE candidates SET status = 'validated', validated_at = ?, payload = ?${stale ? ", telegram_file_id = NULL" : ""}
         WHERE id = ? AND status = ?`,
        [stamp, JSON.stringify(next), row.id, row.status],
      ));
      if (changes > 0) report.validated.push(row.id);
    } else if (!outcome.validated) {
      ({ changes } = await db.run("UPDATE candidates SET status = 'invalidated' WHERE id = ? AND status = ?", [row.id, row.status]));
      if (changes > 0) report.invalidated.push({ candidate_id: row.id, title: stored?.title ?? row.id, reason: outcome.reason });
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

    const term = `${row.brand} ${row.model_code}`;
    const reads = new Map<string, Listing[]>();
    for (const store of new Set(c.others.map((o) => o.store))) {
      const adapter = stores.find((s) => s.id === store);
      if (adapter === undefined) throw new MissingAdapter(`no adapter for store ${store}`);
      const listings = await adapter.search(term);
      observed.push(...listings);
      reads.set(store, listings);
    }

    const survivors = c.others.flatMap((o) => {
      const fresh = reads.get(o.store)?.find((l) => l.external_ref === o.external_ref);
      return fresh === undefined ? [] : [{ ...o, price_ars: fresh.price_ars, observed_at: fresh.observed_at }];
    });
    if (survivors.length === 0) return null;

    const ml = { ...c.ml, price_ars: best.price_ars, observed_at: stamp, external_ref: best.item_id, seller: best.seller_id, ml_seller_id: best.seller_id };
    const result = candidateSchema.safeParse(applyPrices(c, ml, survivors));
    return result.success ? result.data : null;
  }
}

function mlListing(c: Candidate, offer: MlOffer, observed_at: string): Listing {
  return {
    store: "ml",
    title: c.ml.listing_title,
    brand: null,
    model: null,
    gtin: null,
    price_ars: offer.price_ars,
    external_ref: offer.item_id,
    url: c.ml.url,
    seller: offer.seller_id,
    item_condition: offer.item_condition,
    observed_at,
  };
}

/** `imperdibles revalidar`: revalidate, then hand the result to the output side. Exit 0 unless the run itself broke. */
export async function runRevalidate(deps: RunDeps): Promise<number> {
  const { db, hooks } = deps;
  const { holdStoredTokens, scrub } = createScrubber(db, deps.env);
  const run_date = artDate(deps.now());
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
    const detail = scrub(skipped.map((k) => `${k.candidate_id} (${k.reason})`).join("; "));
    deps.stderr(`No se pudo releer ${skipped.length} candidato(s); quedan sin cambios y se reintentan en la próxima revalidación: ${detail}\n`);
    try {
      await appendRunLog(deps.logPath, { run_id: null, run_date, status: "failed", error: `revalidar: sin releer: ${detail}`, at: artIso(deps.now()) });
    } catch (logError) {
      deps.stderr(`No se pudo escribir el registro local: ${scrub(logError instanceof Error ? logError.message : String(logError))}\n`);
    }
    // A broken store format will not fix itself on retry, so it gets its own alert; everything else is one run_failed.
    const formatStores = [...new Set(skipped.flatMap((k) => (k.store === null ? [] : [k.store])))];
    for (const store of formatStores) await notify({ kind: "store_format_error", store });
    const others = skipped.filter((k) => k.store === null);
    if (others.length > 0) {
      const text = scrub(others.map((k) => `${k.candidate_id} (${k.reason})`).join("; "));
      await notify({ kind: "run_failed", run_id: null, reason: `revalidar: sin releer ${others.length} candidato(s), sin cambios: ${text}` });
    }
  };

  try {
    const config = await loadConfig(db);
    const token = createTokenProvider({ db, fetch: trackedFetch, env: deps.env, now: deps.now });
    const http = createBudgetedHttp({ fetch: deps.fetch, budget: config.query_budget, sleep: deps.sleep });
    await holdStoredTokens();
    const { report, skipped } = await revalidateChosen({
      db,
      catalog: createMlCatalog({ http, token }),
      stores: [createFravegaAdapter({ http, now: deps.now, pages: 1 }), ...(await enabledSecondaryStores(db, { http, now: deps.now, pages: 1 }))],
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
      `Revalidación ${report.run_date}: ${report.validated.length} validados, ${report.invalidated.length} invalidados${skipped.length > 0 ? `, ${skipped.length} sin releer` : ""}.\n`,
    );
    return skipped.length > 0 ? 1 : 0;
  } catch (error) {
    await holdStoredTokens();
    const message = scrub(error instanceof Error ? error.message : String(error));
    let alert: OwnerAlert;
    if (error instanceof MlAuthError && !networkDown) alert = { kind: "ml_auth_required" };
    else if (error instanceof MlPermissionError) alert = { kind: "ml_permission_denied", path: error.path };
    else alert = { kind: "run_failed", run_id: null, reason: `revalidar: ${message}` };

    if (networkDown) deps.stderr("Sin conexión: no se pudieron leer los precios. No se publicó nada.\n");
    else if (alert.kind === "ml_auth_required") deps.stderr("Hay que volver a autorizar Mercado Libre: ejecuta pnpm ml:authorize. No se publicó nada.\n");
    else deps.stderr(`La revalidación falló: ${message}\n`);

    try {
      await appendRunLog(deps.logPath, { run_id: null, run_date, status: "failed", error: `revalidar: ${message}`, at: artIso(deps.now()) });
    } catch (logError) {
      deps.stderr(`No se pudo escribir el registro local: ${scrub(logError instanceof Error ? logError.message : String(logError))}\n`);
    }
    await notify(alert);
    return 1;
  }
}
