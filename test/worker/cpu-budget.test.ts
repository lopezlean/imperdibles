import { beforeAll, describe, expect, it } from "vitest";
import type { TelegramClient } from "../../src/output/telegram/client.js";
import type { WorkerDeps } from "../../src/worker/deps.js";
import type { Env } from "../../src/worker/env.js";
import { handleFetch, handleScheduled } from "../../src/worker/index.js";
import { createSqliteClient } from "../support/sqlite-client.js";
import { seedRun } from "./support/seed.js";

// Guard for the Cloudflare free plan (10 ms CPU per invocation). The import-closure rule (no cheerio, satori,
// resvg, better-sqlite3, dotenv, node: or runtime zod in the Worker closure) is asserted in worker-imports.test.ts.
//
// Caveat: better-sqlite3 on Node is only an approximation of D1 on workerd (D1 waits on the network, which is
// not CPU; workerd's V8 isolate differs from Node). The real check is the owner's dashboard p99 (V-O2).

const CAP_US = 8_000; // below the 10 ms limit, leaving headroom for the approximation
const WARMUP = 5;
const RUNS = 20;
const NOW = new Date("2026-11-10T14:00:00Z"); // 11:00 ART, the publish cron
const FRESH = "2026-11-10T10:45:00-03:00"; // inside the 30 minute validation window
const LINK = "https://meli.la/2AbC_xY?r=1/";
const MODELS = Array.from({ length: 10 }, (_, i) => `m${i}`);

type Db = ReturnType<typeof createSqliteClient>;
let db: Db;
let deps: WorkerDeps;

const telegram: TelegramClient = {
  sendMessage: async () => ({ message_id: 1 }),
  sendPhoto: async () => ({ message_id: 1, file_id: "f" }),
};

const offer = (store: string, price: number) => ({
  store,
  listing_title: "Robot",
  url: `https://example.test/${store}`,
  price_ars: price,
  observed_at: "2026-11-10T10:00:00-03:00",
  external_ref: `${store}-1`,
  seller: null,
});

const payload = (i: number) =>
  JSON.stringify({
    candidate_id: `c${i}`,
    model_id: `m${i}`,
    brand: "Fake",
    title: `Robot aspirador ${i}`,
    image_url: null,
    ml: { ...offer("ml", 329999), ml_product_id: "MLA1", ml_seller_id: "1" },
    others: [offer("fravega", 399999)],
    difference_ars: 70000,
    difference_pct: 17.5,
    confidence: "high",
    match_rule: "gtin",
  });

/** Median of CPU microseconds (user + system) over RUNS measured runs after WARMUP warm-ups; `prepare` is not measured. */
async function medianCpuUs(prepare: () => Promise<void>, action: () => Promise<unknown>): Promise<number> {
  const samples: number[] = [];
  for (let i = 0; i < WARMUP + RUNS; i++) {
    await prepare();
    const before = process.cpuUsage();
    await action();
    const d = process.cpuUsage(before);
    if (i >= WARMUP) samples.push(d.user + d.system);
  }
  samples.sort((a, b) => a - b);
  return (samples[RUNS / 2 - 1]! + samples[RUNS / 2]!) / 2;
}

beforeAll(async () => {
  db = createSqliteClient();
  await seedRun(db, { run_date: "2026-11-10", modelIds: MODELS, runId: "r1" });
  for (const [i, m] of MODELS.entries()) {
    await db.run(
      "INSERT INTO candidates (id, run_id, model_id, payload, status, affiliate_link, telegram_file_id, validated_at, telegram_message_id) VALUES (?, 'r1', ?, ?, 'validated', ?, ?, ?, ?)",
      [`c${i}`, m, payload(i), LINK, `file-${i}`, FRESH, 200 + i],
    );
  }
  const env = {
    TELEGRAM_BOT_TOKEN: "t",
    TELEGRAM_OWNER_CHAT_ID: "42",
    TELEGRAM_CHANNEL_ID: "-100",
    TELEGRAM_WEBHOOK_SECRET: "hook-secret",
    PUBLISH_NOW_SECRET: "pub-secret",
    TELEGRAM_CHANNEL_URL: "https://t.me/x",
  } as unknown as Env;
  deps = { db, env, now: () => NOW, telegram };
});

// Every run starts from the same full-work state: validated candidates, no posts (publish) or one pending (webhook).
const resetPublish = async () => {
  await db.run("DELETE FROM posts");
  await db.run("UPDATE candidates SET status = 'validated', affiliate_link = ?, validated_at = ?", [LINK, FRESH]);
};

describe("Worker CPU budget (cap 8 ms median)", () => {
  it("webhook: a valid affiliate link reply", async () => {
    const resetWebhook = async () => {
      await db.run("UPDATE candidates SET status = 'validated'");
      await db.run("UPDATE candidates SET status = 'pending', affiliate_link = NULL, validated_at = NULL WHERE id = 'c0'");
    };
    const update = JSON.stringify({
      update_id: 1,
      message: { message_id: 501, chat: { id: 42, type: "private" }, text: LINK, reply_to_message: { message_id: 200 } },
    });
    const req = () =>
      new Request("https://imperdibles.ar/telegram/webhook", {
        method: "POST",
        headers: { "X-Telegram-Bot-Api-Secret-Token": "hook-secret" },
        body: update,
      });
    await resetWebhook();
    const probe = await handleFetch(req(), deps);
    expect(await probe.text()).toContain("Enlace guardado");
    const us = await medianCpuUs(resetWebhook, () => handleFetch(req(), deps));
    console.log(`cpu median webhook: ${us} us`);
    expect(us).toBeLessThan(CAP_US);
  });

  it("14:00 cron: publish the capped 5 of 10 validated candidates and regenerate the pages", async () => {
    await resetPublish();
    await db.run("DELETE FROM pages");
    await handleScheduled("0 14 * * *", deps);
    const done = await db.all<{ n: number }>("SELECT COUNT(*) AS n FROM candidates WHERE status = 'published'");
    expect(done[0]!.n).toBe(5);
    const pages = await db.all<{ n: number }>("SELECT COUNT(*) AS n FROM pages");
    expect(pages[0]!.n).toBeGreaterThan(0);
    const us = await medianCpuUs(resetPublish, () => handleScheduled("0 14 * * *", deps));
    console.log(`cpu median publish cron: ${us} us`);
    expect(us).toBeLessThan(CAP_US);
  });

  it("GET /: serves the stored page with 5 published items", async () => {
    const res = await handleFetch(new Request("https://imperdibles.ar/"), deps);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Robot aspirador 0");
    const us = await medianCpuUs(async () => {}, async () => (await handleFetch(new Request("https://imperdibles.ar/"), deps)).text());
    console.log(`cpu median GET /: ${us} us`);
    expect(us).toBeLessThan(CAP_US);
  });
});
