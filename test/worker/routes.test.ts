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
    TELEGRAM_CHANNEL_URL: "https://t.me/x",
    ...over,
  } as unknown as Env;
  return { db, env, now: () => NOW, telegram };
}

const url = (p: string) => `https://imperdibles.ar${p}`;
const webhook = (headers: Record<string, string>, body = "{}", method = "POST") =>
  new Request(url("/telegram/webhook"), { method, headers, body: method === "POST" ? body : undefined });

const VALID_PAYLOAD = JSON.stringify({
  candidato_id: "c1", modelo_id: "A:1", marca: "Fake", titulo: "Aspiradora", imagen_url: null,
  ml: { tienda: "ml", titulo_listado: "x", url: "https://e.test/ml", precio_ars: 329999, observado_en: "2026-11-10T10:00:00-03:00", ref_externa: "m", vendedor: null, ml_product_id: "MLA1", ml_seller_id: "1" },
  otras: [{ tienda: "fravega", titulo_listado: "x", url: "https://e.test/f", precio_ars: 399999, observado_en: "2026-11-10T10:00:00-03:00", ref_externa: "f", vendedor: null }],
  diferencia_ars: 70000, diferencia_pct: 17.5, confianza: "alta", regla_emparejado: "gtin",
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
    const { corridaId } = await seedRun(db, { fecha: "2026-11-10", modeloIds: ["A:1"] });
    await db.run(
      "INSERT INTO candidatos (id, corrida_id, modelo_id, payload, estado, enlace_afiliado, telegram_file_id, validado_en) VALUES ('c1', ?, 'A:1', ?, 'validado', 'https://meli.la/2AbC', 'fid', '2026-11-10T10:50:00-03:00')",
      [corridaId, VALID_PAYLOAD],
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
    expect((await handleFetch(new Request(url("/healthz"), { method: "POST" }), deps())).status).toBe(405);
  });
});

describe("handleScheduled", () => {
  it("07:30 cron runs the missing-run check", async () => {
    await handleScheduled("30 10 * * *", deps());
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegram.sendPhoto).not.toHaveBeenCalled();
  });

  it("11:00 cron runs publishValidated: a validated candidate is posted to the channel", async () => {
    const { corridaId } = await seedRun(db, { fecha: "2026-11-10", modeloIds: ["A:1"] });
    await db.run(
      "INSERT INTO candidatos (id, corrida_id, modelo_id, payload, estado, enlace_afiliado, telegram_file_id, validado_en) VALUES ('c1', ?, 'A:1', ?, 'validado', 'https://meli.la/2AbC', 'fid', '2026-11-10T10:50:00-03:00')",
      [corridaId, VALID_PAYLOAD],
    );
    await handleScheduled("0 14 * * *", deps());
    const channelPosts = telegram.sendPhoto.mock.calls.filter(([p]) => p.chat_id === "-100");
    expect(channelPosts).toHaveLength(1);
    const rows = await db.all<{ estado: string }>("SELECT estado FROM candidatos");
    expect(rows[0]?.estado).toBe("publicado");
  });

  it("rejects an unknown cron", async () => {
    await expect(handleScheduled("1 2 * * *", deps())).rejects.toThrow();
  });
});
