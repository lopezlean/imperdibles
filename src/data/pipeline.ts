import type { Candidate, CandidateList } from "../contract/candidate-list.js";
import type { OwnerAlert } from "../contract/local-hooks.js";
import { artIso } from "../shared/time.js";
import type { Category } from "../shared/config.js";
import { BudgetExhaustedError, UpstreamError } from "./http.js";
import { buildCandidateList, type MatchedGroup } from "./filter.js";
import { cheapestNewOffer, type MlCatalog, type MlOffer, type MlProduct } from "./ml/catalog.js";
import { matchListings, pickCatalogProduct, type Match } from "./matching/match.js";
import { extractModelCodes, normalizeBrand } from "./matching/normalize.js";
import type { MatchRow, ModelRow } from "./repo.js";
import { StoreFormatError, type Listing, type StoreAdapter } from "./types.js";

export type PipelineDeps = {
  catalog: MlCatalog;
  primary: StoreAdapter;
  secondary: StoreAdapter[];
  rejected: (modeloId: string) => Promise<Set<string>>;
  now: () => Date;
  log: (event: string, data: Record<string, unknown>) => void;
};

export type PipelineResult = {
  list: CandidateList;
  listings: Listing[];
  models: ModelRow[];
  matches: MatchRow[];
  estado: "ok" | "parcial";
  skipped: { modelo_id: string | null; reason: string }[];
  alerts: OwnerAlert[];
};

type PrimaryEntry = { listing: Listing; marca: string; code: string; modelo_id: string };
type Rival = { listing: Listing; regla: "gtin" | "marca_codigo_variante" };

const rivalKey = (l: Listing) => `${l.tienda}:${l.ref_externa}`;

function mlListing(product: MlProduct, offer: MlOffer, observado_en: string): Listing {
  return {
    tienda: "ml",
    titulo: product.titulo,
    marca: product.marca,
    modelo: product.modelo,
    gtin: product.gtin,
    precio_ars: offer.precio_ars,
    ref_externa: offer.item_id,
    url: product.url,
    vendedor: offer.seller_id,
    condicion: offer.condicion,
    observado_en,
  };
}

/** Reads the primary store, finds each model in the ML catalog, matches rivals and applies the threshold. */
export async function runPipeline(
  deps: PipelineDeps,
  input: { corrida_id: string; fecha: string; category: Category; umbral_pct: number },
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
  const skip = (modelo_id: string | null, reason: string) => {
    skipped.push({ modelo_id, reason });
    deps.log("model_skipped", { modelo_id, reason });
  };
  const alertStore = (tienda: string) => {
    if (!alerts.some((a) => a.kind === "store_format_error" && a.tienda === tienda)) alerts.push({ kind: "store_format_error", tienda });
  };

  // 1. Primary store: first page of every term, deduped by ref_externa.
  const found = new Map<string, Listing>();
  try {
    for (const term of input.category.terminos) {
      for (const l of await deps.primary.search(term)) {
        record(l);
        if (!found.has(l.ref_externa)) found.set(l.ref_externa, l);
      }
    }
  } catch (error) {
    if (!(error instanceof BudgetExhaustedError)) throw error;
    partial = true;
    deps.log("budget_exhausted", { stage: "primary" });
  }

  // 2. One entry per model: the cheapest primary listing.
  const entries = new Map<string, PrimaryEntry>();
  for (const l of found.values()) {
    const code = extractModelCodes(l.titulo)[0];
    if (code === undefined) {
      skip(null, "no_model_code");
      continue;
    }
    if (l.marca === null || l.marca.trim() === "") {
      skip(null, "no_brand");
      continue;
    }
    const modelo_id = `${normalizeBrand(l.marca)}:${code}`;
    const current = entries.get(modelo_id);
    if (current === undefined || l.precio_ars < current.listing.precio_ars) entries.set(modelo_id, { listing: l, marca: l.marca, code, modelo_id });
  }

  async function processModel(entry: PrimaryEntry): Promise<void> {
    const { listing, marca, code, modelo_id } = entry;
    const term = `${marca} ${code}`;
    const modelRow: ModelRow = {
      id: modelo_id,
      categoria: input.category.id,
      marca,
      codigo_modelo: code,
      gtin: listing.gtin,
      ml_product_id: null,
      titulo: listing.titulo,
      imagen_url: null,
    };
    const rows: MatchRow[] = [];

    // 3. Catalog product.
    const pick = pickCatalogProduct(listing, await deps.catalog.searchProducts(term));
    if (pick.product === null) {
      models.push(modelRow);
      matches.push({ modelo_id, tienda: listing.tienda, ref_externa: listing.ref_externa, match: { confianza: "dudosa", regla: "parcial", evidencia: {}, motivo: pick.reason } });
      deps.log("model_unmatched", { modelo_id, reason: pick.reason });
      return;
    }
    const { product } = pick;
    modelRow.ml_product_id = product.id;
    modelRow.gtin = listing.gtin ?? product.gtin;
    modelRow.imagen_url = product.imagen_url;

    // 4. Offers of every condition are recorded; only the cheapest new one prices the model.
    const offers = await deps.catalog.getOffers(product.id);
    const observado_en = artIso(deps.now());
    for (const o of offers) record(mlListing(product, o, observado_en));
    const best = cheapestNewOffer(offers);
    if (best === null) {
      models.push(modelRow);
      skip(modelo_id, "sin_ofertas_nuevas");
      return;
    }
    const priced: MlProduct = { ...product, precio_ars: best.precio_ars };
    const rejected = await deps.rejected(modelo_id);
    const rivals: Rival[] = [];

    // 6. Primary listing again, now with the ML price (price guard).
    const primaryMatch: Match | null = matchListings(priced, listing);
    if (primaryMatch !== null) {
      rows.push({ modelo_id, tienda: listing.tienda, ref_externa: listing.ref_externa, match: primaryMatch });
      if (primaryMatch.confianza === "alta" && primaryMatch.regla !== "parcial" && !rejected.has(rivalKey(listing))) {
        rivals.push({ listing, regla: primaryMatch.regla });
      }
    }

    // 5. Secondary stores: cheapest alta per store.
    for (const store of deps.secondary) {
      if (droppedStores.has(store.id)) continue;
      let read: Listing[];
      try {
        read = await store.search(term);
      } catch (error) {
        if (!(error instanceof StoreFormatError)) throw error;
        droppedStores.add(store.id);
        partial = true;
        alertStore(store.id);
        deps.log("store_dropped", { tienda: store.id, reason: error.message });
        continue;
      }
      let cheapest: Rival | null = null;
      for (const l of read) {
        record(l);
        if (rejected.has(rivalKey(l))) continue;
        const m = matchListings(priced, l);
        if (m === null) continue;
        rows.push({ modelo_id, tienda: l.tienda, ref_externa: l.ref_externa, match: m });
        if (m.confianza === "alta" && m.regla !== "parcial" && (cheapest === null || l.precio_ars < cheapest.listing.precio_ars)) {
          cheapest = { listing: l, regla: m.regla };
        }
      }
      if (cheapest !== null) rivals.push(cheapest);
    }

    models.push(modelRow);
    matches.push(...rows);
    if (rivals.length === 0) return;
    groups.push({
      modelo_id,
      marca,
      titulo: product.titulo,
      imagen_url: product.imagen_url,
      ml: {
        tienda: "ml",
        titulo_listado: product.titulo,
        url: product.url,
        precio_ars: best.precio_ars,
        observado_en,
        ref_externa: best.item_id,
        vendedor: best.seller_id,
        ml_product_id: product.id,
        ml_seller_id: best.seller_id,
      },
      otras: rivals.map((r) => ({
        regla: r.regla,
        offer: {
          tienda: r.listing.tienda,
          titulo_listado: r.listing.titulo,
          url: r.listing.url,
          precio_ars: r.listing.precio_ars,
          observado_en: r.listing.observado_en,
          ref_externa: r.listing.ref_externa,
          vendedor: r.listing.vendedor,
        },
      })),
    });
  }

  const queue = [...entries.values()];
  for (const [i, entry] of queue.entries()) {
    try {
      await processModel(entry);
    } catch (error) {
      if (error instanceof BudgetExhaustedError) {
        partial = true;
        deps.log("budget_exhausted", { stage: "model", modelo_id: entry.modelo_id });
        for (const rest of queue.slice(i)) skip(rest.modelo_id, "budget_exhausted");
        break;
      }
      if (error instanceof UpstreamError) {
        partial = true;
        skip(entry.modelo_id, "upstream_error");
      } else if (error instanceof StoreFormatError && error.tienda === "ml") {
        partial = true;
        alertStore("ml");
        skip(entry.modelo_id, "ml_format_error");
      } else {
        throw error;
      }
    }
  }

  const list = buildCandidateList({
    corrida_id: input.corrida_id,
    fecha: input.fecha,
    categoria: input.category.id,
    umbral_pct: input.umbral_pct,
    groups,
  });
  return { list, listings: [...listings.values()], models, matches, estado: partial ? "parcial" : "ok", skipped, alerts };
}

/**
 * The reads revalidation (Task 14) repeats for each candidate: the ML offers and, per rival store,
 * the search by "<marca> <codigo_modelo>". Used by the recording script so one recording replays both runs.
 */
export async function revalidationReads(
  deps: { catalog: MlCatalog; stores: StoreAdapter[] },
  result: Pick<PipelineResult, "list" | "models">,
): Promise<void> {
  const codes = new Map(result.models.map((m) => [m.id, m.codigo_modelo]));
  for (const c of result.list.candidatos) {
    await deps.catalog.getOffers(c.ml.ml_product_id);
    const code = codes.get(c.modelo_id);
    if (code === undefined) continue;
    for (const store of rivalStores(c, deps.stores)) await store.search(`${c.marca} ${code}`);
  }
}

function rivalStores(c: Candidate, stores: StoreAdapter[]): StoreAdapter[] {
  const ids = new Set(c.otras.map((o) => o.tienda));
  return stores.filter((s) => ids.has(s.id));
}
