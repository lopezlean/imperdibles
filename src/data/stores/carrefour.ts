import type { ListingParse } from "./common.js";
import { createVtexAdapter, parseVtexListing, vtexSearchUrl, type VtexDeps, type VtexStore } from "./vtex.js";

export const CARREFOUR: VtexStore = { id: "carrefour", origin: "https://www.carrefour.com.ar", name: "Carrefour" };

export const carrefourSearchUrl = (term: string, page = 0): string => vtexSearchUrl(CARREFOUR, term, page);

export const parseCarrefourListing = (body: string, observedAt: string): ListingParse => parseVtexListing(CARREFOUR, body, observedAt);

export const createCarrefourAdapter = (deps: VtexDeps) => createVtexAdapter(CARREFOUR, deps);
