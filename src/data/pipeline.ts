import type { Candidate, CandidateList } from "../contract/candidate-list.js";
import type { OwnerAlert } from "../contract/local-hooks.js";
import { artIso } from "../shared/time.js";
import type { Category } from "../shared/config.js";
import { BudgetExhaustedError, UpstreamError } from "./http.js";
import { buildCandidateList, type MatchedGroup } from "./filter.js";
import { cheapestNewOffer, type MlCatalog, type MlOffer, type MlProduct } from "./ml/catalog.js";
import { matchListings, pickCatalogProduct, type Match } from "./matching/match.js";
import { extractModelCodes, normalizeBrand, writtenModelCode } from "./matching/normalize.js";
import type { MatchRow, ModelRow } from "./repo.js";
import { StoreFormatError, type Listing, type StoreAdapter } from "./types.js";

export type PipelineDeps = {
  catalog: MlCatalog;
  /** Every enabled store, in priority order; each is a model source and a rival. */
  stores: StoreAdapter[];
  rejected: (modelId: string) => Promise<Set<string>>;
  now: () => Date;
  log: (event: string, data: Record<string, unknown>) => void;
};

export type PipelineResult = {
  list: CandidateList;
  listings: Listing[];
  models: ModelRow[];
  matches: MatchRow[];
  status: "ok" | "partial";
  skipped: { model_id: string | null; reason: string }[];
  alerts: OwnerAlert[];
};

type ModelEntry = { listing: Listing; brand: string; code: string; model_id: string; byStore: Map<string, Listing[]> };

// One extra ML query when the first has no high match: the store's own spelling of the code if it differs, else the code alone.
function fallbackQuery(listing: Listing, code: string): string {
  const written = writtenModelCode(listing.title, code);
  return written !== null && written.toUpperCase() !== code ? written : code;
}
type Rival = { listing: Listing; rule: "gtin" | "brand_code_variant" };

const rivalKey = (l: Listing) => `${l.store}:${l.external_ref}`;

function mlListing(product: MlProduct, offer: MlOffer, observed_at: string): Listing {
  return {
    store: "ml",
    title: product.title,
    brand: product.brand,
    model: product.model,
    gtin: product.gtin,
    price_ars: offer.price_ars,
    external_ref: offer.item_id,
    url: product.url,
    seller: offer.seller_id,
    item_condition: offer.item_condition,
    observed_at,
  };
}

/** Reads every enabled store, finds each model in the ML catalog, matches rivals and applies the threshold. */
export async function runPipeline(
  deps: PipelineDeps,
  input: { run_id: string; run_date: string; category: Category; threshold_pct: number },
): Promise<PipelineResult> {
  const listings = new Map<string, Listing>();
  const models: ModelRow[] = [];
  const matches: MatchRow[] = [];
  const skipped: PipelineResult["skipped"] = [];
  const alerts: OwnerAlert[] = [];
  const groups: MatchedGroup[] = [];
  const droppedStores = new Set<string>();
  let partial = false;

  const record = (l: Listing) => {
    const key = rivalKey(l);
    if (!listings.has(key)) listings.set(key, l);
  };
  const skip = (model_id: string | null, reason: string) => {
    skipped.push({ model_id, reason });
    deps.log("model_skipped", { model_id, reason });
  };
  const alertStore = (store: string) => {
    if (!alerts.some((a) => a.kind === "store_format_error" && a.store === store)) alerts.push({ kind: "store_format_error", store });
  };

  // 1. Every enabled store: all pages of every term, deduped per store by external_ref.
  const found = new Map<string, Listing>();
  const storeErrors: StoreFormatError[] = [];
  collect: for (const store of deps.stores) {
    try {
      for (const term of input.category.terms) {
        for (const l of await store.search(term)) {
          record(l);
          if (!found.has(rivalKey(l))) found.set(rivalKey(l), l);
        }
      }
    } catch (error) {
      if (error instanceof BudgetExhaustedError) {
        partial = true;
        deps.log("budget_exhausted", { stage: "stores", store: store.id });
        break collect;
      }
      if (!(error instanceof StoreFormatError)) throw error;
      storeErrors.push(error);
      droppedStores.add(store.id);
      partial = true;
      alertStore(store.id);
      deps.log("store_dropped", { store: store.id, reason: error.message });
    }
  }
  // A single broken store (or all of them) leaves nothing to compare: fail the run as before.
  if (storeErrors.length > 0 && droppedStores.size === deps.stores.length) throw storeErrors[0];

  // 2. One entry per model, whatever store lists it: the cheapest listing represents it, every store's listings are kept.
  const entries = new Map<string, ModelEntry>();
  for (const l of found.values()) {
    const code = extractModelCodes(l.title)[0];
    if (code === undefined) {
      skip(null, "no_model_code");
      continue;
    }
    if (l.brand === null || l.brand.trim() === "") {
      skip(null, "no_brand");
      continue;
    }
    const model_id = `${normalizeBrand(l.brand)}:${code}`;
    const current = entries.get(model_id);
    if (current === undefined) {
      entries.set(model_id, { listing: l, brand: l.brand, code, model_id, byStore: new Map([[l.store, [l]]]) });
      continue;
    }
    current.byStore.set(l.store, [...(current.byStore.get(l.store) ?? []), l]);
    if (l.price_ars < current.listing.price_ars) Object.assign(current, { listing: l, brand: l.brand });
  }

  async function processModel(entry: ModelEntry): Promise<void> {
    const { listing, brand, code, model_id, byStore } = entry;
    const term = `${brand} ${code}`;
    const modelRow: ModelRow = {
      id: model_id,
      category: input.category.id,
      brand,
      model_code: code,
      gtin: listing.gtin,
      ml_product_id: null,
      title: listing.title,
      image_url: null,
    };
    const rows: MatchRow[] = [];

    // 3. Catalog product.
    let pick = pickCatalogProduct(listing, await deps.catalog.searchProducts(term));
    if (pick.product === null && pick.reason === "no_high") {
      pick = pickCatalogProduct(listing, await deps.catalog.searchProducts(fallbackQuery(listing, code)));
    }
    if (pick.product === null) {
      models.push(modelRow);
      matches.push({ model_id, store: listing.store, external_ref: listing.external_ref, match: { confidence: "doubtful", rule: "partial", evidence: {}, reason: pick.reason } });
      deps.log("model_unmatched", { model_id, reason: pick.reason });
      return;
    }
    const { product } = pick;
    modelRow.ml_product_id = product.id;
    modelRow.gtin = listing.gtin ?? product.gtin;
    modelRow.image_url = product.image_url;

    // 4. Offers of every condition are recorded; only the cheapest new one prices the model.
    const offers = await deps.catalog.getOffers(product.id);
    const observed_at = artIso(deps.now());
    for (const o of offers) record(mlListing(product, o, observed_at));
    const best = cheapestNewOffer(offers);
    if (best === null) {
      models.push(modelRow);
      skip(model_id, "no_new_offers");
      return;
    }
    const priced: MlProduct = { ...product, price_ars: best.price_ars };
    const rejected = await deps.rejected(model_id);
    const rivals: Rival[] = [];

    // 5. Per store: its own listings of the model, else a per-model search; cheapest high per store.
    for (const store of deps.stores) {
      if (droppedStores.has(store.id)) continue;
      let read = byStore.get(store.id);
      if (read === undefined) {
        try {
          read = await store.search(term);
        } catch (error) {
          if (!(error instanceof StoreFormatError)) throw error;
          droppedStores.add(store.id);
          partial = true;
          alertStore(store.id);
          deps.log("store_dropped", { store: store.id, reason: error.message });
          continue;
        }
      }
      let cheapest: Rival | null = null;
      for (const l of read) {
        record(l);
        if (rejected.has(rivalKey(l))) continue;
        const m = matchListings(priced, l);
        if (m === null) continue;
        rows.push({ model_id, store: l.store, external_ref: l.external_ref, match: m });
        if (m.confidence === "high" && m.rule !== "partial" && (cheapest === null || l.price_ars < cheapest.listing.price_ars)) {
          cheapest = { listing: l, rule: m.rule };
        }
      }
      if (cheapest !== null) rivals.push(cheapest);
    }

    models.push(modelRow);
    matches.push(...rows);
    if (rivals.length === 0) return;
    groups.push({
      model_id,
      brand,
      title: product.title,
      image_url: product.image_url,
      ml: {
        store: "ml",
        listing_title: product.title,
        url: product.url,
        price_ars: best.price_ars,
        observed_at,
        external_ref: best.item_id,
        seller: best.seller_id,
        ml_product_id: product.id,
        ml_seller_id: best.seller_id,
      },
      others: rivals.map((r) => ({
        rule: r.rule,
        offer: {
          store: r.listing.store,
          listing_title: r.listing.title,
          url: r.listing.url,
          price_ars: r.listing.price_ars,
          observed_at: r.listing.observed_at,
          external_ref: r.listing.external_ref,
          seller: r.listing.seller,
        },
      })),
    });
  }

  // Models listed by more stores first (stable: ties keep store and discovery order), so a tight budget goes to the likeliest comparisons.
  const queue = [...entries.values()].sort((x, y) => y.byStore.size - x.byStore.size);
  for (const [i, entry] of queue.entries()) {
    try {
      await processModel(entry);
    } catch (error) {
      if (error instanceof BudgetExhaustedError) {
        partial = true;
        deps.log("budget_exhausted", { stage: "model", model_id: entry.model_id, unprocessed: queue.length - i });
        for (const rest of queue.slice(i)) skip(rest.model_id, "budget_exhausted");
        break;
      }
      if (error instanceof UpstreamError) {
        partial = true;
        skip(entry.model_id, "upstream_error");
      } else if (error instanceof StoreFormatError && error.store === "ml") {
        partial = true;
        alertStore("ml");
        skip(entry.model_id, "ml_format_error");
      } else {
        throw error;
      }
    }
  }

  const list = buildCandidateList({
    run_id: input.run_id,
    run_date: input.run_date,
    category: input.category.id,
    threshold_pct: input.threshold_pct,
    groups,
  });
  return { list, listings: [...listings.values()], models, matches, status: partial ? "partial" : "ok", skipped, alerts };
}

/**
 * The reads revalidation (Task 14) repeats for each candidate: the ML offers and, per rival store,
 * the search by "<brand> <model_code>". Used by the recording script so one recording replays both runs.
 */
export async function revalidationReads(
  deps: { catalog: MlCatalog; stores: StoreAdapter[] },
  result: Pick<PipelineResult, "list" | "models">,
): Promise<void> {
  const codes = new Map(result.models.map((m) => [m.id, m.model_code]));
  for (const c of result.list.candidates) {
    await deps.catalog.getOffers(c.ml.ml_product_id);
    const code = codes.get(c.model_id);
    if (code === undefined) continue;
    for (const store of rivalStores(c, deps.stores)) await store.search(`${c.brand} ${code}`);
  }
}

function rivalStores(c: Candidate, stores: StoreAdapter[]): StoreAdapter[] {
  const ids = new Set(c.others.map((o) => o.store));
  return stores.filter((s) => ids.has(s.id));
}
