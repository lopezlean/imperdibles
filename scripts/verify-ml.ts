import "dotenv/config";
import { createTokenProvider, MlAuthError } from "../src/data/ml/auth.js";
import { createD1HttpClient } from "../src/shared/db/d1-http-client.js";
import { DATA_ENV_KEYS, loadLocalEnv } from "../src/shared/env.js";

const ML_API = "https://api.mercadolibre.com";
const LIST_PRICE_FIELDS = ["original_price", "regular_amount", "base_price"];
const args = process.argv.slice(2);
const refreshMode = args.includes("--refresh");
const query = args.find((a) => !a.startsWith("--"));

function fieldNames(value: unknown, into = new Set<string>(), prefix = ""): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => fieldNames(v, into, prefix));
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      into.add(prefix + k);
      fieldNames(v, into, `${prefix}${k}.`);
    }
  }
  return into;
}

try {
  const env = loadLocalEnv(process.env, DATA_ENV_KEYS);
  const db = createD1HttpClient({ accountId: env.cfAccountId, databaseId: env.d1DatabaseId, apiToken: env.cfApiToken });
  const tokens = createTokenProvider({ db, fetch, env, now: () => new Date() });

  if (refreshMode) {
    const read = async () =>
      (await db.all<{ refresh_token: string }>("SELECT refresh_token FROM ml_tokens WHERE id = 1"))[0]?.refresh_token;
    const before = await read();
    await tokens.forceRefresh();
    const after = await read();
    console.log(`refresh_token changed after refresh: ${before !== after ? "yes" : "no"}`);
  } else if (query) {
    const token = await tokens.get();
    const get = async (path: string) => {
      const res = await fetch(`${ML_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      const limitHeaders = [...res.headers].filter(([n]) => /ratelimit|retry/i.test(n)).map(([n, v]) => `${n}: ${v}`);
      console.log(`GET ${path.split("?")[0]} -> HTTP ${res.status}`);
      console.log(`  headers ratelimit/retry: ${limitHeaders.length ? limitHeaders.join("; ") : "none"}`);
      if (!res.ok) {
        // Mercado Libre error bodies carry only an error code and message, no credentials.
        console.log(`  body: ${(await res.text()).slice(0, 300)}`);
        return undefined;
      }
      return (await res.json()) as unknown;
    };
    const search = (await get(`/products/search?site_id=MLA&status=active&q=${encodeURIComponent(query)}`)) as
      | { results?: { id?: string }[] }
      | undefined;
    // Catalog search relevance is poor and many products have no active offers (404 on /items),
    // so try the first few results until one returns offers.
    const ids = (search?.results ?? []).map((r) => r.id).filter((id): id is string => typeof id === "string").slice(0, 5);
    let list: unknown[] = [];
    for (const id of ids) {
      await get(`/products/${id}`);
      const items = (await get(`/products/${id}/items`)) as { results?: unknown[] } | unknown[] | undefined;
      list = Array.isArray(items) ? items : (items?.results ?? []);
      if (list.length > 0) {
        console.log(`using product ${id}`);
        break;
      }
    }
    if (ids.length === 0) {
      console.error("no product found, nothing else to check");
      process.exitCode = 1;
    } else {
      const names = fieldNames(list);
      console.log(`offer count: ${list.length}`);
      console.log(`offer fields: ${[...names].sort().join(", ") || "none"}`);
      for (const f of LIST_PRICE_FIELDS) console.log(`  ${f}: ${[...names].some((n) => n.split(".").pop() === f) ? "present" : "absent"}`);
    }
  } else {
    console.error('Uso: pnpm verify:ml "<consulta>" | pnpm verify:ml --refresh');
    process.exitCode = 1;
  }
} catch (error) {
  // Only the reason or the variable names are printed, never token values.
  console.error(error instanceof MlAuthError ? [error.reason, error.detail].filter(Boolean).join(": ") : error instanceof Error ? `${error.constructor.name}: ${error.message}` : "error");
  process.exitCode = 1;
}
