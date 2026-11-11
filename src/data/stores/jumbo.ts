import type { ListingParse } from "./common.js";
import { createVtexAdapter, parseVtexListing, vtexSearchUrl, type VtexDeps, type VtexStore } from "./vtex.js";

export const JUMBO: VtexStore = { id: "jumbo", origin: "https://www.jumbo.com.ar", name: "Jumbo" };

export const jumboSearchUrl = (term: string, page = 0): string => vtexSearchUrl(JUMBO, term, page);

export const parseJumboListing = (body: string, observedAt: string): ListingParse => parseVtexListing(JUMBO, body, observedAt);

export const createJumboAdapter = (deps: VtexDeps) => createVtexAdapter(JUMBO, deps);
