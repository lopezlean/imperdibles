import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TelegramClient } from "../../src/output/telegram/client.js";
import type { WorkerDeps } from "../../src/worker/deps.js";
import type { Env } from "../../src/worker/env.js";
import { handleFetch } from "../../src/worker/index.js";
import { regeneratePages, servePage } from "../../src/worker/page-store.js";
import { createSqliteClient } from "../support/sqlite-client.js";
import { seedRun } from "./support/seed.js";

const CHANNEL_URL = "https://t.me/page_store_test";
const PUBLISH_AT = new Date("2026-11-10T14:30:00Z"); // 11:30 ART
const SAME_DAY = new Date("2026-11-10T15:00:00Z");
const NEXT_DAY = new Date("2026-11-11T12:00:00Z");
const FRESH = "2026-11-10T11:05:00-03:00";

type Db = ReturnType<typeof createSqliteClient>;
let db: Db;

function payloadFor(title: string, ml = 329999, rival = 399999): string {
  const offer = (store: string, price: number) => ({
    store,
    listing_title: title,
    url: `https://example.test/${store}`,
    price_ars: price,
    observed_at: "2026-11-10T10:00:00-03:00",
    external_ref: `${store}-1`,
    seller: null,
  });
  return JSON.stringify({
    candidate_id: "x",
    model_id: "x",
    brand: "Fake",
    title,
    image_url: null,
    ml: { ...offer("ml", ml), ml_product_id: "MLA1", ml_seller_id: "1" },
    others: [offer("fravega", rival)],
    difference_ars: rival - ml,
    difference_pct: 17.5,
    confidence: "high",
    match_rule: "gtin",
  });
}

async function addCandidate(
  id: string,
  runId: string,
  modelId: string,
  o: { status?: string; title?: string; ml?: number; rival?: number; link?: string | null; publishedAt?: string } = {},
) {
  const status = o.status ?? "published";
  await db.run(
    "INSERT INTO candidates (id, run_id, model_id, payload, status, affiliate_link, telegram_file_id, validated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      runId,
      modelId,
      payloadFor(o.title ?? `Robot ${id}`, o.ml, o.rival),
      status,
      o.link === undefined ? `https://meli.la/${id}` : o.link,
      `file-${id}`,
      FRESH,
    ],
  );
  if (o.publishedAt) {
    await db.run("INSERT INTO posts (candidate_id, channel, external_message_id, published_at) VALUES (?, 'telegram_channel', '1', ?)", [
      id,
      o.publishedAt,
    ]);
  }
}

const deps = (now: Date) => ({ db, now: () => now, channelUrl: CHANNEL_URL });
const pageKeys = async () => (await db.all<{ page_key: string }>("SELECT page_key FROM pages ORDER BY page_key")).map((r) => r.page_key);

function workerDeps(now: Date, telegram?: TelegramClient): WorkerDeps {
  const env = {
    TELEGRAM_BOT_TOKEN: "t",
    TELEGRAM_OWNER_CHAT_ID: "42",
    TELEGRAM_CHANNEL_ID: "-100",
    TELEGRAM_WEBHOOK_SECRET: "hook",
    PUBLISH_NOW_SECRET: "pub-secret",
    TELEGRAM_CHANNEL_URL: CHANNEL_URL,
  } as unknown as Env;
  return { db, env, now: () => now, telegram };
}

const fakeTelegram = (): TelegramClient =>
  ({
    sendMessage: vi.fn(async () => ({ message_id: 1 })),
    sendPhoto: vi.fn(async () => ({ message_id: 2, file_id: "f" })),
  }) as unknown as TelegramClient;

const publishNow = (now: Date, tg = fakeTelegram()) =>
  handleFetch(
    new Request("https://imperdibles.ar/internal/publish-now", { method: "POST", headers: { Authorization: "Bearer pub-secret" } }),
    workerDeps(now, tg),
  );
const getHome = (now: Date, method = "GET") => handleFetch(new Request("https://imperdibles.ar/", { method }), workerDeps(now));

beforeEach(() => {
  db = createSqliteClient();
});

describe("regeneratePages", () => {
  it("writes today:<run_date> and archive for the latest day with published candidates", async () => {
    await seedRun(db, { run_date: "2026-11-09", modelIds: ["A:0"], runId: "r0" });
    await seedRun(db, { run_date: "2026-11-10", modelIds: ["A:1"], runId: "r1" });
    await db.run("UPDATE runs SET models_compared = 37 WHERE id = 'r1'");
    await addCandidate("c0", "r0", "A:0", { title: "Robot viejo" });
    await addCandidate("c1", "r1", "A:1", { title: "Robot nuevo" });
    await regeneratePages(deps(SAME_DAY));
    expect(await pageKeys()).toEqual(["archive", "today:2026-11-10"]);
    const rows = await db.all<{ page_key: string; html: string }>("SELECT page_key, html FROM pages");
    for (const r of rows) {
      expect(r.html).toContain("Robot nuevo");
      expect(r.html).not.toContain("Robot viejo");
      expect(r.html).toContain("37");
      expect(r.html).toContain("Aspiradoras robot");
      expect(r.html).toContain("https://meli.la/c1");
    }
    expect(rows.find((r) => r.page_key === "today:2026-11-10")?.html).toContain("Los imperdibles de hoy");
    expect(rows.find((r) => r.page_key === "archive")?.html).toContain("Los imperdibles del 10 de noviembre de 2026");
  });

  it("writes only archive in mode none when nothing was ever published", async () => {
    await seedRun(db, { run_date: "2026-11-10", modelIds: ["A:1"], runId: "r1" });
    await addCandidate("c1", "r1", "A:1", { status: "validated" });
    await regeneratePages(deps(SAME_DAY));
    expect(await pageKeys()).toEqual(["archive"]);
    const [row] = await db.all<{ html: string }>("SELECT html FROM pages");
    expect(row?.html).toContain("Todavía no hay imperdibles publicados.");
  });

  it("ignores published candidates without an affiliate link", async () => {
    await seedRun(db, { run_date: "2026-11-10", modelIds: ["A:1"], runId: "r1" });
    await addCandidate("c1", "r1", "A:1", { link: null });
    await regeneratePages(deps(SAME_DAY));
    expect(await pageKeys()).toEqual(["archive"]);
  });

  it("orders by descending percentage, then title", async () => {
    await seedRun(db, { run_date: "2026-11-10", modelIds: ["A:1", "A:2", "A:3"], runId: "r1" });
    await addCandidate("c1", "r1", "A:1", { title: "Zeta robot", ml: 80, rival: 100 }); // 20.0%
    await addCandidate("c2", "r1", "A:2", { title: "Alfa robot", ml: 80, rival: 100 }); // 20.0%
    await addCandidate("c3", "r1", "A:3", { title: "Mayor robot", ml: 50, rival: 100 }); // 50.0%
    await regeneratePages(deps(SAME_DAY));
    const [row] = await db.all<{ html: string }>("SELECT html FROM pages WHERE page_key = 'archive'");
    const html = row?.html ?? "";
    const at = (t: string) => html.indexOf(t);
    expect(at("Mayor robot")).toBeGreaterThan(-1);
    expect(at("Mayor robot")).toBeLessThan(at("Alfa robot"));
    expect(at("Alfa robot")).toBeLessThan(at("Zeta robot"));
  });

  it("keeps only the earliest-published candidate per model", async () => {
    await seedRun(db, { run_date: "2026-11-10", modelIds: ["A:1"], runId: "r1" });
    await addCandidate("c1", "r1", "A:1", { title: "Segundo", publishedAt: "2026-11-10T11:10:00-03:00" });
    await addCandidate("c2", "r1", "A:1", { title: "Primero", publishedAt: "2026-11-10T11:05:00-03:00" });
    await regeneratePages(deps(SAME_DAY));
    const [row] = await db.all<{ html: string }>("SELECT html FROM pages WHERE page_key = 'archive'");
    expect(row?.html).toContain("Primero");
    expect(row?.html).not.toContain("Segundo");
  });

  it("replaces the previous rows on a second run", async () => {
    await seedRun(db, { run_date: "2026-11-10", modelIds: ["A:1", "A:2"], runId: "r1" });
    await addCandidate("c1", "r1", "A:1", { title: "Primero" });
    await regeneratePages(deps(SAME_DAY));
    await addCandidate("c2", "r1", "A:2", { title: "Segundo" });
    await regeneratePages(deps(SAME_DAY));
    expect(await pageKeys()).toEqual(["archive", "today:2026-11-10"]);
    const [row] = await db.all<{ html: string }>("SELECT html FROM pages WHERE page_key = 'archive'");
    expect(row?.html).toContain("Segundo");
  });

  it("writes nothing when rendering cannot complete", async () => {
    await seedRun(db, { run_date: "2026-11-10", modelIds: ["A:1"], runId: "r1" });
    await addCandidate("c1", "r1", "A:1");
    await db.run("UPDATE config SET value = '{not json' WHERE name = 'categories'");
    await expect(regeneratePages(deps(SAME_DAY))).rejects.toThrow();
    expect(await pageKeys()).toEqual([]);
  });
});

describe("servePage", () => {
  it("serves the empty-database page with the cache headers", async () => {
    const res = await servePage(deps(SAME_DAY));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const html = await res.text();
    expect(html).toContain("Todavía no hay imperdibles publicados.");
    expect(html).toContain(CHANNEL_URL);
  });

  it("serves the day page after publication, the archive the next day", async () => {
    await seedRun(db, { run_date: "2026-11-10", modelIds: ["A:1"], runId: "r1" });
    await addCandidate("c1", "r1", "A:1", { status: "validated", publishedAt: undefined });
    const res = await publishNow(PUBLISH_AT);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { published: string[] }).published).toEqual(["c1"]);

    const same = await (await getHome(SAME_DAY)).text();
    expect(same).toContain("Los imperdibles de hoy");
    expect(same).toContain("https://meli.la/c1");
    expect(same).toContain('rel="sponsored noopener"');

    const next = await (await getHome(NEXT_DAY)).text();
    expect(next).toContain("Los imperdibles del 10 de noviembre de 2026");
    expect(next).not.toContain("Los imperdibles de hoy");
  });

  it("issues exactly one SQL query on the normal path", async () => {
    await seedRun(db, { run_date: "2026-11-10", modelIds: ["A:1"], runId: "r1" });
    await addCandidate("c1", "r1", "A:1");
    await regeneratePages(deps(SAME_DAY));
    const all = vi.spyOn(db, "all");
    const run = vi.spyOn(db, "run");
    const res = await servePage(deps(SAME_DAY));
    expect(res.status).toBe(200);
    expect(all).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    const next = await servePage(deps(NEXT_DAY));
    expect(next.status).toBe(200);
    expect(all).toHaveBeenCalledTimes(2);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("GET / route", () => {
  it("answers HEAD with the headers and no body", async () => {
    const res = await getHome(SAME_DAY, "HEAD");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe("");
  });

  it("answers 405 for other methods", async () => {
    const res = await getHome(SAME_DAY, "POST");
    expect(res.status).toBe(405);
  });
});

describe("page failure isolation", () => {
  it("keeps the publication when regenerating the page fails", async () => {
    await seedRun(db, { run_date: "2026-11-10", modelIds: ["A:1"], runId: "r1" });
    await addCandidate("c1", "r1", "A:1", { status: "validated" });
    await db.run("DROP TABLE pages");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await publishNow(PUBLISH_AT);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { published: string[] }).published).toEqual(["c1"]);
    const [c] = await db.all<{ status: string }>("SELECT status FROM candidates WHERE id = 'c1'");
    expect(c?.status).toBe("published");
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});
