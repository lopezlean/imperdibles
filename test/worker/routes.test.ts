import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TelegramClient } from "../../src/output/telegram/client.js";
import { safeEqual } from "../../src/worker/auth.js";
import type { WorkerDeps } from "../../src/worker/deps.js";
import type { Env } from "../../src/worker/env.js";
import { handleFetch, handleScheduled } from "../../src/worker/index.js";
import { createSqliteClient } from "../support/sqlite-client.js";
import { seedRun } from "./support/seed.js";

const NOW = new Date("2026-11-10T14:00:00Z");
let telegram: TelegramClient & { sendMessage: ReturnType<typeof vi.fn>; sendPhoto: ReturnType<typeof vi.fn> };
let db: ReturnType<typeof createSqliteClient>;

function deps(over: Partial<Env> = {}): WorkerDeps {
  const env = {
    TELEGRAM_BOT_TOKEN: "t",
    TELEGRAM_OWNER_CHAT_ID: "42",
    TELEGRAM_CHANNEL_ID: "-100",
    TELEGRAM_WEBHOOK_SECRET: "hook-secret",
    PUBLISH_NOW_SECRET: "pub-secret",
    ...over,
  } as unknown as Env;
  return { db, env, now: () => NOW, telegram };
}

const url = (p: string) => `https://imperdibles.com.ar${p}`;
const webhook = (headers: Record<string, string>, body = "{}", method = "POST") =>
  new Request(url("/telegram/webhook"), { method, headers, body: method === "POST" ? body : undefined });

const VALID_PAYLOAD = JSON.stringify({
  candidate_id: "c1", model_id: "A:1", brand: "Fake", title: "Aspiradora", image_url: null,
  ml: { store: "ml", listing_title: "x", url: "https://e.test/ml", price_ars: 329999, observed_at: "2026-11-10T10:00:00-03:00", external_ref: "m", seller: null, ml_product_id: "MLA1", ml_seller_id: "1" },
  others: [{ store: "fravega", listing_title: "x", url: "https://e.test/f", price_ars: 399999, observed_at: "2026-11-10T10:00:00-03:00", external_ref: "f", seller: null }],
  difference_ars: 70000, difference_pct: 17.5, confidence: "high", match_rule: "gtin",
});

beforeEach(() => {
  db = createSqliteClient();
  telegram = {
    sendMessage: vi.fn(async () => ({ message_id: 1 })),
    sendPhoto: vi.fn(async () => ({ message_id: 1, file_id: "f" })),
  } as never;
});

describe("safeEqual", () => {
  it("compares strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("abcd", "abc")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("POST /telegram/webhook", () => {
  it("401 without or with a wrong secret header, db untouched", async () => {
    const spy = vi.spyOn(db, "all");
    expect((await handleFetch(webhook({}), deps())).status).toBe(401);
    expect((await handleFetch(webhook({ "X-Telegram-Bot-Api-Secret-Token": "nope" }), deps())).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("401 when the configured secret is empty, even with an empty header", async () => {
    const res = await handleFetch(webhook({ "X-Telegram-Bot-Api-Secret-Token": "" }), deps({ TELEGRAM_WEBHOOK_SECRET: "" }));
    expect(res.status).toBe(401);
  });

  it("returns the reply as JSON for an owner message", async () => {
    const update = { message: { message_id: 7, chat: { id: 42 }, text: "hola" } };
    const res = await handleFetch(webhook({ "X-Telegram-Bot-Api-Secret-Token": "hook-secret" }, JSON.stringify(update)), deps());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toMatchObject({ method: "sendMessage", chat_id: 42, reply_to_message_id: 7 });
  });

  it("empty 200 when there is nothing to reply", async () => {
    const update = { message: { message_id: 7, chat: { id: 999 }, text: "hola" } };
    const res = await handleFetch(webhook({ "X-Telegram-Bot-Api-Secret-Token": "hook-secret" }, JSON.stringify(update)), deps());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("empty 200 for an invalid JSON body", async () => {
    const res = await handleFetch(webhook({ "X-Telegram-Bot-Api-Secret-Token": "hook-secret" }, "{not json"), deps());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("405 on the wrong method", async () => {
    expect((await handleFetch(webhook({}, "", "GET"), deps())).status).toBe(405);
  });
});

describe("POST /internal/publish-now", () => {
  const post = (auth?: string) =>
    new Request(url("/internal/publish-now"), { method: "POST", headers: auth ? { Authorization: auth } : {} });

  it("401 without Bearer, with a wrong secret, or with an empty configured secret", async () => {
    expect((await handleFetch(post(), deps())).status).toBe(401);
    expect((await handleFetch(post("Bearer wrong"), deps())).status).toBe(401);
    expect((await handleFetch(post("pub-secret"), deps())).status).toBe(401);
    expect((await handleFetch(post("Bearer "), deps({ PUBLISH_NOW_SECRET: "" }))).status).toBe(401);
    expect(telegram.sendPhoto).not.toHaveBeenCalled();
  });

  it("200 with the report and publishes a validated candidate", async () => {
    const { runId } = await seedRun(db, { run_date: "2026-11-10", modelIds: ["A:1"] });
    await db.run(
      "INSERT INTO candidates (id, run_id, model_id, payload, status, affiliate_link, telegram_file_id, validated_at) VALUES ('c1', ?, 'A:1', ?, 'validated', 'https://meli.la/2AbC', 'fid', '2026-11-10T10:50:00-03:00')",
      [runId, VALID_PAYLOAD],
    );
    const res = await handleFetch(post("Bearer pub-secret"), deps());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ published: ["c1"], failed: [], stale: [] });
  });

  it("405 on the wrong method", async () => {
    const res = await handleFetch(new Request(url("/internal/publish-now")), deps());
    expect(res.status).toBe(405);
  });
});

describe("other routes", () => {
  it("404 for unknown paths, 405 for a wrong method on /healthz", async () => {
    expect((await handleFetch(new Request(url("/nada")), deps())).status).toBe(404);
  });

  it("GET / is no longer served by the Worker", async () => {
    expect((await handleFetch(new Request(url("/")), deps())).status).toBe(404);
  });

  it("404 for unknown paths, 405 for a wrong method on /healthz", async () => {
    expect((await handleFetch(new Request(url("/healthz"), { method: "POST" }), deps())).status).toBe(405);
  });
});

describe("handleScheduled", () => {
  it("07:30 cron runs the missing-run check", async () => {
    await handleScheduled("30 10 * * *", deps());
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegram.sendPhoto).not.toHaveBeenCalled();
  });

  it("the 14:00 publish cron is gone", async () => {
    await expect(handleScheduled("0 14 * * *", deps())).rejects.toThrow("unknown cron");
  });

  it("rejects an unknown cron", async () => {
    await expect(handleScheduled("1 2 * * *", deps())).rejects.toThrow();
  });
});
