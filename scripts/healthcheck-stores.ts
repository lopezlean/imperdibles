import { createBudgetedHttp } from "../src/data/http.js";
import { STORE_HEADERS, type ListingParse } from "../src/data/stores/common.js";
import { carrefourSearchUrl, parseCarrefourListing } from "../src/data/stores/carrefour.js";
import { cetrogarSearchUrl, parseCetrogarListing } from "../src/data/stores/cetrogar.js";
import { coppelSearchUrl, parseCoppelListing } from "../src/data/stores/coppel.js";
import { easySearchUrl, parseEasyListing } from "../src/data/stores/easy.js";
import { fravegaSearchUrl, parseFravegaListing } from "../src/data/stores/fravega.js";
import { jumboSearchUrl, parseJumboListing } from "../src/data/stores/jumbo.js";
import { naldoSearchUrl, parseNaldoListing } from "../src/data/stores/naldo.js";
import { oncitySearchUrl, parseOncityListing } from "../src/data/stores/oncity.js";
import { VTEX_HEADERS } from "../src/data/stores/vtex.js";
import { StoreFormatError } from "../src/data/types.js";
import { artIso } from "../src/shared/time.js";

const TERM = "aspiradora robot";

type Store = { id: string; searchUrl: (term: string) => string; parse: (body: string, at: string) => ListingParse; headers: Record<string, string> };
// One request per store: the first page of the search, which is all the format check needs.
const STORES: Store[] = [
  { id: "fravega", searchUrl: fravegaSearchUrl, parse: parseFravegaListing, headers: STORE_HEADERS },
  { id: "jumbo", searchUrl: jumboSearchUrl, parse: parseJumboListing, headers: VTEX_HEADERS },
  { id: "easy", searchUrl: easySearchUrl, parse: parseEasyListing, headers: VTEX_HEADERS },
  { id: "coppel", searchUrl: coppelSearchUrl, parse: parseCoppelListing, headers: VTEX_HEADERS },
  { id: "cetrogar", searchUrl: cetrogarSearchUrl, parse: parseCetrogarListing, headers: VTEX_HEADERS },
  { id: "naldo", searchUrl: naldoSearchUrl, parse: parseNaldoListing, headers: VTEX_HEADERS },
  { id: "carrefour", searchUrl: carrefourSearchUrl, parse: parseCarrefourListing, headers: VTEX_HEADERS },
  { id: "oncity", searchUrl: oncitySearchUrl, parse: parseOncityListing, headers: VTEX_HEADERS },
];

const http = createBudgetedHttp({ fetch, budget: STORES.length, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
let failed = false;

for (const store of STORES) {
  const url = store.searchUrl(TERM);
  try {
    const res = await http.get(url, store.headers);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { listings, rejected } = store.parse(await res.text(), artIso(new Date()));
    const reasons = new Map<string, number>();
    for (const r of rejected) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
    // An empty result is a legitimate zero-hit search (the parser only returns it for the store's no-results marker).
    const detail = [...reasons].map(([reason, n]) => `${reason}: ${n}`).join(", ");
    console.log(`${store.id}: ${listings.length} listings, ${rejected.length} rejected${detail ? ` (${detail})` : ""}`);
  } catch (error) {
    failed = true;
    if (error instanceof StoreFormatError) console.error(`Cambió el formato de ${store.id}`);
    else console.error(`No se pudo consultar ${store.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

process.exit(failed ? 1 : 0);
