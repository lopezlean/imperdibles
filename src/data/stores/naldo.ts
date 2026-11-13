import type { ListingParse } from "./common.js";
import { createVtexAdapter, parseVtexListing, vtexSearchUrl, type VtexDeps, type VtexStore } from "./vtex.js";

export const NALDO: VtexStore = { id: "naldo", origin: "https://www.naldo.com.ar", name: "Naldo" };

export const naldoSearchUrl = (term: string, page = 0): string => vtexSearchUrl(NALDO, term, page);

export const parseNaldoListing = (body: string, observedAt: string): ListingParse => parseVtexListing(NALDO, body, observedAt);

export const createNaldoAdapter = (deps: VtexDeps) => createVtexAdapter(NALDO, deps);
