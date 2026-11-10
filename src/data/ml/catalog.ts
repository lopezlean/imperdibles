import { UpstreamError, type BudgetedHttp } from "../http.js";
import { StoreFormatError, type Comparable } from "../types.js";
import { MlAuthError, type TokenProvider } from "./auth.js";

export type MlProduct = Comparable & { id: string; url: string; imagen_url: string | null };
export type MlOffer = { item_id: string; seller_id: string; precio_ars: number; condicion: string };

export interface MlCatalog {
  searchProducts(q: string): Promise<MlProduct[]>;
  getProduct(id: string): Promise<MlProduct>;
  getOffers(productId: string): Promise<MlOffer[]>;
}

export class MlPermissionError extends Error {
  constructor(public path: string) {
    super(`Mercado Libre denied access to ${path}`);
    this.name = "MlPermissionError";
  }
}

const BASE = "https://api.mercadolibre.com";
const PRODUCT_PAGE = "https://www.mercadolibre.com.ar/p/";

const formatError = (message: string) => new StoreFormatError("ml", message);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

function attribute(raw: Record<string, unknown>, id: string): string | null {
  if (!Array.isArray(raw.attributes)) return null;
  for (const attr of raw.attributes) {
    if (isRecord(attr) && attr.id === id) return str(attr.value_name);
  }
  return null;
}

function firstPicture(raw: Record<string, unknown>): string | null {
  if (!Array.isArray(raw.pictures)) return null;
  const first = raw.pictures[0];
  return isRecord(first) ? str(first.secure_url) ?? str(first.url) : null;
}

function mapProduct(raw: unknown): MlProduct {
  if (!isRecord(raw)) throw formatError("product is not an object");
  const id = str(raw.id);
  const titulo = str(raw.name);
  if (!id || !titulo) throw formatError("product without id or name");
  return {
    tienda: "ml",
    id,
    titulo,
    marca: attribute(raw, "BRAND"),
    modelo: attribute(raw, "MODEL"),
    gtin: attribute(raw, "GTIN"),
    precio_ars: null,
    url: str(raw.permalink) ?? `${PRODUCT_PAGE}${id}`,
    imagen_url: firstPicture(raw),
  };
}

/** ML prices can carry cents; round up so the ML side never tilts toward a false pass. */
export function mapOffer(raw: unknown): MlOffer {
  if (!isRecord(raw)) throw formatError("offer is not an object");
  const item_id = str(raw.item_id);
  const condicion = str(raw.condition);
  const sellerRaw = raw.seller_id;
  const seller_id = typeof sellerRaw === "number" || typeof sellerRaw === "string" ? String(sellerRaw) : null;
  const price = raw.price;
  if (!item_id || !condicion || !seller_id) throw formatError("offer without item_id, condition or seller_id");
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) throw formatError("offer without a usable price");
  return { item_id, seller_id, precio_ars: Math.ceil(price), condicion };
}

export function cheapestNewOffer(offers: MlOffer[]): MlOffer | null {
  let best: MlOffer | null = null;
  for (const offer of offers) {
    if (offer.condicion !== "new") continue;
    if (best === null || offer.precio_ars < best.precio_ars) best = offer;
  }
  return best;
}

export function createMlCatalog(deps: { http: BudgetedHttp; token: TokenProvider }): MlCatalog {
  const { http, token } = deps;

  async function request(path: string): Promise<unknown> {
    const url = `${BASE}${path}`;
    let res = await http.get(url, { Authorization: `Bearer ${await token.get()}` });
    if (res.status === 401) {
      res = await http.get(url, { Authorization: `Bearer ${await token.forceRefresh()}` });
      if (res.status === 401) throw new MlAuthError("not_authorized");
    }
    if (res.status === 403) throw new MlPermissionError(path.split("?")[0]!);
    if (!res.ok) throw new UpstreamError(res.status, url);
    try {
      return await res.json();
    } catch {
      throw formatError(`invalid JSON from ${path.split("?")[0]}`);
    }
  }

  function resultsOf(body: unknown): unknown[] {
    if (Array.isArray(body)) return body;
    if (isRecord(body) && Array.isArray(body.results)) return body.results;
    throw formatError("response without a results array");
  }

  return {
    async searchProducts(q) {
      const body = await request(`/products/search?site_id=MLA&status=active&q=${encodeURIComponent(q)}`);
      return resultsOf(body).map(mapProduct);
    },
    async getProduct(id) {
      return mapProduct(await request(`/products/${encodeURIComponent(id)}`));
    },
    async getOffers(productId) {
      return resultsOf(await request(`/products/${encodeURIComponent(productId)}/items`)).map(mapOffer);
    },
  };
}
