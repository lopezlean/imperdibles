import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CandidateList } from "../../src/contract/candidate-list.js";
import type { LocalOutputHooks, OwnerAlert } from "../../src/contract/local-hooks.js";
import { fravegaSearchUrl } from "../../src/data/stores/fravega.js";
import { jumboSearchUrl } from "../../src/data/stores/jumbo.js";
import { runDaily, main, parseCommand, USAGE, type RunDeps } from "../../src/data/run-daily.js";
import { appendRunLog } from "../../src/local/run-log.js";
import { D1Unavailable, type SqlClient, type SqlValue } from "../../src/shared/db/sql-client.js";
import type { LocalEnv } from "../../src/shared/env.js";
import { createSqliteClient } from "../support/sqlite-client.js";
import { readFileSync as read } from "node:fs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = (...parts: string[]) => path.join(ROOT, "fixtures", ...parts);
const mlJson = (name: string): string => readFileSync(fixture("ml", name), "utf8");
const FRAVEGA_HTML = readFileSync(fixture("fravega", "listing-aspiradoras-robot.html"), "utf8");
const FRAVEGA_NONE = readFileSync(fixture("fravega", "listing-no-results.html"), "utf8");
const FRAVEGA_BROKEN = readFileSync(fixture("fravega", "listing-broken-derived.html"), "utf8");

const ML = "https://api.mercadolibre.com";
const TOKEN_URL = `${ML}/oauth/token`;
const searchUrl = (q: string) => `${ML}/products/search?site_id=MLA&status=active&q=${encodeURIComponent(q)}`;
const itemsUrl = (id: string) => `${ML}/products/${id}/items`;

const NOW = new Date("2026-11-10T09:00:00Z"); // 06:00 ART
const RUN_ID = "2026-11-10-aspiradoras-robot-060000";
const SECRETS = { token: "tok-SECRET-access", clientSecret: "client-SECRET-value", cfToken: "cf-SECRET-token", refresh: "refresh-SECRET-value", telegram: "987654:TG-SECRET-bot-token", publishNow: "publish-SECRET-now" };

const ENV: LocalEnv = {
  mlAppId: "app-id",
  mlClientSecret: SECRETS.clientSecret,
  mlRedirectUri: "https://imperdibles.com.ar",
  cfAccountId: "acct",
  cfApiToken: SECRETS.cfToken,
  d1DatabaseId: "db",
  telegramBotToken: SECRETS.telegram,
  telegramOwnerChatId: "",
  telegramChannelId: "",
  publishNowSecret: SECRETS.publishNow,
  workerBaseUrl: "",
  tgApiId: "",
  tgApiHash: "",
  tgSession: "",
  tgSourceChannelId: "",
  anthropicApiKey: "",
  anthropicModel: "",
};

type Routes = Map<string, () => Response>;
function composedRoutes(): Routes {
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

type Hooks = LocalOutputHooks & { ready: CandidateList[]; alerts: OwnerAlert[] };
function fakeHooks(): Hooks {
  const hooks: Hooks = {
    ready: [],
    alerts: [],
    onCandidatesReady: async (list) => void hooks.ready.push(list),
    onRevalidated: async () => {},
    notifyOwner: async (alert) => void hooks.alerts.push(alert),
  };
  return hooks;
}

function addToken(db: ReturnType<typeof createSqliteClient>, expiresAt: string) {
  db.raw.prepare("INSERT INTO ml_tokens (id, access_token, refresh_token, expires_at) VALUES (1, ?, ?, ?)").run(SECRETS.token, SECRETS.refresh, expiresAt);
}

/** Wraps a client so that chosen writes fail with D1Unavailable once the run has started. */
function flakyDb(base: SqlClient, shouldFail: (sql: string, attempt: number) => boolean): SqlClient & { attempts: Map<string, number> } {
  const attempts = new Map<string, number>();
  return {
    attempts,
    all: (sql, params) => base.all(sql, params),
    async run(sql: string, params?: SqlValue[]) {
      const key = sql.trim().split(/\s+/).slice(0, 3).join(" ");
      const n = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, n);
      if (!sql.includes("INTO runs") && shouldFail(sql, n)) throw new D1Unavailable("D1 answered HTTP 503");
      return base.run(sql, params);
    },
  };
}

type Setup = {
  deps: RunDeps;
  sqlite: ReturnType<typeof createSqliteClient>;
  hooks: Hooks;
  out: string[];
  err: string[];
  fetched: string[];
  logPath: string;
  clock: { now: Date };
};

function setup(
  opts: {
    routes?: Routes;
    now?: Date;
    tokenExpiry?: string | null;
    fetchImpl?: typeof fetch;
    wrapDb?: (db: SqlClient) => SqlClient;
    sqlite?: ReturnType<typeof createSqliteClient>;
  } = {},
): Setup {
  const sqlite = opts.sqlite ?? createSqliteClient();
  // These tests replay a Frávega-only world; the VTEX stores seeded by 0003 have their own tests.
  if (!opts.sqlite) sqlite.raw.exec("UPDATE stores SET enabled = 0 WHERE id IN ('jumbo', 'easy', 'coppel')");
  if (opts.tokenExpiry !== null && !opts.sqlite) addToken(sqlite, opts.tokenExpiry ?? "2026-11-11T00:00:00.000Z");
  const routes = opts.routes ?? composedRoutes();
  const fetched: string[] = [];
  const routed: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    fetched.push(url);
    const route = routes.get(url);
    if (!route) throw new Error(`unrecorded URL: ${url}`);
    return route();
  };
  const hooks = fakeHooks();
  const out: string[] = [];
  const err: string[] = [];
  const clock = { now: opts.now ?? NOW };
  const logPath = path.join(mkdtempSync(path.join(tmpdir(), "imperdibles-run-")), "var", "run-log.jsonl");
  const deps: RunDeps = {
    db: opts.wrapDb ? opts.wrapDb(sqlite) : sqlite,
    fetch: opts.fetchImpl ?? routed,
    env: ENV,
    now: () => clock.now,
    sleep: async () => {},
    hooks,
    logPath,
    stdout: (s) => void out.push(s),
    stderr: (s) => void err.push(s),
  };
  return { deps, sqlite, hooks, out, err, fetched, logPath, clock };
}

const count = (db: SqlClient, table: string) => db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).then((r) => r[0]!.n);
const logLines = (p: string) => readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
const runRow = (db: SqlClient) => db.all<Record<string, unknown>>("SELECT * FROM runs ORDER BY started_at DESC, rowid DESC LIMIT 1").then((r) => r[0]);

describe("imperdibles correr", () => {
  it("stores the run, candidates as pending and calls onCandidatesReady once", async () => {
    const s = setup();
    const r = await runDaily(s.deps, { force: false });
    expect(r).toEqual({ exitCode: 0, run_id: RUN_ID });
    expect(await runRow(s.sqlite)).toMatchObject({ id: RUN_ID, run_date: "2026-11-10", category: "aspiradoras-robot", status: "ok", models_compared: 2, queries_used: 8, error: null });
    const cands = await s.sqlite.all<{ status: string; run_id: string; model_id: string }>("SELECT status, run_id, model_id FROM candidates");
    expect(cands).toEqual([{ status: "pending", run_id: RUN_ID, model_id: "PHILCO:PHRA26N" }]);
    expect(s.hooks.ready).toHaveLength(1);
    expect(s.hooks.ready[0]!.run_id).toBe(RUN_ID);
    expect(s.hooks.ready[0]!.candidates).toHaveLength(1);
    expect(s.hooks.alerts).toEqual([]);
    expect(await count(s.sqlite, "price_observations")).toBeGreaterThan(0);
    expect(await count(s.sqlite, "matches")).toBeGreaterThan(0);
    expect(logLines(s.logPath)).toEqual([{ run_id: RUN_ID, run_date: "2026-11-10", status: "ok", error: null, at: "2026-11-10T06:00:00-03:00" }]);
  });

  it("reads every enabled VTEX store for each model and records its prices", async () => {
    const sqlite = createSqliteClient(); // jumbo, easy and coppel stay enabled as seeded by 0003
    addToken(sqlite, "2026-11-11T00:00:00.000Z");
    const routes = composedRoutes();
    const jumbo = JSON.stringify([
      {
        productName: "Aspiradora Robot Philco PHRA26N", brand: "Philco", link: "https://www.jumbo.com.ar/philco-phra26n/p",
        items: [{ ean: "7796962017233", sellers: [{ sellerId: "1", sellerName: "Jumbo", commertialOffer: { Price: 150000, ListPrice: 150000, AvailableQuantity: 2 } }] }],
      },
    ]);
    const empty = () => new Response("[]", { status: 200 });
    for (const host of ["jumbo", "easy", "coppel"]) {
      for (const term of ["Philco%20PHRA26N", "Irobot%20M611330", "aspiradora%20robot"]) routes.set(`https://www.${host}.com.ar/api/catalog_system/pub/products/search?ft=${term}&_from=0&_to=49`, empty);
    }
    routes.set(jumboSearchUrl("Philco PHRA26N"), () => new Response(jumbo, { status: 206 }));
    const s = setup({ sqlite, routes });
    expect((await runDaily(s.deps, { force: false })).exitCode).toBe(0);
    expect(s.fetched).toContain(jumboSearchUrl("Philco PHRA26N"));
    const stores = await s.sqlite.all<{ store_id: string }>("SELECT DISTINCT store_id FROM store_listings ORDER BY store_id");
    expect(stores.map((r) => r.store_id)).toContain("jumbo");
  });

  it("runs the category of the ART day and stores it in runs.category", async () => {
    const s = setup({ now: new Date("2026-11-11T09:00:00Z"), tokenExpiry: "2026-11-12T00:00:00.000Z" });
    const categories = [
      { id: "aspiradoras-robot", name: "Aspiradoras robot", terms: ["aspiradora robot"] },
      { id: "test-rotation", name: "Test rotation", terms: ["aspiradora robot"] },
    ];
    await s.sqlite.run("UPDATE config SET value = ? WHERE name = 'categories'", [JSON.stringify(categories)]);
    const r = await runDaily(s.deps, { force: false });
    expect(r.run_id).toBe("2026-11-11-test-rotation-060000");
    expect(await runRow(s.sqlite)).toMatchObject({ run_date: "2026-11-11", category: "test-rotation" });
  });

  it("calls onCandidatesReady with an empty list and ends ok when nothing passes", async () => {
    const s = setup();
    await s.sqlite.run("UPDATE config SET value = '90' WHERE name = 'threshold_pct'");
    const r = await runDaily(s.deps, { force: false });
    expect(r.exitCode).toBe(0);
    expect(s.hooks.ready).toHaveLength(1);
    expect(s.hooks.ready[0]!.candidates).toEqual([]);
    expect(await count(s.sqlite, "candidates")).toBe(0);
    expect(await runRow(s.sqlite)).toMatchObject({ status: "ok" });
  });

  it("refuses a second run of the same ART day without --forzar", async () => {
    const s = setup();
    await runDaily(s.deps, { force: false });
    s.fetched.length = 0;
    s.out.length = 0;
    const r = await runDaily(s.deps, { force: false });
    expect(r).toEqual({ exitCode: 2, run_id: null });
    expect(s.out.join("")).toBe(`Ya hay una corrida de hoy (${RUN_ID}). Para repetirla: imperdibles correr --forzar\n`);
    expect(s.fetched).toEqual([]);
    expect(s.hooks.ready).toHaveLength(1);
    expect(await count(s.sqlite, "candidates")).toBe(1);
  });

  it("runs again on the same day with --forzar", async () => {
    const s = setup();
    await runDaily(s.deps, { force: false });
    s.clock.now = new Date("2026-11-10T09:05:00Z");
    const r = await runDaily(s.deps, { force: true });
    expect(r).toEqual({ exitCode: 0, run_id: "2026-11-10-aspiradoras-robot-060500" });
    expect(await count(s.sqlite, "runs")).toBe(2);
  });

  const TWO_CATEGORIES = JSON.stringify([
    { id: "aspiradoras-robot", name: "Aspiradoras robot", terms: ["aspiradora robot"] },
    { id: "otra", name: "Otra", terms: ["aspiradora robot"] },
  ]);

  it("runs another category the same day without --forzar and refuses repeating that one", async () => {
    const s = setup();
    s.sqlite.raw.prepare("UPDATE config SET value = ? WHERE name = 'categories'").run(TWO_CATEGORIES);
    expect((await runDaily(s.deps, { force: false })).run_id).toBe(RUN_ID);
    s.clock.now = new Date("2026-11-10T09:05:00Z");
    const other = await runDaily(s.deps, { force: false, category: "otra" });
    expect(other).toEqual({ exitCode: 0, run_id: "2026-11-10-otra-060500" });
    expect(await runRow(s.sqlite)).toBeTruthy();
    s.out.length = 0;
    const again = await runDaily(s.deps, { force: false, category: "otra" });
    expect(again).toEqual({ exitCode: 2, run_id: null });
    expect(s.out.join("")).toBe("Ya hay una corrida de hoy (2026-11-10-otra-060500). Para repetirla: imperdibles correr --forzar\n");
    expect(await count(s.sqlite, "runs")).toBe(2);
  });

  it("rejects an unknown --categoria listing the valid ids, before reading any price", async () => {
    const s = setup();
    s.sqlite.raw.prepare("UPDATE config SET value = ? WHERE name = 'categories'").run(TWO_CATEGORIES);
    const r = await runDaily(s.deps, { force: false, category: "zapatillas" });
    expect(r).toEqual({ exitCode: 2, run_id: null });
    expect(s.err.join("")).toContain('Categoría desconocida: "zapatillas"');
    expect(s.err.join("")).toContain("aspiradoras-robot, otra");
    expect(s.fetched).toEqual([]);
    expect(await count(s.sqlite, "runs")).toBe(0);
  });

  it("does not count a failed run of the day as done", async () => {
    const s = setup({ routes: new Map([[fravegaSearchUrl("aspiradora robot"), () => new Response(FRAVEGA_BROKEN, { status: 200 })]]) });
    expect((await runDaily(s.deps, { force: false })).exitCode).toBe(1);
    s.clock.now = new Date("2026-11-10T09:05:00Z");
    const again = await runDaily({ ...s.deps, fetch: setup().deps.fetch }, { force: false });
    expect(again.exitCode).not.toBe(2);
  });

  it("stamps run_date with the ART date at 01:30 UTC", async () => {
    const s = setup({ now: new Date("2026-11-11T01:30:00Z"), tokenExpiry: "2026-11-12T00:00:00.000Z" });
    const r = await runDaily(s.deps, { force: false });
    expect(r.run_id).toBe("2026-11-10-aspiradoras-robot-223000");
    expect(await runRow(s.sqlite)).toMatchObject({ run_date: "2026-11-10", started_at: "2026-11-10T22:30:00-03:00" });
    expect(s.hooks.ready[0]!.run_date).toBe("2026-11-10");
  });

  it("leaves no candidates rows when D1 fails while saving, retries once, logs failed locally and alerts", async () => {
    let flaky!: ReturnType<typeof flakyDb>;
    const s = setup({ wrapDb: (db) => (flaky = flakyDb(db, (sql) => sql.includes("INTO candidates"))) });
    const r = await runDaily(s.deps, { force: false });
    expect(r).toEqual({ exitCode: 1, run_id: RUN_ID });
    expect(flaky.attempts.get("INSERT INTO candidates")).toBe(2);
    expect(await count(s.sqlite, "candidates")).toBe(0);
    expect(await runRow(s.sqlite)).toMatchObject({ id: RUN_ID, status: "failed" });
    expect(logLines(s.logPath)).toMatchObject([{ run_id: RUN_ID, status: "failed" }]);
    expect(s.hooks.alerts).toMatchObject([{ kind: "run_failed", run_id: RUN_ID }]);
    expect(s.hooks.ready).toEqual([]);
  });

  it("still logs locally and alerts when D1 rejects every write after the run started", async () => {
    const s = setup({ wrapDb: (db) => flakyDb(db, () => true) });
    const r = await runDaily(s.deps, { force: false });
    expect(r.exitCode).toBe(1);
    expect(logLines(s.logPath)).toMatchObject([{ run_id: RUN_ID, status: "failed" }]);
    expect(s.hooks.alerts).toMatchObject([{ kind: "run_failed" }]);
  });

  it("retries only the failed write", async () => {
    const clean = setup();
    await runDaily(clean.deps, { force: false });
    const expected = await count(clean.sqlite, "price_observations");

    let flaky!: ReturnType<typeof flakyDb>;
    const s = setup({ wrapDb: (db) => (flaky = flakyDb(db, (sql, n) => sql.includes("INTO candidates") && n === 1)) });
    const r = await runDaily(s.deps, { force: false });
    expect(r.exitCode).toBe(0);
    expect(flaky.attempts.get("INSERT INTO candidates")).toBe(2);
    expect(flaky.attempts.get("INSERT INTO price_observations")).toBe(1);
    expect(await count(s.sqlite, "price_observations")).toBe(expected);
    expect(await count(s.sqlite, "candidates")).toBe(1);
    expect(s.hooks.ready).toHaveLength(1);
  });

  it("emits run_partial with skipped_models when the pipeline ends partial", async () => {
    const s = setup();
    await s.sqlite.run("UPDATE config SET value = '4' WHERE name = 'query_budget'");
    const r = await runDaily(s.deps, { force: false });
    expect(r.exitCode).toBe(0);
    expect(await runRow(s.sqlite)).toMatchObject({ status: "partial", queries_used: 4 });
    expect(s.hooks.alerts).toEqual([{ kind: "run_partial", run_id: RUN_ID, skipped_models: 2, reason: "budget_exhausted" }]);
    expect(s.hooks.ready).toHaveLength(1);
  });

  it("marks the run failed and alerts store_format_error when the primary store format breaks", async () => {
    const s = setup({ routes: new Map([[fravegaSearchUrl("aspiradora robot"), () => new Response(FRAVEGA_BROKEN, { status: 200 })]]) });
    const r = await runDaily(s.deps, { force: false });
    expect(r).toEqual({ exitCode: 1, run_id: RUN_ID });
    expect(await runRow(s.sqlite)).toMatchObject({ status: "failed" });
    expect(s.hooks.alerts).toEqual([{ kind: "store_format_error", store: "fravega" }]);
    expect(s.hooks.ready).toEqual([]);
    expect(logLines(s.logPath)).toMatchObject([{ status: "failed" }]);
  });

  it("prints a clear message and exits 1 when offline", async () => {
    const s = setup({ fetchImpl: async () => { throw new TypeError("fetch failed"); } });
    const r = await runDaily(s.deps, { force: false });
    expect(r.exitCode).toBe(1);
    expect(s.err.join("")).toContain("Sin conexión: no se pudieron leer los precios. No se publicó nada.");
    expect(await runRow(s.sqlite)).toMatchObject({ status: "failed" });
    expect(s.hooks.ready).toEqual([]);
    expect(s.hooks.alerts).toMatchObject([{ kind: "run_failed" }]);
  });

  it("reports offline, not ml_auth_required, when the token refresh cannot reach the network", async () => {
    const s = setup({ tokenExpiry: "2026-11-10T00:00:00.000Z", fetchImpl: async () => { throw new TypeError("fetch failed"); } });
    const r = await runDaily(s.deps, { force: false });
    expect(r.exitCode).toBe(1);
    expect(s.err.join("")).toContain("Sin conexión");
    expect(s.hooks.alerts.some((a) => a.kind === "ml_auth_required")).toBe(false);
  });

  it("alerts ml_auth_required and reads nothing when the refresh fails", async () => {
    const routes = new Map<string, () => Response>([[TOKEN_URL, () => new Response('{"error":"invalid_grant"}', { status: 400 })]]);
    const s = setup({ tokenExpiry: "2026-11-10T00:00:00.000Z", routes });
    const r = await runDaily(s.deps, { force: false });
    expect(r.exitCode).toBe(1);
    expect(s.fetched).toEqual([TOKEN_URL]);
    expect(s.hooks.alerts).toEqual([{ kind: "ml_auth_required" }]);
    expect(await count(s.sqlite, "runs")).toBe(0);
    expect(logLines(s.logPath)).toMatchObject([{ run_id: null, status: "failed" }]);
  });

  it("alerts ml_auth_required when no token is stored", async () => {
    const s = setup({ tokenExpiry: null });
    const r = await runDaily(s.deps, { force: false });
    expect(r.exitCode).toBe(1);
    expect(s.fetched).toEqual([]);
    expect(s.hooks.alerts).toEqual([{ kind: "ml_auth_required" }]);
  });

  it("marks the run failed and alerts ml_permission_denied on a 403", async () => {
    const routes = composedRoutes();
    routes.set(searchUrl("Philco PHRA26N"), () => new Response("{}", { status: 403 }));
    const s = setup({ routes });
    const r = await runDaily(s.deps, { force: false });
    expect(r).toEqual({ exitCode: 1, run_id: RUN_ID });
    expect(await runRow(s.sqlite)).toMatchObject({ status: "failed" });
    expect(s.hooks.alerts).toEqual([{ kind: "ml_permission_denied", path: "/products/search" }]);
  });

  describe("secret scrubbing", () => {
    const leaky = `boom ${Object.values(SECRETS).join(" | ")} https://api.telegram.org/bot111222:ABC-def_ghi/sendMessage`;
    const check = (s: Setup) => {
      const everything = [readFileSync(s.logPath, "utf8"), s.out.join(""), s.err.join(""), JSON.stringify(s.hooks.alerts)].join("\n");
      for (const secret of Object.values(SECRETS)) expect(everything).not.toContain(secret);
      expect(everything).not.toContain("111222:ABC-def_ghi");
      expect(everything).toContain("boom");
    };

    it("from a failing persistence write", async () => {
      const s = setup({
        wrapDb: (db) => ({ all: (q, p) => db.all(q, p), run: async (q, p) => { if (q.includes("INTO candidates")) throw new Error(leaky); return db.run(q, p); } }),
      });
      expect((await runDaily(s.deps, { force: false })).exitCode).toBe(1);
      check(s);
    });

    it("from a failing onCandidatesReady", async () => {
      const s = setup();
      s.hooks.onCandidatesReady = async () => { throw new Error(leaky); };
      expect((await runDaily(s.deps, { force: false })).exitCode).toBe(1);
      check(s);
    });

    it("from a failing notifyOwner", async () => {
      const s = setup({ routes: new Map([[fravegaSearchUrl("aspiradora robot"), () => new Response(FRAVEGA_BROKEN, { status: 200 })]]) });
      s.hooks.notifyOwner = async (a) => { s.hooks.alerts.push(a); throw new Error(leaky); };
      expect((await runDaily(s.deps, { force: false })).exitCode).toBe(1);
      check(s);
    });

    it("redacts Telegram URLs even when the env does not hold the token, and runs without those variables", async () => {
      const s = setup();
      s.deps.env = { ...ENV, telegramBotToken: "", publishNowSecret: "" };
      s.hooks.onCandidatesReady = async () => { throw new Error("fail https://api.telegram.org/bot555:XYZ_abc-1/sendPhoto"); };
      expect((await runDaily(s.deps, { force: false })).exitCode).toBe(1);
      expect(readFileSync(s.logPath, "utf8")).not.toContain("555:XYZ_abc-1");
      expect(readFileSync(s.logPath, "utf8")).toContain("fail");
    });
  });

  it("does not let a failing notifyOwner hide the exit code", async () => {
    const s = setup({ routes: new Map([[fravegaSearchUrl("aspiradora robot"), () => new Response(FRAVEGA_BROKEN, { status: 200 })]]) });
    s.hooks.notifyOwner = async () => { throw new Error("telegram down"); };
    const r = await runDaily(s.deps, { force: false });
    expect(r.exitCode).toBe(1);
    expect(logLines(s.logPath)).toHaveLength(1);
  });
});

describe("appendRunLog", () => {
  it("appends one JSON line per call and creates the directory", async () => {
    const p = path.join(mkdtempSync(path.join(tmpdir(), "imperdibles-log-")), "a", "b", "log.jsonl");
    await appendRunLog(p, { run_id: null, run_date: "2026-11-10", status: "failed", error: "x", at: "2026-11-10T06:00:00-03:00" });
    await appendRunLog(p, { run_id: "r", run_date: "2026-11-10", status: "ok", error: null, at: "2026-11-10T06:01:00-03:00" });
    expect(existsSync(p)).toBe(true);
    expect(logLines(p).map((l) => l.status)).toEqual(["failed", "ok"]);
  });
});

describe("main", () => {
  it("runs 'correr' and maps --forzar", async () => {
    const s = setup();
    expect(await main(["correr"], s.deps)).toBe(0);
    expect(await main(["correr"], s.deps)).toBe(2);
    s.clock.now = new Date("2026-11-10T09:05:00Z");
    expect(await main(["correr", "--forzar"], s.deps)).toBe(0);
  });

  it("parses --categoria with --forzar in any order and rejects a missing value", () => {
    expect(parseCommand(["correr", "--categoria", "smart-tv"])).toEqual({ name: "correr", force: false, category: "smart-tv" });
    expect(parseCommand(["correr", "--forzar", "--categoria", "smart-tv"])).toEqual({ name: "correr", force: true, category: "smart-tv" });
    expect(parseCommand(["correr", "--categoria", "smart-tv", "--forzar"])).toEqual({ name: "correr", force: true, category: "smart-tv" });
    expect(parseCommand(["correr", "--forzar"])).toEqual({ name: "correr", force: true, category: null });
    expect(parseCommand(["correr", "--categoria"])).toBeNull();
    expect(parseCommand(["correr", "--categoria", "--forzar"])).toBeNull();
    expect(parseCommand(["correr", "--otra"])).toBeNull();
    expect(parseCommand(["cupones-link", "https://meli.la/x"])).toEqual({ name: "cupones-link", url: "https://meli.la/x" });
    expect(parseCommand(["cupones-link"])).toBeNull();
    expect(parseCommand(["cupones-link", "a", "b"])).toBeNull();
    expect(USAGE).toContain("imperdibles cupones-link <enlace>");
  });

  it("prints usage for help and for unknown commands", async () => {
    const s = setup();
    expect(await main(["--help"], s.deps)).toBe(0);
    expect(s.out.join("")).toBe(USAGE);
    expect(await main(["bailar"], s.deps)).toBe(2);
    expect(s.err.join("")).toContain(USAGE);
    expect(s.fetched).toEqual([]);
  });
});
