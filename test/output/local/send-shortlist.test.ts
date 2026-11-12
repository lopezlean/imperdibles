import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseCandidateList, type CandidateList } from "../../../src/contract/candidate-list.js";
import { createOutputHooks } from "../../../src/local/output-hooks.js";
import { sendShortlist } from "../../../src/output/local/send-shortlist.js";
import type { TelegramClient } from "../../../src/output/telegram/client.js";
import type { LocalEnv } from "../../../src/shared/env.js";
import { createSqliteClient } from "../../support/sqlite-client.js";
import { seedRun } from "../../worker/support/seed.js";

const load = (n: string) =>
  parseCandidateList(JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "lista-candidatos", n), "utf8")));

const OWNER = "42";

function twelve(): CandidateList {
  const base = load("valid-2026-11-10.json");
  const c0 = base.candidates[1]!;
  const candidates = Array.from({ length: 12 }, (_, i) => ({
    ...c0,
    candidate_id: `${base.run_id}:M${i + 1}`,
    model_id: `M${i + 1}`,
  }));
  return { ...base, candidates };
}

async function setup(list: CandidateList, withRows = true) {
  const db = createSqliteClient();
  const { runId } = await seedRun(db, { run_date: list.run_date, modelIds: list.candidates.map((c) => c.model_id) });
  // seedRun owns the run id; candidate rows must point at the list's run_id
  const run = list.run_id === runId ? runId : list.run_id;
  if (run !== runId) await db.run("UPDATE runs SET id = ?", [run]);
  if (withRows) {
    for (const c of list.candidates) {
      await db.run("INSERT INTO candidates (id, run_id, model_id, payload, status) VALUES (?, ?, ?, ?, 'pending')", [
        c.candidate_id,
        run,
        c.model_id,
        JSON.stringify(c),
      ]);
    }
  }
  return db;
}

function fakeTelegram(failPhotoFor: (n: number) => boolean = () => false) {
  const photos: unknown[] = [];
  const messages: { chat_id: string; text: string }[] = [];
  let n = 0;
  const t: TelegramClient = {
    async sendPhoto(p) {
      n++;
      if (failPhotoFor(n)) throw new Error("boom");
      photos.push(p);
      return { message_id: 1000 + n, file_id: `file-${n}` };
    },
    async sendMessage(p) {
      messages.push(p);
      return { message_id: 1 };
    },
  };
  return { t, photos, messages };
}

const render = async () => new Uint8Array([137, 80, 78, 71]);

describe("sendShortlist", () => {
  it("sends the first 10 candidates and records ids; rows 11-12 stay untouched", async () => {
    const list = twelve();
    const db = await setup(list);
    const { t, photos } = fakeTelegram();
    const r = await sendShortlist({ db, telegram: t, ownerChatId: OWNER, render }, list);
    expect(r).toEqual({ sent: 10, failed: 0 });
    expect(photos).toHaveLength(10);
    const rows = await db.all<{ id: string; telegram_file_id: string | null; telegram_message_id: number | null }>(
      "SELECT id, telegram_file_id, telegram_message_id FROM candidates ORDER BY rowid",
    );
    rows.slice(0, 10).forEach((row, i) => {
      expect(row.telegram_file_id).toBe(`file-${i + 1}`);
      expect(row.telegram_message_id).toBe(1001 + i);
    });
    for (const row of rows.slice(10)) {
      expect(row.telegram_file_id).toBeNull();
      expect(row.telegram_message_id).toBeNull();
    }
    const first = photos[0] as { chat_id: string; photo: { png: Uint8Array }; caption: string };
    expect(first.chat_id).toBe(OWNER);
    expect(first.photo.png).toBeInstanceOf(Uint8Array);
    expect(first.caption).toContain("Diferencia: $70.000");
  });

  it("sends one message when there are no candidates", async () => {
    const list = load("valid-empty.json");
    const db = await setup(list);
    const { t, photos, messages } = fakeTelegram();
    const r = await sendShortlist({ db, telegram: t, ownerChatId: OWNER, render }, list);
    expect(r).toEqual({ sent: 0, failed: 0 });
    expect(photos).toHaveLength(0);
    expect(messages).toEqual([
      { chat_id: OWNER, text: "Hoy no hay candidatos: se compararon 9 modelos y ninguno llegó al 15%." },
    ]);
  });

  it("continues after one failure and tells the owner once", async () => {
    const list = load("valid-2026-11-10.json");
    const db = await setup(list);
    const { t, photos, messages } = fakeTelegram((n) => n === 2);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await sendShortlist({ db, telegram: t, ownerChatId: OWNER, render }, list);
    err.mockRestore();
    expect(r).toEqual({ sent: 3, failed: 1 });
    expect(photos).toHaveLength(3);
    expect(messages).toEqual([
      {
        chat_id: OWNER,
        text: "No se pudieron enviar 1 candidatos de la lista de hoy. Volver a correr el comando los reintenta.",
      },
    ]);
  });

  it("a render failure counts as a failed candidate", async () => {
    const list = load("valid-2026-11-10.json");
    const db = await setup(list);
    const { t } = fakeTelegram();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await sendShortlist(
      { db, telegram: t, ownerChatId: OWNER, render: async () => Promise.reject(new Error("no render")) },
      list,
    );
    err.mockRestore();
    expect(r).toEqual({ sent: 0, failed: 4 });
  });

  it("a second run only sends rows without telegram_message_id", async () => {
    const list = load("valid-2026-11-10.json");
    const db = await setup(list);
    const first = fakeTelegram((n) => n === 2);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await sendShortlist({ db, telegram: first.t, ownerChatId: OWNER, render }, list);
    const second = fakeTelegram();
    const r = await sendShortlist({ db, telegram: second.t, ownerChatId: OWNER, render }, list);
    err.mockRestore();
    expect(r).toEqual({ sent: 1, failed: 0 });
    expect(second.photos).toHaveLength(1);
    expect((second.photos[0] as { caption: string }).caption).toContain(list.candidates[1]!.title);
    expect(second.messages).toHaveLength(0);
  });

  it("a candidate with no row is a failure, not a crash", async () => {
    const list = load("valid-2026-11-10.json");
    const db = await setup(list, false);
    const { t } = fakeTelegram();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await sendShortlist({ db, telegram: t, ownerChatId: OWNER, render }, list);
    err.mockRestore();
    expect(r.failed).toBe(4);
  });
});

const env = (over: Partial<LocalEnv> = {}): LocalEnv => ({
  mlAppId: "a",
  mlClientSecret: "b",
  mlRedirectUri: "c",
  cfAccountId: "d",
  cfApiToken: "e",
  d1DatabaseId: "f",
  telegramBotToken: "123:SECRET-TOKEN",
  telegramOwnerChatId: OWNER,
  telegramChannelId: "",
  publishNowSecret: "",
  workerBaseUrl: "",
  anthropicApiKey: "",
  anthropicModel: "",
  ...over,
});

describe("createOutputHooks", () => {
  it("throws naming the variable, never a value, when the bot token is empty", async () => {
    const db = createSqliteClient();
    let msg = "";
    try {
      createOutputHooks({ db, env: env({ telegramBotToken: "" }), now: () => new Date(), fetch });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("TELEGRAM_BOT_TOKEN");
    expect(msg).not.toContain("SECRET-TOKEN");
    expect(() => createOutputHooks({ db, env: env({ telegramOwnerChatId: "" }), now: () => new Date(), fetch })).toThrow(
      /TELEGRAM_OWNER_CHAT_ID/,
    );
  });

  it("onCandidatesReady rejects when every candidate failed to send", async () => {
    const list = load("valid-2026-11-10.json");
    const db = await setup(list);
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ ok: false, error_code: 400, description: "nope" }), { status: 400 })) as unknown as typeof fetch;
    const hooks = createOutputHooks({ db, env: env(), now: () => new Date(), fetch: fakeFetch });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(hooks.onCandidatesReady(list)).rejects.toThrow(/No se pudo enviar/);
    err.mockRestore();
  });

  it("notifyOwner sends the rendered alert to the owner chat", async () => {
    const db = createSqliteClient();
    const bodies: unknown[] = [];
    const fakeFetch = (async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
    }) as unknown as typeof fetch;
    const hooks = createOutputHooks({ db, env: env(), now: () => new Date(), fetch: fakeFetch });
    await hooks.notifyOwner({ kind: "ml_auth_required" });
    expect(bodies).toEqual([
      { chat_id: OWNER, text: "Hay que volver a autorizar Mercado Libre: pnpm ml:authorize url." },
    ]);
  });

  it("the daily path works with WORKER_BASE_URL and PUBLISH_NOW_SECRET empty", async () => {
    const list = load("valid-2026-11-10.json");
    const db = await setup(list);
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 1, photo: [{ file_id: "f" }] } }))) as unknown as typeof fetch;
    const hooks = createOutputHooks({ db, env: env(), now: () => new Date(), fetch: fakeFetch });
    await hooks.notifyOwner({ kind: "ml_auth_required" });
    // Real renderer, fake Telegram: the daily path never needs the Worker variables.
    await expect(hooks.onCandidatesReady(list)).resolves.toBeUndefined();
    const rows = await db.all<{ n: number }>("SELECT COUNT(*) AS n FROM candidates WHERE telegram_message_id IS NOT NULL");
    expect(rows[0]!.n).toBeGreaterThan(0);
  });

  it("onRevalidated rejects naming the missing variables, never values", async () => {
    const db = createSqliteClient();
    const report = { run_date: "2026-11-10", validated: [], invalidated: [] };
    const a = createOutputHooks({ db, env: env({ publishNowSecret: "s3cret" }), now: () => new Date(), fetch });
    await expect(a.onRevalidated(report)).rejects.toThrow(/WORKER_BASE_URL/);
    const msg = await a.onRevalidated(report).then(() => "", (e: Error) => e.message);
    expect(msg).not.toContain("s3cret");
    const b = createOutputHooks({ db, env: env({ workerBaseUrl: "https://w.example" }), now: () => new Date(), fetch });
    await expect(b.onRevalidated(report)).rejects.toThrow(/PUBLISH_NOW_SECRET/);
  });
});
