import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCandidateList } from "../../src/contract/candidate-list.js";
import type { OwnerAlert } from "../../src/contract/local-hooks.js";
import { BudgetExhaustedError, UpstreamError, createBudgetedHttp } from "../../src/data/http.js";
import { MlAuthError, type TokenProvider } from "../../src/data/ml/auth.js";
import { MlPermissionError, createMlCatalog, type MlCatalog, type MlProduct } from "../../src/data/ml/catalog.js";
import { revalidationReads, runPipeline, type PipelineDeps } from "../../src/data/pipeline.js";
import { createReplayFetch } from "../../src/data/recording.js";
import { createFravegaAdapter, fravegaSearchUrl } from "../../src/data/stores/fravega.js";
import { StoreFormatError, type Listing, type StoreAdapter } from "../../src/data/types.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = (...parts: string[]) => path.join(ROOT, "fixtures", ...parts);
const mlJson = (name: string): string => readFileSync(fixture("ml", name), "utf8");
const FRAVEGA_NONE = readFileSync(fixture("fravega", "listing-no-results.html"), "utf8");
const FRAVEGA_HTML = readFileSync(fixture("fravega", "listing-aspiradoras-robot.html"), "utf8");

const ML = "https://api.mercadolibre.com";
const searchUrl = (q: string) => `${ML}/products/search?site_id=MLA&status=active&q=${encodeURIComponent(q)}`;
const itemsUrl = (id: string) => `${ML}/products/${id}/items`;

const PHILCO_ID = "PHILCO:PHRA26N";
const PHILCO_REF = "/p/aspiradora-robot-trapeadora-philco-limpieza-sense-antichoque-con-app-phra26n-60505/";
const NOW = new Date("2026-11-10T09:00:00Z"); // 06:00 ART
const CATEGORY = { id: "aspiradoras-robot", name: "Aspiradoras robot", terms: ["aspiradora robot"] };
const INPUT = { run_id: "run-1", run_date: "2026-11-10", category: CATEGORY, threshold_pct: 15 };

// Replay composed from the real Frávega listing and synthetic (-derived, fake ids) ML responses.
function composedRoutes(): Map<string, () => Response> {
  const json = (body: string) => () => new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  return new Map<string, () => Response>([
    [fravegaSearchUrl("aspiradora robot", 1), () => new Response(FRAVEGA_NONE, { status: 200, headers: { "content-type": "text/html" } })],
    [fravegaSearchUrl("aspiradora robot"), () => new Response(FRAVEGA_HTML, { status: 200, headers: { "content-type": "text/html" } })],
    [searchUrl("Philco PHRA26N"), json(mlJson("products-search-philco-phra26n-derived.json"))],
    [itemsUrl("MLA00000011"), json(mlJson("product-items-philco-derived.json"))],
    [searchUrl("Irobot M611330"), json(mlJson("products-search-irobot-m611330-derived.json"))],
    [itemsUrl("MLA00000012"), json(mlJson("product-items-irobot-derived.json"))],
    [searchUrl("Smartlife SLRVCL050"), json(mlJson("product-items-empty-derived.json"))],
    [searchUrl("SL-RVCL050"), json(mlJson("product-items-empty-derived.json"))],
  ]);
}

const fakeToken: TokenProvider = { get: async () => "fake-token", forceRefresh: async () => "fake-token" };

function routedFetch(routes: Map<string, () => Response>): typeof fetch {
  return async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const route = routes.get(url);
    if (!route) throw new Error(`unrecorded URL: ${url}`);
    return route();
  };
}

type Setup = {
  deps: PipelineDeps;
  logs: { event: string; data: Record<string, unknown> }[];
  http: ReturnType<typeof createBudgetedHttp>;
  catalog: MlCatalog;
};

function setup(
  opts: {
    routes?: Map<string, () => Response>;
    budget?: number;
    secondary?: StoreAdapter[];
    rejected?: (modelId: string) => Set<string>;
    wrapCatalog?: (c: MlCatalog) => MlCatalog;
    wrapPrimary?: (p: StoreAdapter) => StoreAdapter;
  } = {},
): Setup {
  const logs: Setup["logs"] = [];
  const log = (event: string, data: Record<string, unknown>) => void logs.push({ event, data });
  const http = createBudgetedHttp({ fetch: routedFetch(opts.routes ?? composedRoutes()), budget: opts.budget ?? 100, sleep: async () => {} });
  const catalog = createMlCatalog({ http, token: fakeToken });
  const fravega = createFravegaAdapter({
    http,
    now: () => NOW,
    onRejected: (store, rejected) => log("seller_rejected", { store, count: rejected.length }),
  });
  const deps: PipelineDeps = {
    catalog: opts.wrapCatalog ? opts.wrapCatalog(catalog) : catalog,
    stores: [opts.wrapPrimary ? opts.wrapPrimary(fravega) : fravega, ...(opts.secondary ?? [])],
    rejected: async (id) => opts.rejected?.(id) ?? new Set(),
    now: () => NOW,
    log,
  };
  return { deps, logs, http, catalog };
}

function listing(over: Partial<Listing> & Pick<Listing, "store" | "external_ref" | "title" | "price_ars">): Listing {
  return {
    brand: null,
    model: null,
    gtin: null,
    url: `https://${over.store}.example.test${over.external_ref}`,
    seller: over.store,
    item_condition: null,
    observed_at: "2026-11-10T06:00:00-03:00",
    ...over,
  };
}

const philcoRival = (store: string, ref: string, price: number) =>
  listing({ store, external_ref: ref, title: "Aspiradora Robot Philco PHRA26N", brand: "Philco", gtin: "7796962017233", price_ars: price });

function fakeStore(id: string, search: (term: string) => Listing[] | Error): StoreAdapter & { terms: string[] } {
  const terms: string[] = [];
  return {
    id,
    terms,
    async search(term) {
      terms.push(term);
      const out = search(term);
      if (out instanceof Error) throw out;
      return out;
    },
  };
}

// Real stores answer the per-model term with that model's listings and the category term with other products.
const onlyPhilcoTerm = (items: () => Listing[]) => (term: string) => (term === "Philco PHRA26N" ? items() : []);

describe("runPipeline against the composed replay", () => {
  it("builds a valid candidate list priced with the cheapest new ML offer", async () => {
    const { deps } = setup();
    const r = await runPipeline(deps, INPUT);
    expect(() => parseCandidateList(r.list)).not.toThrow();
    expect(r.status).toBe("ok");
    expect(r.skipped).toEqual([]);
    expect(r.list.models_compared).toBe(2); // Philco and iRobot have a rival; Smartlife has no catalog product
    expect(r.list.candidates.map((c) => c.model_id)).toEqual([PHILCO_ID]); // iRobot is only ~4% cheaper
    const c = r.list.candidates[0]!;
    expect(c.ml).toMatchObject({ price_ars: 119999, external_ref: "MLA90000112", ml_product_id: "MLA00000011", ml_seller_id: "2001" });
    expect(c.others.map((o) => [o.store, o.price_ars])).toEqual([["fravega", 163999]]);
    expect(c.match_rule).toBe("gtin");
  });

  it("records the model rows and a doubtful partial match when the catalog has no product", async () => {
    const { deps } = setup();
    const r = await runPipeline(deps, INPUT);
    expect(r.models.map((m) => m.id).sort()).toEqual(["IROBOT:M611330", PHILCO_ID, "SMARTLIFE:SLRVCL050"]);
    const philco = r.models.find((m) => m.id === PHILCO_ID)!;
    expect(philco).toMatchObject({ category: "aspiradoras-robot", brand: "Philco", model_code: "PHRA26N", ml_product_id: "MLA00000011", gtin: "7796962017233" });
    const smart = r.matches.find((m) => m.model_id === "SMARTLIFE:SLRVCL050")!;
    expect(smart.match).toMatchObject({ confidence: "doubtful", rule: "partial", reason: "no_high" });
    expect(smart.store).toBe("fravega");
    expect(r.models.find((m) => m.id === "SMARTLIFE:SLRVCL050")!.ml_product_id).toBeNull();
    const philcoMatch = r.matches.find((m) => m.model_id === PHILCO_ID)!;
    expect(philcoMatch.match).toMatchObject({ confidence: "high", rule: "gtin" });
  });

  it("records ML offers of every condition as listings but prices candidates with new offers only", async () => {
    const { deps } = setup();
    const r = await runPipeline(deps, INPUT);
    const ml = r.listings.filter((l) => l.store === "ml" && l.model === "PHRA26N");
    expect(ml.map((l) => [l.external_ref, l.item_condition, l.price_ars]).sort()).toEqual([
      ["MLA90000111", "used", 89999],
      ["MLA90000112", "new", 119999],
      ["MLA90000113", "new", 124999],
    ]);
    expect(r.list.candidates[0]!.ml.price_ars).toBe(119999); // not the used 89999
  });

  it("returns every price read (primary, secondary and ML offers, kept or not) in listings", async () => {
    const cetrogar = fakeStore("cetrogar", (term) =>
      term === "Philco PHRA26N"
        ? [philcoRival("cetrogar", "/philco-a", 159999), listing({ store: "cetrogar", external_ref: "/otro", title: "Heladera no relacionada", price_ars: 500000 })]
        : [],
    );
    const { deps } = setup({ secondary: [cetrogar] });
    const r = await runPipeline(deps, INPUT);
    const by = (t: string) => r.listings.filter((l) => l.store === t);
    expect(by("fravega")).toHaveLength(3); // the three sold by Frávega, kept or not as candidates
    expect(by("ml")).toHaveLength(4); // 3 Philco offers + 1 iRobot offer
    expect(by("cetrogar").map((l) => l.external_ref).sort()).toEqual(["/otro", "/philco-a"]);
    const keys = r.listings.map((l) => `${l.store}:${l.external_ref}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps the cheapest high per secondary store and sorts rivals ascending", async () => {
    const cetrogar = fakeStore("cetrogar", onlyPhilcoTerm(() => [philcoRival("cetrogar", "/a", 170000), philcoRival("cetrogar", "/b", 150000)]));
    const { deps } = setup({ secondary: [cetrogar] });
    const r = await runPipeline(deps, INPUT);
    const c = r.list.candidates[0]!;
    expect(c.others.map((o) => [o.store, o.price_ars])).toEqual([["cetrogar", 150000], ["fravega", 163999]]);
    expect(c.difference_ars).toBe(150000 - 119999);
    expect(cetrogar.terms).toContain("Philco PHRA26N");
  });

  it("never proposes a rival marked rejected", async () => {
    const cetrogar = fakeStore("cetrogar", onlyPhilcoTerm(() => [philcoRival("cetrogar", "/a", 150000)]));
    const rejected = (id: string) => (id === PHILCO_ID ? new Set([`fravega:${PHILCO_REF}`, "cetrogar:/a"]) : new Set<string>());
    const { deps } = setup({ secondary: [cetrogar], rejected });
    const r = await runPipeline(deps, INPUT);
    expect(r.list.candidates).toEqual([]);
    expect(r.list.models_compared).toBe(1); // only iRobot still has a rival
    const rejectedOnly = await runPipeline(setup({ secondary: [cetrogar], rejected: () => new Set(["cetrogar:/a"]) }).deps, INPUT);
    expect(rejectedOnly.list.candidates[0]!.others.map((o) => o.store)).toEqual(["fravega"]);
  });

  it("logs seller_rejected with the rejected count when an adapter reports rejections", async () => {
    const { deps, logs } = setup();
    await runPipeline(deps, INPUT);
    expect(logs).toContainEqual({ event: "seller_rejected", data: { store: "fravega", count: 12 } });
  });

  it("finishes partial with the models read so far when the budget runs out", async () => {
    // 1 Frávega page + Philco search and items + iRobot search = 4; the iRobot offers read has no budget left.
    const { deps, http } = setup({ budget: 4 });
    const r = await runPipeline(deps, INPUT);
    expect(http.used()).toBe(4);
    expect(r.status).toBe("partial");
    expect(r.list.candidates.map((c) => c.model_id)).toEqual([PHILCO_ID]);
    expect(r.skipped).toEqual([
      { model_id: "IROBOT:M611330", reason: "budget_exhausted" },
      { model_id: "SMARTLIFE:SLRVCL050", reason: "budget_exhausted" },
    ]);
  });

  it("returns an empty partial run when the budget runs out reading the primary store", async () => {
    const { deps } = setup({ budget: 0 });
    const r = await runPipeline(deps, INPUT);
    expect(r.status).toBe("partial");
    expect(r.list.candidates).toEqual([]);
    expect(r.listings).toEqual([]);
  });

  it("skips a model on UpstreamError and continues", async () => {
    const { deps } = setup({
      wrapCatalog: (c) => ({
        ...c,
        getOffers: async (id) => {
          if (id === "MLA00000011") throw new UpstreamError(500, itemsUrl(id));
          return c.getOffers(id);
        },
      }),
    });
    const r = await runPipeline(deps, INPUT);
    expect(r.status).toBe("partial");
    expect(r.skipped).toEqual([{ model_id: PHILCO_ID, reason: "upstream_error" }]);
    expect(r.matches.some((m) => m.model_id === "IROBOT:M611330")).toBe(true);
    expect(r.models.some((m) => m.id === PHILCO_ID)).toBe(false);
    expect(r.list.models_compared).toBe(1);
  });

  it("skips a model with no new ML offers", async () => {
    const routes = composedRoutes();
    routes.set(itemsUrl("MLA00000012"), () => new Response(mlJson("product-items-only-used-derived.json"), { status: 200 }));
    const r = await runPipeline(setup({ routes }).deps, INPUT);
    expect(r.skipped).toEqual([{ model_id: "IROBOT:M611330", reason: "no_new_offers" }]);
    expect(r.status).toBe("ok");
    expect(r.listings.filter((l) => l.store === "ml" && l.item_condition === "used")).toHaveLength(2); // still recorded
  });

  it("drops a secondary store on StoreFormatError and emits store_format_error once", async () => {
    const broken = fakeStore("cetrogar", () => new StoreFormatError("cetrogar", "unrecognized page"));
    const { deps } = setup({ secondary: [broken] });
    const r = await runPipeline(deps, INPUT);
    expect(r.status).toBe("partial");
    expect(r.alerts).toEqual<OwnerAlert[]>([{ kind: "store_format_error", store: "cetrogar" }]);
    expect(broken.terms).toHaveLength(1); // not queried again for the next models
    expect(r.list.candidates.map((c) => c.model_id)).toEqual([PHILCO_ID]);
  });

  it("rethrows StoreFormatError from the primary store", async () => {
    const { deps } = setup({ wrapPrimary: (p) => ({ ...p, search: async () => { throw new StoreFormatError(p.id, "unrecognized page"); } }) });
    await expect(runPipeline(deps, INPUT)).rejects.toBeInstanceOf(StoreFormatError);
  });

  it("rethrows MlPermissionError and MlAuthError", async () => {
    const perm = setup({ wrapCatalog: (c) => ({ ...c, searchProducts: async () => { throw new MlPermissionError("/products/search"); } }) });
    await expect(runPipeline(perm.deps, INPUT)).rejects.toBeInstanceOf(MlPermissionError);
    const auth = setup({ wrapCatalog: (c) => ({ ...c, searchProducts: async () => { throw new MlAuthError("not_authorized"); } }) });
    await expect(runPipeline(auth.deps, INPUT)).rejects.toBeInstanceOf(MlAuthError);
  });

  it("does not turn a BudgetExhaustedError from a secondary store into a skipped model with a rival missing", async () => {
    const exhausted = fakeStore("cetrogar", () => new BudgetExhaustedError());
    const r = await runPipeline(setup({ secondary: [exhausted] }).deps, INPUT);
    expect(r.status).toBe("partial");
    expect(r.skipped.map((s) => s.reason)).toEqual(["budget_exhausted", "budget_exhausted", "budget_exhausted"]);
    expect(r.list.candidates).toEqual([]);
  });
});

describe("runPipeline primary reading", () => {
  const primaryOf = (items: Record<string, Listing[]>) => fakeStore("fravega", (t) => items[t] ?? []);
  const fl = (ref: string, title: string, price: number, brand: string | null = "Philco") =>
    listing({ store: "fravega", external_ref: ref, title, brand, price_ars: price });

  it("unions terms deduped by external_ref, skips listings without code or brand, keeps the cheapest per model", async () => {
    const primary = primaryOf({
      "aspiradora robot": [fl("/a", "Robot Philco PHRA26N", 200000), fl("/c", "Aspiradora robot generica", 90000)],
      "robot philco": [fl("/a", "Robot Philco PHRA26N", 200000), fl("/b", "Robot Philco PHRA26N negro", 180000), fl("/d", "Robot PHRA26N sin marca", 100000, null)],
    });
    const { deps } = setup({ wrapPrimary: () => primary, routes: composedRoutes() });
    const r = await runPipeline(deps, { ...INPUT, category: { ...CATEGORY, terms: ["aspiradora robot", "robot philco"] } });
    expect(primary.terms).toEqual(["aspiradora robot", "robot philco"]); // one page per term
    expect(r.skipped).toEqual([
      { model_id: null, reason: "no_model_code" },
      { model_id: null, reason: "no_brand" },
    ]);
    expect(r.models).toHaveLength(1);
    expect(r.listings.filter((l) => l.store === "fravega")).toHaveLength(4); // /a, /b, /c, /d once each
  });
});

describe("runPipeline ML fallback query", () => {
  const smartlife = (title: string) => listing({ store: "fravega", external_ref: "/s", title, brand: "Smartlife", price_ars: 100000 });
  const mlProduct = (over: Partial<MlProduct> = {}): MlProduct => ({
    store: "ml", id: "MLA0000009", title: "Aspiradora Robot Smartlife SL-RVCL050", brand: "Smartlife", model: "SL-RVCL050",
    gtin: null, price_ars: null, url: "https://ml.test/p/MLA0000009", image_url: null, ...over,
  });
  // The fake ML catalog answers only the queries it is given; any other query returns no products.
  function run(title: string, answers: Record<string, MlProduct[]>) {
    const queries: string[] = [];
    const wrapCatalog = (c: MlCatalog): MlCatalog => ({
      ...c,
      searchProducts: async (q) => (queries.push(q), answers[q] ?? []),
      getOffers: async () => [],
    });
    const primary = fakeStore("fravega", () => [smartlife(title)]);
    const { deps, logs } = setup({ wrapPrimary: () => primary, wrapCatalog });
    return { queries, logs, result: runPipeline(deps, INPUT) };
  }

  it("retries once with the code as the store wrote it when the first search has no high match", async () => {
    const { queries, result } = run("Aspiradora Robot Smartlife SL-RVCL050", { "SL-RVCL050": [mlProduct()] });
    const r = await result;
    expect(queries).toEqual(["Smartlife SLRVCL050", "SL-RVCL050"]);
    expect(r.models[0]!.ml_product_id).toBe("MLA0000009");
    expect(r.skipped).toEqual([{ model_id: "SMARTLIFE:SLRVCL050", reason: "no_new_offers" }]);
  });

  it("does not retry when the first search already matches", async () => {
    const { queries, result } = run("Aspiradora Robot Smartlife SL-RVCL050", { "Smartlife SLRVCL050": [mlProduct()] });
    const r = await result;
    expect(queries).toEqual(["Smartlife SLRVCL050"]);
    expect(r.models[0]!.ml_product_id).toBe("MLA0000009");
  });

  it("falls back to the code alone when the store wrote it the same way", async () => {
    const { queries, result } = run("Aspiradora Robot Smartlife SLRVCL050", { SLRVCL050: [mlProduct()] });
    const r = await result;
    expect(queries).toEqual(["Smartlife SLRVCL050", "SLRVCL050"]);
    expect(r.models[0]!.ml_product_id).toBe("MLA0000009");
  });

  it("makes at most one extra query and keeps the same unmatched reason when nothing matches", async () => {
    const { queries, logs, result } = run("Aspiradora Robot Smartlife SL-RVCL050", {});
    const r = await result;
    expect(queries).toEqual(["Smartlife SLRVCL050", "SL-RVCL050"]);
    expect(r.models[0]!.ml_product_id).toBeNull();
    expect(r.matches[0]!.match).toMatchObject({ confidence: "doubtful", rule: "partial", reason: "no_high" });
    expect(logs.filter((l) => l.event === "model_unmatched")).toEqual([{ event: "model_unmatched", data: { model_id: "SMARTLIFE:SLRVCL050", reason: "no_high" } }]);
  });

  it("does not retry after multiple_high", async () => {
    const twin = mlProduct({ id: "MLA0000010" });
    const { queries, result } = run("Aspiradora Robot Smartlife SL-RVCL050", { "Smartlife SLRVCL050": [mlProduct(), twin] });
    const r = await result;
    expect(queries).toEqual(["Smartlife SLRVCL050"]);
    expect(r.matches[0]!.match).toMatchObject({ reason: "multiple_high" });
  });
});

describe("revalidationReads", () => {
  it("re-reads the ML offers and each rival store for every candidate", async () => {
    const cetrogar = fakeStore("cetrogar", onlyPhilcoTerm(() => [philcoRival("cetrogar", "/a", 150000)]));
    const { deps, catalog } = setup({ secondary: [cetrogar] });
    const r = await runPipeline(deps, INPUT);
    const offerReads: string[] = [];
    const fravegaTerms: string[] = [];
    const spyCatalog: MlCatalog = { ...catalog, getOffers: async (id) => (offerReads.push(id), catalog.getOffers(id)) };
    const fravega: StoreAdapter = { id: "fravega", search: async (t) => (fravegaTerms.push(t), []) };
    cetrogar.terms.length = 0;
    await revalidationReads({ catalog: spyCatalog, stores: [fravega, cetrogar] }, r);
    expect(offerReads).toEqual(["MLA00000011"]);
    expect(fravegaTerms).toEqual(["Philco PHRA26N"]);
    expect(cetrogar.terms).toEqual(["Philco PHRA26N"]);
  });
});

// The owner records the real run with `pnpm fixtures:record run aspiradoras-robot`.
const RUNS_DIR = fixture("runs");
const recorded = existsSync(RUNS_DIR)
  ? readdirSync(RUNS_DIR).filter((d) => /^\d{4}-\d{2}-\d{2}-aspiradoras-robot$/.test(d)).sort().at(-1)
  : undefined;

describe("recorded run", () => {
  it.skipIf(recorded === undefined)(
    recorded === undefined
      ? "reproduces the recorded aspiradoras-robot run (skipped: no recorded run under fixtures/runs: owner must run pnpm fixtures:record run aspiradoras-robot)"
      : "reproduces the recorded aspiradoras-robot run",
    async () => {
      const dir = path.join(RUNS_DIR, recorded!);
      const date = recorded!.slice(0, 10);
      const now = new Date(`${date}T09:00:00Z`);
      const http = createBudgetedHttp({ fetch: createReplayFetch(dir), budget: 10_000, sleep: async () => {} });
      const deps: PipelineDeps = {
        catalog: createMlCatalog({ http, token: fakeToken }),
        stores: [createFravegaAdapter({ http, now: () => now, pages: 1 })],
        rejected: async () => new Set(),
        now: () => now,
        log: () => {},
      };
      const r = await runPipeline(deps, { ...INPUT, run_date: date });
      expect(() => parseCandidateList(r.list)).not.toThrow();
      expect({
        comparados: r.list.models_compared,
        aprobados: r.list.candidates.map((c) => [c.model_id, Math.floor(c.difference_pct * 10) / 10]),
      }).toMatchSnapshot();
    },
  );
});

describe("runPipeline with every store as a model source", () => {
  const empty = () => fakeStore("fravega", () => []);
  const CAT = "aspiradora robot";
  const withCategory = (items: Listing[], perModel: Listing[] = items) => (t: string) => (t === CAT ? items : t === "Philco PHRA26N" ? perModel : []);

  it("builds models from a store that is not Frávega", async () => {
    const cetrogar = fakeStore("cetrogar", withCategory([philcoRival("cetrogar", "/a", 150000)]));
    const r = await runPipeline(setup({ wrapPrimary: empty, secondary: [cetrogar] }).deps, INPUT);
    expect(r.models.map((m) => m.id)).toEqual([PHILCO_ID]);
    expect(r.list.candidates.map((c) => [c.model_id, c.others.map((o) => o.store)])).toEqual([[PHILCO_ID, ["cetrogar"]]]);
  });

  it("merges a model listed by two stores into one with both rivals, without searching either again", async () => {
    const fravega = fakeStore("fravega", (t) => (t === CAT ? [philcoRival("fravega", "/f", 163999)] : []));
    const cetrogar = fakeStore("cetrogar", withCategory([philcoRival("cetrogar", "/a", 150000)]));
    const r = await runPipeline(setup({ wrapPrimary: () => fravega, secondary: [cetrogar] }).deps, INPUT);
    expect(r.models.filter((m) => m.id === PHILCO_ID)).toHaveLength(1);
    expect(r.list.candidates[0]!.others.map((o) => [o.store, o.price_ars])).toEqual([["cetrogar", 150000], ["fravega", 163999]]);
    expect(fravega.terms).toEqual([CAT]);
    expect(cetrogar.terms).toEqual([CAT]);
  });

  it("searches only the stores that did not list the model", async () => {
    const fravega = fakeStore("fravega", (t) => (t === CAT ? [philcoRival("fravega", "/f", 163999)] : []));
    const cetrogar = fakeStore("cetrogar", withCategory([], [philcoRival("cetrogar", "/a", 150000)]));
    const r = await runPipeline(setup({ wrapPrimary: () => fravega, secondary: [cetrogar] }).deps, INPUT);
    expect(fravega.terms).toEqual([CAT]);
    expect(cetrogar.terms).toEqual([CAT, "Philco PHRA26N"]);
    expect(r.list.candidates[0]!.others.map((o) => o.store)).toEqual(["cetrogar", "fravega"]);
  });

  it("processes models listed by more stores first", async () => {
    const solo = listing({ store: "fravega", external_ref: "/s", title: "Aspiradora Robot Smartlife SL-RVCL050", brand: "Smartlife", price_ars: 100000 });
    const fravega = fakeStore("fravega", (t) => (t === CAT ? [solo, philcoRival("fravega", "/f", 163999)] : []));
    const cetrogar = fakeStore("cetrogar", withCategory([philcoRival("cetrogar", "/a", 150000)]));
    const r = await runPipeline(setup({ wrapPrimary: () => fravega, secondary: [cetrogar] }).deps, INPUT);
    expect(r.models.map((m) => m.id)).toEqual([PHILCO_ID, "SMARTLIFE:SLRVCL050"]);
  });

  it("stops cleanly mid-models when the budget runs out and logs it", async () => {
    // fravega page 1 + Philco search + Philco items = 3; the next model has no budget for its ML search.
    const fravega = fakeStore("fravega", (t) => (t === CAT ? [philcoRival("fravega", "/f", 163999), listing({ store: "fravega", external_ref: "/i", title: "Aspiradora iRobot M611330 Braava Jet M6 Black", brand: "Irobot", price_ars: 100000 })] : []));
    const cetrogar = fakeStore("cetrogar", withCategory([philcoRival("cetrogar", "/a", 150000)]));
    const { deps, logs } = setup({ budget: 2, wrapPrimary: () => fravega, secondary: [cetrogar] });
    const r = await runPipeline(deps, INPUT);
    expect(r.status).toBe("partial");
    expect(r.skipped).toEqual([{ model_id: "IROBOT:M611330", reason: "budget_exhausted" }]);
    expect(r.list.candidates.map((c) => c.model_id)).toEqual([PHILCO_ID]);
    expect(logs.some((l) => l.event === "budget_exhausted" && l.data.stage === "model")).toBe(true);
  });

  it("rethrows a store format error only when every store is broken", async () => {
    const a = fakeStore("fravega", () => new StoreFormatError("fravega", "x"));
    const b = fakeStore("cetrogar", () => new StoreFormatError("cetrogar", "y"));
    await expect(runPipeline(setup({ wrapPrimary: () => a, secondary: [b] }).deps, INPUT)).rejects.toBeInstanceOf(StoreFormatError);
  });
});
