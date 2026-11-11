import "dotenv/config";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTokenProvider, MlAuthError } from "../src/data/ml/auth.js";
import { BudgetExhaustedError, createBudgetedHttp } from "../src/data/http.js";
import { createMlCatalog } from "../src/data/ml/catalog.js";
import { revalidationReads, runPipeline } from "../src/data/pipeline.js";
import { createRecordingFetch } from "../src/data/recording.js";
import { createFravegaAdapter } from "../src/data/stores/fravega.js";
import { loadConfig } from "../src/shared/config.js";
import { artDate } from "../src/shared/time.js";
import { createD1HttpClient } from "../src/shared/db/d1-http-client.js";
import { DATA_ENV_KEYS, loadLocalEnv } from "../src/shared/env.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "var", "recordings");
const ML_API = "https://api.mercadolibre.com";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const [command, arg] = process.argv.slice(2);

/** One page only: the listing the owner already checked by hand. Needs no credentials. */
async function recordFravega(keyword: string): Promise<void> {
  const dir = join(OUT, "fravega");
  const rec = createRecordingFetch(fetch, dir);
  const url = `https://www.fravega.com/l/?keyword=${encodeURIComponent(keyword)}`;
  const res = await rec(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" } });
  console.log(`fravega: HTTP ${res.status}, recorded under ${dir}`);
  if (!res.ok) process.exitCode = 1;
}

/** Search, then the product and offers of the first result: three calls. */
async function recordMl(query: string): Promise<void> {
  const env = loadLocalEnv(process.env, DATA_ENV_KEYS);
  const db = createD1HttpClient({ accountId: env.cfAccountId, databaseId: env.d1DatabaseId, apiToken: env.cfApiToken });
  const tokens = createTokenProvider({ db, fetch, env, now: () => new Date() });
  const dir = join(OUT, "ml");
  const rec = createRecordingFetch(fetch, dir);
  const call = async (path: string) => {
    const res = await rec(`${ML_API}${path}`, { headers: { Authorization: `Bearer ${await tokens.get()}` } });
    console.log(`ml ${path.split("?")[0]}: HTTP ${res.status}`);
    return res;
  };

  const search = await call(`/products/search?site_id=MLA&status=active&q=${encodeURIComponent(query)}`);
  if (!search.ok) return void (process.exitCode = 1);
  const first = ((await search.json()) as { results?: { id?: string }[] }).results?.[0]?.id;
  if (!first) {
    console.error("ml: the search returned no products");
    process.exitCode = 1;
    return;
  }
  console.log(`ml: first product id ${first}`);
  await call(`/products/${first}`);
  await call(`/products/${first}/items`);
  console.log(`ml: recorded under ${dir}`);
}

/**
 * The whole collection run for one category, recorded under fixtures/runs/<date>-<category>/ with the
 * configured budget, followed by the reads revalidation repeats for each candidate. Needs credentials.
 */
async function recordRun(categoryId: string): Promise<void> {
  const env = loadLocalEnv(process.env, DATA_ENV_KEYS);
  const db = createD1HttpClient({ accountId: env.cfAccountId, databaseId: env.d1DatabaseId, apiToken: env.cfApiToken });
  const config = await loadConfig(db);
  const category = config.categories.find((c) => c.id === categoryId);
  if (!category) {
    console.error(`run: unknown category "${categoryId}" (known: ${config.categories.map((c) => c.id).join(", ")})`);
    process.exitCode = 1;
    return;
  }
  const now = () => new Date();
  const run_date = artDate(now());
  const dir = join(ROOT, "fixtures", "runs", `${run_date}-${category.id}`);
  if (existsSync(dir)) {
    console.error(`run: ${dir} already exists; move or delete it before recording again`);
    process.exitCode = 1;
    return;
  }
  const tokens = createTokenProvider({ db, fetch, env, now });
  const http = createBudgetedHttp({
    fetch: createRecordingFetch(fetch, dir),
    budget: config.query_budget,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  const catalog = createMlCatalog({ http, token: tokens });
  const primary = createFravegaAdapter({
    http,
    now,
    onRejected: (store, rejected) => console.log(`run: seller_rejected ${store} count=${rejected.length}`),
  });
  const result = await runPipeline(
    {
      catalog,
      primary,
      secondary: [],
      rejected: async () => new Set(), // recordings must not depend on the state of the database
      now,
      log: (event, data) => console.log(`run: ${event} ${JSON.stringify(data)}`),
    },
    { run_id: `rec-${run_date}`, run_date, category, threshold_pct: config.threshold_pct },
  );
  console.log(`run: estado ${result.status}, comparados ${result.list.models_compared}, candidatos ${result.list.candidates.length}, consultas ${http.used()}`);
  try {
    await revalidationReads({ catalog, stores: [primary] }, result);
  } catch (error) {
    if (!(error instanceof BudgetExhaustedError)) throw error;
    console.error("run: budget exhausted during the revalidation reads; the recording is incomplete for those candidates");
    process.exitCode = 1;
  }
  console.log(`run: recorded under ${dir} (${http.used()} requests); now check: rg -il "bearer|access_token" fixtures/runs`);
}

try {
  if (command === "fravega" && arg) await recordFravega(arg);
  else if (command === "ml" && arg) await recordMl(arg);
  else if (command === "run" && arg) await recordRun(arg);
  else {
    console.error('Uso: pnpm fixtures:record ml "<consulta>" | fravega "<términos>" | run <categoría>');
    process.exitCode = 1;
  }
} catch (error) {
  // Variable names and reasons only, never token values.
  console.error(error instanceof MlAuthError ? [error.reason, error.detail].filter(Boolean).join(": ") : error instanceof Error ? `${error.constructor.name}: ${error.message}` : "error");
  process.exitCode = 1;
}
