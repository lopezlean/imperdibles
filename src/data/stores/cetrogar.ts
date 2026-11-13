import type { ListingParse } from "./common.js";
import { createVtexAdapter, parseVtexListing, vtexSearchUrl, type VtexDeps, type VtexStore } from "./vtex.js";

export const CETROGAR: VtexStore = { id: "cetrogar", origin: "https://www.cetrogar.com.ar", name: "Cetrogar" };

export const cetrogarSearchUrl = (term: string, page = 0): string => vtexSearchUrl(CETROGAR, term, page);

export const parseCetrogarListing = (body: string, observedAt: string): ListingParse => parseVtexListing(CETROGAR, body, observedAt);

export const createCetrogarAdapter = (deps: VtexDeps) => createVtexAdapter(CETROGAR, deps);
