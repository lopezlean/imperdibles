import type { ListingParse } from "./common.js";
import { createVtexAdapter, parseVtexListing, vtexSearchUrl, type VtexDeps, type VtexStore } from "./vtex.js";

export const EASY: VtexStore = { id: "easy", origin: "https://www.easy.com.ar", name: "Easy" };

export const easySearchUrl = (term: string, page = 0): string => vtexSearchUrl(EASY, term, page);

export const parseEasyListing = (body: string, observedAt: string): ListingParse => parseVtexListing(EASY, body, observedAt);

export const createEasyAdapter = (deps: VtexDeps) => createVtexAdapter(EASY, deps);
