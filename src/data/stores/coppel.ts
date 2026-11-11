import type { ListingParse } from "./common.js";
import { createVtexAdapter, parseVtexListing, vtexSearchUrl, type VtexDeps, type VtexStore } from "./vtex.js";

export const COPPEL: VtexStore = { id: "coppel", origin: "https://www.coppel.com.ar", name: "Coppel" };

export const coppelSearchUrl = (term: string, page = 0): string => vtexSearchUrl(COPPEL, term, page);

export const parseCoppelListing = (body: string, observedAt: string): ListingParse => parseVtexListing(COPPEL, body, observedAt);

export const createCoppelAdapter = (deps: VtexDeps) => createVtexAdapter(COPPEL, deps);
