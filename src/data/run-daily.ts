import type { LocalOutputHooks, OwnerAlert } from "../contract/local-hooks.js";
import { appendRunLog } from "../local/run-log.js";
import { loadConfig } from "../shared/config.js";
import { D1Unavailable, type SqlClient } from "../shared/db/sql-client.js";
import type { LocalEnv } from "../shared/env.js";
import { artDate, artIso } from "../shared/time.js";
import { NetworkError, createBudgetedHttp, type BudgetedHttp } from "./http.js";
import { MlAuthError, createTokenProvider } from "./ml/auth.js";
import { MlPermissionError, createMlCatalog } from "./ml/catalog.js";
import { categoryOfDay } from "./category.js";
import { runPipeline } from "./pipeline.js";
import { runRevalidate } from "./revalidate.js";
import { createScrubber } from "./scrub.js";
import {
  findRunOfDay,
  finishRun,
  rejectedRefs,
  saveCandidates,
  saveMatches,
  saveObservations,
  startRun,
  upsertModels,
} from "./repo.js";
import { createFravegaAdapter } from "./stores/fravega.js";
import { StoreFormatError } from "./types.js";

export type RunDeps = {
  db: SqlClient;
  fetch: typeof fetch;
  env: LocalEnv;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  hooks: LocalOutputHooks;
  logPath: string;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

export const USAGE = `Uso:
  imperdibles correr [--forzar]   Corre la recolección del día y guarda los candidatos.
  imperdibles revalidar           Vuelve a leer los precios de los candidatos elegidos antes de publicar.
  imperdibles --help              Muestra esta ayuda.
`;

/** A write that failed because D1 was unreachable is attempted once more; nothing else is repeated. */
async function retryOnce<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (!(error instanceof D1Unavailable)) throw error;
    return write();
  }
}

export async function runDaily(deps: RunDeps, opts: { force: boolean }): Promise<{ exitCode: number; corrida_id: string | null }> {
  const { db, hooks } = deps;
  const fecha = artDate(deps.now());
  let corrida_id: string | null = null;
  let started = false;
  let persistedEstado: "ok" | "parcial" | null = null;
  let http: BudgetedHttp | null = null;
  let networkDown = false;

  // Only used for the token refresh, to tell "offline" apart from "authorization revoked".
  const trackedFetch: typeof fetch = async (input, init) => {
    try {
      return await deps.fetch(input, init);
    } catch (error) {
      if (error instanceof TypeError) networkDown = true;
      throw error;
    }
  };
  const { holdStoredTokens, scrub } = createScrubber(db, deps.env);
  const notify = async (alert: OwnerAlert): Promise<void> => {
    try {
      await hooks.notifyOwner(alert);
    } catch (error) {
      deps.stderr(`No se pudo avisar al dueño: ${scrub(error instanceof Error ? error.message : String(error))}\n`);
    }
  };

  try {
    const existing = await findRunOfDay(db, fecha);
    if (existing !== null && !opts.force) {
      deps.stdout(`Ya hay una corrida de hoy (${existing.id}). Para repetirla: imperdibles correr --forzar\n`);
      return { exitCode: 2, corrida_id: null };
    }

    const token = createTokenProvider({ db, fetch: trackedFetch, env: deps.env, now: deps.now });
    await token.get();
    await holdStoredTokens();
    const config = await loadConfig(db);
    const category = categoryOfDay(config.categorias, fecha);

    const startedAt = deps.now();
    corrida_id = `${fecha}-${category.id}-${artIso(startedAt).slice(11, 19).replaceAll(":", "")}`;
    await startRun(db, { id: corrida_id, fecha, categoria: category.id, iniciada_en: artIso(startedAt) });
    started = true;

    http = createBudgetedHttp({ fetch: deps.fetch, budget: config.presupuesto_consultas, sleep: deps.sleep });
    const result = await runPipeline(
      {
        catalog: createMlCatalog({ http, token }),
        primary: createFravegaAdapter({
          http,
          now: deps.now,
          onRejected: (tienda, rejected) => deps.stderr(`[seller_rejected] ${JSON.stringify({ tienda, count: rejected.length })}\n`),
        }),
        secondary: [], // Tasks 16 and 17 add Cetrogar and Musimundo
        rejected: (modeloId) => rejectedRefs(db, modeloId),
        now: deps.now,
        log: (event, data) => deps.stderr(`[${event}] ${JSON.stringify(data)}\n`),
      },
      { corrida_id, fecha, category, umbral_pct: config.umbral_pct },
    );

    // Each write is retried alone; observations go in before matches, which join on them.
    const runId = corrida_id;
    const stamp = artIso(deps.now());
    await retryOnce(() => upsertModels(db, result.models, stamp));
    await retryOnce(() => saveObservations(db, runId, result.listings));
    await retryOnce(() => saveMatches(db, result.matches, stamp));
    await retryOnce(() => saveCandidates(db, result.list));
    await retryOnce(() =>
      finishRun(db, runId, {
        estado: result.estado,
        modelos_comparados: result.list.modelos_comparados,
        consultas_usadas: http!.used(),
        error: null,
        terminada_en: artIso(deps.now()),
      }),
    );
    persistedEstado = result.estado;

    for (const alert of result.alerts) await notify(alert);
    if (result.estado === "parcial") {
      const reasons = [...new Set(result.skipped.map((s) => s.reason))];
      await notify({ kind: "run_partial", corrida_id: runId, skipped_models: result.skipped.length, reason: reasons.join(", ") || "partial_run" });
    }
    await hooks.onCandidatesReady(result.list);

    await appendRunLog(deps.logPath, { corrida_id: runId, fecha, estado: result.estado, error: null, at: artIso(deps.now()) });
    deps.stdout(
      `Corrida ${runId}: ${result.list.modelos_comparados} modelos comparados, ${result.list.candidatos.length} candidatos${result.estado === "parcial" ? " (parcial)" : ""}.\n`,
    );
    return { exitCode: 0, corrida_id: runId };
  } catch (error) {
    await holdStoredTokens();
    const message = scrub(error instanceof Error ? error.message : String(error));
    const offline = networkDown || error instanceof NetworkError;

    let alert: OwnerAlert;
    if (error instanceof MlAuthError && !networkDown) alert = { kind: "ml_auth_required" };
    else if (error instanceof MlPermissionError) alert = { kind: "ml_permission_denied", path: error.path };
    else if (error instanceof StoreFormatError) alert = { kind: "store_format_error", tienda: error.tienda };
    else alert = { kind: "run_failed", corrida_id, reason: message };

    if (offline) deps.stderr("Sin conexión: no se pudieron leer los precios. No se publicó nada.\n");
    else if (alert.kind === "ml_auth_required") deps.stderr("Hay que volver a autorizar Mercado Libre: ejecuta pnpm ml:authorize. No se publicó nada.\n");
    else deps.stderr(`La corrida falló: ${message}\n`);

    // Once the run is stored its state stays; otherwise it is closed as fallida if D1 still answers.
    if (started && persistedEstado === null && corrida_id !== null) {
      const runId = corrida_id;
      try {
        await finishRun(db, runId, {
          estado: "fallida",
          modelos_comparados: 0,
          consultas_usadas: http?.used() ?? 0,
          error: message,
          terminada_en: artIso(deps.now()),
        });
      } catch {
        // D1 unreachable: the local run log below is the record.
      }
    }
    try {
      await appendRunLog(deps.logPath, { corrida_id, fecha, estado: persistedEstado ?? "fallida", error: message, at: artIso(deps.now()) });
    } catch (logError) {
      deps.stderr(`No se pudo escribir el registro local: ${scrub(logError instanceof Error ? logError.message : String(logError))}\n`);
    }
    await notify(alert);
    return { exitCode: 1, corrida_id };
  }
}

export type Command = { name: "correr"; force: boolean } | { name: "revalidar" } | { name: "help" };

/** The one place that decides what argv means; `cli.ts` uses it to skip the environment for help and unknown input. */
export function parseCommand(argv: string[]): Command | null {
  const [command, ...flags] = argv;
  if (command === "--help" || command === "-h") return { name: "help" };
  if (command === "correr" && flags.every((f) => f === "--forzar")) return { name: "correr", force: flags.includes("--forzar") };
  if (command === "revalidar" && flags.length === 0) return { name: "revalidar" };
  return null;
}

export async function main(argv: string[], deps: RunDeps): Promise<number> {
  const command = parseCommand(argv);
  if (command?.name === "help") {
    deps.stdout(USAGE);
    return 0;
  }
  if (command?.name === "correr") return (await runDaily(deps, { force: command.force })).exitCode;
  if (command?.name === "revalidar") return runRevalidate(deps);
  deps.stderr(USAGE);
  return 2;
}
