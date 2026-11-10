import { createBudgetedHttp } from "../src/data/http.js";
import { STORE_HEADERS, type ListingParse } from "../src/data/stores/common.js";
import { fravegaSearchUrl, parseFravegaListing } from "../src/data/stores/fravega.js";
import { StoreFormatError } from "../src/data/types.js";
import { artIso } from "../src/shared/time.js";

const TERM = "aspiradora robot";

type Store = { id: string; searchUrl: (term: string) => string; parse: (html: string, at: string) => ListingParse };
// Enabled stores; Cetrogar and Musimundo are added with their adapters.
const STORES: Store[] = [{ id: "fravega", searchUrl: fravegaSearchUrl, parse: parseFravegaListing }];

const http = createBudgetedHttp({ fetch, budget: STORES.length, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
let failed = false;

for (const store of STORES) {
  const url = store.searchUrl(TERM);
  try {
    const res = await http.get(url, STORE_HEADERS);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { listings, rejected } = store.parse(await res.text(), artIso(new Date()));
    const reasons = new Map<string, number>();
    for (const r of rejected) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
    const detail = [...reasons].map(([reason, n]) => `${reason}: ${n}`).join(", ");
    console.log(`${store.id}: ${listings.length} listings, ${rejected.length} rejected${detail ? ` (${detail})` : ""}`);
  } catch (error) {
    failed = true;
    if (error instanceof StoreFormatError) console.error(`Cambió el formato de ${store.id}`);
    else console.error(`No se pudo consultar ${store.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

process.exit(failed ? 1 : 0);
