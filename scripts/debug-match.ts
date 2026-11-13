// Owner-run diagnostic: why does a model end as `no_high`?
// Usage: pnpm tsx scripts/debug-match.ts "<brand> <code>" [--tienda jumbo]   e.g. "xiaomi s40c"
// Reads the first page of one store (--tienda, default fravega) for that term, picks the first first-party listing, then shows for each
// Mercado Libre catalog product the codes and variants the matcher sees and its verdict. Prints no secrets.
import "dotenv/config";
import { createBudgetedHttp } from "../src/data/http.js";
import { createTokenProvider, MlAuthError } from "../src/data/ml/auth.js";
import { createMlCatalog, type MlProduct } from "../src/data/ml/catalog.js";
import { matchListings, pickCatalogProduct } from "../src/data/matching/match.js";
import { extractModelCodes, extractVariants, normalizeBrand, writtenModelCode } from "../src/data/matching/normalize.js";
import { createCarrefourAdapter } from "../src/data/stores/carrefour.js";
import { createCetrogarAdapter } from "../src/data/stores/cetrogar.js";
import { createCoppelAdapter } from "../src/data/stores/coppel.js";
import { createEasyAdapter } from "../src/data/stores/easy.js";
import { createFravegaAdapter } from "../src/data/stores/fravega.js";
import { createJumboAdapter } from "../src/data/stores/jumbo.js";
import { createNaldoAdapter } from "../src/data/stores/naldo.js";
import { createOncityAdapter } from "../src/data/stores/oncity.js";
import type { StoreAdapter } from "../src/data/types.js";
import { storeName } from "../src/output/copy.js";
import { createD1HttpClient } from "../src/shared/db/d1-http-client.js";
import { DATA_ENV_KEYS, loadLocalEnv } from "../src/shared/env.js";

const term = process.argv[2];
const CATEGORY_TERM = "aspiradora robot";
const storeFlag = process.argv.indexOf("--tienda");
const storeId = storeFlag > 0 ? process.argv[storeFlag + 1] ?? "" : "fravega";

type AdapterDeps = { http: Parameters<typeof createFravegaAdapter>[0]["http"]; now: () => Date; pages: number };
const ADAPTERS: Record<string, (deps: AdapterDeps) => StoreAdapter> = {
  fravega: createFravegaAdapter,
  jumbo: createJumboAdapter,
  easy: createEasyAdapter,
  coppel: createCoppelAdapter,
  cetrogar: createCetrogarAdapter,
  naldo: createNaldoAdapter,
  carrefour: createCarrefourAdapter,
  oncity: createOncityAdapter,
};

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
  if (!term || term.startsWith("--") || !Object.hasOwn(ADAPTERS, storeId)) {
    console.error(`Usage: pnpm tsx scripts/debug-match.ts "<brand> <code>" [--tienda ${Object.keys(ADAPTERS).join("|")}]`);
    process.exitCode = 1;
  } else {
    const env = loadLocalEnv(process.env, DATA_ENV_KEYS);
    const db = createD1HttpClient({ accountId: env.cfAccountId, databaseId: env.d1DatabaseId, apiToken: env.cfApiToken });
    const http = createBudgetedHttp({ fetch, budget: 30, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
    const catalog = createMlCatalog({ http, token: createTokenProvider({ db, fetch, env, now: () => new Date() }) });

    const name = storeName(storeId);
    const adapter = ADAPTERS[storeId]!({ http, now: () => new Date(), pages: 1 });
    const categoryAdapter = ADAPTERS[storeId]!({ http, now: () => new Date(), pages: 5 });
    // The daily run searches the category, not the model, so a model it saw may only show up there.
    const wanted = extractModelCodes(term);
    const hasWanted = (l: { title: string }) => wanted.length === 0 || extractModelCodes(l.title).some((c) => wanted.includes(c));
    let store = (await adapter.search(term)).find(hasWanted);
    if (!store && wanted.length > 0) store = (await categoryAdapter.search(CATEGORY_TERM)).find(hasWanted);
    if (!store) {
      console.log(`${name}: no first-party listing for "${term}" (also searched "${CATEGORY_TERM}")`);
    } else {
      const codes = extractModelCodes(store.title);
      console.log(`${name} listing: ${store.title}`);
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
