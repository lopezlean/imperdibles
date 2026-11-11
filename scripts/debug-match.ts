// Owner-run diagnostic: why does a model end as `no_high`?
// Usage: pnpm tsx scripts/debug-match.ts "<brand> <code>"   e.g. "xiaomi s40c"
// Reads the Frávega first page for that term, picks the first first-party listing, then shows for each
// Mercado Libre catalog product the codes and variants the matcher sees and its verdict. Prints no secrets.
import "dotenv/config";
import { createBudgetedHttp } from "../src/data/http.js";
import { createTokenProvider, MlAuthError } from "../src/data/ml/auth.js";
import { createMlCatalog, type MlProduct } from "../src/data/ml/catalog.js";
import { matchListings, pickCatalogProduct } from "../src/data/matching/match.js";
import { extractModelCodes, extractVariants, normalizeBrand, writtenModelCode } from "../src/data/matching/normalize.js";
import { createFravegaAdapter } from "../src/data/stores/fravega.js";
import { createD1HttpClient } from "../src/shared/db/d1-http-client.js";
import { DATA_ENV_KEYS, loadLocalEnv } from "../src/shared/env.js";

const term = process.argv[2];

function describe(p: MlProduct, store: Parameters<typeof matchListings>[1]): string {
  const codes = extractModelCodes(p.model ?? "").length > 0 ? extractModelCodes(p.model ?? "") : extractModelCodes(p.title);
  const m = matchListings(p, store);
  const verdict = m === null ? "no match" : `${m.confidence} (${m.rule}${m.reason ? `, lowered: ${m.reason}` : ""})`;
  return [
    `  ${p.id}  ${p.title}`,
    `    brand=${p.brand ?? "-"} model=${p.model ?? "-"} gtin=${p.gtin ?? "-"}`,
    `    codes=[${codes.join(", ")}] variants=[${[...extractVariants(p.title), ...extractVariants(p.model ?? "")].join(", ")}]`,
    `    verdict: ${verdict}`,
  ].join("\n");
}

try {
  if (!term) {
    console.error('Usage: pnpm tsx scripts/debug-match.ts "<brand> <code>"');
    process.exitCode = 1;
  } else {
    const env = loadLocalEnv(process.env, DATA_ENV_KEYS);
    const db = createD1HttpClient({ accountId: env.cfAccountId, databaseId: env.d1DatabaseId, apiToken: env.cfApiToken });
    const http = createBudgetedHttp({ fetch, budget: 20, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
    const catalog = createMlCatalog({ http, token: createTokenProvider({ db, fetch, env, now: () => new Date() }) });

    const listings = await createFravegaAdapter({ http, now: () => new Date(), pages: 1 }).search(term);
    const store = listings[0];
    if (!store) {
      console.log(`Frávega: no first-party listing for "${term}"`);
    } else {
      const codes = extractModelCodes(store.title);
      console.log(`Frávega listing: ${store.title}`);
      console.log(`  brand=${store.brand ?? "-"} gtin=${store.gtin ?? "-"} price=${store.price_ars ?? "-"}`);
      console.log(`  codes=[${codes.join(", ")}] variants=[${extractVariants(store.title).join(", ")}]`);
      const code = codes[0] ?? "";
      const brand = store.brand ? normalizeBrand(store.brand) : "";
      const written = writtenModelCode(store.title, code);
      const queries = [`${brand} ${code}`.trim(), written && written.toUpperCase() !== code ? written : code];
      for (const q of [...new Set(queries)]) {
        const results = await catalog.searchProducts(q);
        const pick = pickCatalogProduct(store, results);
        console.log(`\nML search "${q}": ${results.length} products -> ${pick.product ? `picked ${pick.product.id}` : pick.reason}`);
        for (const p of results) console.log(describe(p, store));
      }
    }
  }
} catch (error) {
  console.error(
    error instanceof MlAuthError
      ? [error.reason, error.detail].filter(Boolean).join(": ")
      : error instanceof Error
        ? `${error.constructor.name}: ${error.message}`
        : "error",
  );
  process.exitCode = 1;
}
