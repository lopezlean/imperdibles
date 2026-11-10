import "dotenv/config";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTokenProvider, MlAuthError } from "../src/data/ml/auth.js";
import { createRecordingFetch } from "../src/data/recording.js";
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

try {
  if (command === "fravega" && arg) await recordFravega(arg);
  else if (command === "ml" && arg) await recordMl(arg);
  else if (command === "run" && arg) {
    console.error("run <categoria>: se completa en la tarea 12.");
    process.exitCode = 1;
  } else {
    console.error('Uso: pnpm fixtures:record ml "<consulta>" | fravega "<términos>" | run <categoría>');
    process.exitCode = 1;
  }
} catch (error) {
  // Variable names and reasons only, never token values.
  console.error(error instanceof MlAuthError ? error.reason : error instanceof Error ? `${error.constructor.name}: ${error.message}` : "error");
  process.exitCode = 1;
}
