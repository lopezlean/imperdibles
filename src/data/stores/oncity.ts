import type { ListingParse } from "./common.js";
import { createVtexAdapter, parseVtexListing, vtexSearchUrl, type VtexDeps, type VtexStore } from "./vtex.js";

export const ONCITY: VtexStore = { id: "oncity", origin: "https://www.oncity.com", name: "On City" };

export const oncitySearchUrl = (term: string, page = 0): string => vtexSearchUrl(ONCITY, term, page);

export const parseOncityListing = (body: string, observedAt: string): ListingParse => parseVtexListing(ONCITY, body, observedAt);

export const createOncityAdapter = (deps: VtexDeps) => createVtexAdapter(ONCITY, deps);
