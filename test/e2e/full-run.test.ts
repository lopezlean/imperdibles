import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createReplayFetch } from "../../src/data/recording.js";
import { runDaily, type RunDeps } from "../../src/data/run-daily.js";
import { runRevalidate } from "../../src/data/revalidate.js";
import { fravegaSearchUrl } from "../../src/data/stores/fravega.js";
import { createOutputHooks } from "../../src/local/output-hooks.js";
import { AFFILIATE_LEGEND } from "../../src/output/copy.js";
import { createTelegramClient } from "../../src/output/telegram/client.js";
import type { LocalEnv } from "../../src/shared/env.js";
import type { WorkerDeps } from "../../src/worker/deps.js";
import type { Env } from "../../src/worker/env.js";
import { handleFetch } from "../../src/worker/index.js";
import { dayPage, listDays, loadSiteData } from "../../site/lib/deals.js";
import { createSqliteClient } from "../support/sqlite-client.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = (...parts: string[]) => path.join(ROOT, "fixtures", ...parts);
const read = (...parts: string[]): string => readFileSync(fixture(...parts), "utf8");

const ML = "https://api.mercadolibre.com";
const searchUrl = (q: string) => `${ML}/products/search?site_id=MLA&status=active&q=${encodeURIComponent(q)}`;
const itemsUrl = (id: string) => `${ML}/products/${id}/items`;

const LINK = "https://meli.la/E2e_Test?a=1&b=2";
const OWNER = "123456789";
const CHANNEL = "-1001234567890";
const WORKER_BASE = "https://worker.test";
const PUBLISH_SECRET = "fake-publish-secret";
const WEBHOOK_SECRET = "fake-webhook-secret";
const SKIP_RECORDED = "skipped: fixtures/runs has no recording (owner records it with real ML credentials)";

const ENV: LocalEnv = {
  mlAppId: "fake-app-id",
  mlClientSecret: "fake-client-secret",
  mlRedirectUri: "https://imperdibles.com.ar",
  cfAccountId: "fake-account",
  cfApiToken: "fake-cf-token",
  d1DatabaseId: "fake-db",
  telegramBotToken: "fake-bot-token",
  telegramOwnerChatId: OWNER,
  telegramChannelId: CHANNEL,
  publishNowSecret: PUBLISH_SECRET,
  workerBaseUrl: WORKER_BASE,
};

const urlOf = (input: Parameters<typeof fetch>[0]): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

type TelegramCall = { method: string; chat_id: string; text: string; photo: "png" | "file_id" | null };

/** Composed replay: the real Frávega listing plus the synthetic `-derived` ML files with fake ids. */
function composedRoutes(listing = "listing-aspiradoras-robot.html"): Map<string, () => Response> {
  const json = (body: string) => () => new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  const html = (body: string) => () => new Response(body, { status: 200, headers: { "content-type": "text/html" } });
  return new Map<string, () => Response>([
    [fravegaSearchUrl("aspiradora robot"), html(read("fravega", listing))],
    [fravegaSearchUrl("aspiradora robot", 1), html(read("fravega", "listing-no-results.html"))],
    [fravegaSearchUrl("Philco PHRA26N"), html(read("fravega", "listing-aspiradoras-robot.html"))],
    [searchUrl("Philco PHRA26N"), json(read("ml", "products-search-philco-phra26n-derived.json"))],
    [itemsUrl("MLA00000011"), json(read("ml", "product-items-philco-derived.json"))],
    [searchUrl("Irobot M611330"), json(read("ml", "products-search-irobot-m611330-derived.json"))],
    [itemsUrl("MLA00000012"), json(read("ml", "product-items-irobot-derived.json"))],
    [searchUrl("Smartlife SLRVCL050"), json(read("ml", "product-items-empty-derived.json"))],
    [searchUrl("SL-RVCL050"), json(read("ml", "product-items-empty-derived.json"))],
  ]);
}

const routedReplay =
  (routes: Map<string, () => Response>): typeof fetch =>
  async (input) => {
    const url = urlOf(input);
    const route = routes.get(url);
    if (!route) throw new Error(`unrecorded URL: ${url}`);
    return route();
  };

/** One world: a sqlite database, a fake Telegram, the real Worker handlers and the real local hooks behind one fetch. */
function createWorld(replay: typeof fetch, startIso: string) {
  const db = createSqliteClient();
  // These tests replay a Frávega-only world; the VTEX stores seeded by 0003 have their own tests.
  db.raw.exec("UPDATE stores SET enabled = 0 WHERE id IN ('jumbo', 'easy', 'coppel')");
  db.raw
    .prepare("INSERT INTO ml_tokens (id, access_token, refresh_token, expires_at) VALUES (1, 'fake-access', 'fake-refresh', '2099-01-01T00:00:00.000Z')")
    .run();
  const clock = { now: new Date(startIso) };
  const calls: TelegramCall[] = [];
  const workerRequests: string[] = [];
  let messageId = 100;
  let fileId = 0;

  const fakeTelegram: typeof fetch = async (input, init) => {
    const method = urlOf(input).split("/").at(-1)!;
    let chat_id = "";
    let text = "";
    let photo: TelegramCall["photo"] = null;
    if (init?.body instanceof FormData) {
      chat_id = String(init.body.get("chat_id"));
      text = String(init.body.get("caption") ?? "");
      photo = "png";
    } else {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      chat_id = String(body.chat_id);
      text = String(body.caption ?? body.text ?? "");
      photo = method === "sendPhoto" ? "file_id" : null;
    }
    calls.push({ method, chat_id, text, photo });
    const result =
      method === "sendPhoto"
        ? { message_id: ++messageId, photo: [{ file_id: `FAKE_SMALL_${++fileId}` }, { file_id: `FAKE_LARGE_${fileId}` }] }
        : { message_id: ++messageId };
    return Response.json({ ok: true, result });
  };

  const workerEnv = {
    TELEGRAM_BOT_TOKEN: ENV.telegramBotToken,
    TELEGRAM_OWNER_CHAT_ID: OWNER,
    TELEGRAM_CHANNEL_ID: CHANNEL,
    TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
    PUBLISH_NOW_SECRET: PUBLISH_SECRET,
  } as unknown as Env;
  const workerDeps: WorkerDeps = {
    db,
    env: workerEnv,
    now: () => clock.now,
    telegram: createTelegramClient({ token: ENV.telegramBotToken, fetch: fakeTelegram }),
  };

  const routed: typeof fetch = async (input, init) => {
    const url = urlOf(input);
    if (url.startsWith("https://api.telegram.org/")) return fakeTelegram(input, init);
    if (url.startsWith(WORKER_BASE)) {
      workerRequests.push(new URL(url).pathname);
      return handleFetch(new Request(url, init), workerDeps);
    }
    return replay(input, init);
  };

  const runDeps: RunDeps = {
    db,
    fetch: routed,
    env: ENV,
    now: () => clock.now,
    sleep: async () => {},
    hooks: createOutputHooks({ db, env: ENV, now: () => clock.now, fetch: routed, exec: async () => 0 }),
    logPath: path.join(mkdtempSync(path.join(tmpdir(), "imperdibles-e2e-")), "var", "run-log.jsonl"),
    stdout: () => {},
    stderr: () => {},
  };

  const at = (iso: string) => void (clock.now = new Date(iso));
  const publishNow = () =>
    handleFetch(
      new Request(`${WORKER_BASE}/internal/publish-now`, { method: "POST", headers: { Authorization: `Bearer ${PUBLISH_SECRET}` } }),
      workerDeps,
    );
  const reply = (replyTo: number, text: string) =>
    handleFetch(
      new Request(`${WORKER_BASE}/telegram/webhook`, {
        method: "POST",
        headers: { "X-Telegram-Bot-Api-Secret-Token": WEBHOOK_SECRET },
        body: JSON.stringify({
          update_id: 1,
          message: { message_id: 900, chat: { id: Number(OWNER), type: "private" }, text, reply_to_message: { message_id: replyTo } },
        }),
      }),
      workerDeps,
    );
  const channelPosts = () => calls.filter((c) => c.method === "sendPhoto" && c.chat_id === CHANNEL);
  const candidates = () =>
    db.all<{ id: string; status: string; telegram_message_id: number | null; telegram_file_id: string | null; affiliate_link: string | null }>(
      "SELECT id, status, telegram_message_id, telegram_file_id, affiliate_link FROM candidates ORDER BY id",
    );
  const posts = () => db.all<{ channel: string }>("SELECT channel FROM posts ORDER BY channel").then((r) => r.map((x) => x.channel));

  return { db, runDeps, at, publishNow, reply, channelPosts, candidates, posts, calls, workerRequests, workerDeps };
}
type World = ReturnType<typeof createWorld>;

/** Daily run at 10:00 ART, the owner's reply at 10:20, and returns the chosen candidate's id. */
async function collectAndChoose(w: World, date: string): Promise<string> {
  w.at(`${date}T10:00:00-03:00`);
  expect((await runDaily(w.runDeps, { force: false, category: "aspiradoras-robot" })).exitCode).toBe(0);
  const pending = await w.candidates();
  expect(pending.length).toBeGreaterThan(0);
  for (const c of pending) {
    expect(c.status).toBe("pending");
    expect(c.telegram_message_id).not.toBeNull();
  }
  w.at(`${date}T10:20:00-03:00`);
  const first = pending[0]!;
  const res = await w.reply(first.telegram_message_id!, LINK);
  expect(res.status).toBe(200);
  const [chosen] = await w.candidates().then((rows) => rows.filter((r) => r.id === first.id));
  expect(chosen!.status).toBe("chosen");
  expect(Buffer.from(chosen!.affiliate_link!).equals(Buffer.from(LINK))).toBe(true);
  return first.id;
}

/** What the static site would publish: the day page built from the same database the Worker wrote to. */
async function expectPublishedDay(w: World, runDate: string): Promise<void> {
  const data = await loadSiteData(w.db);
  const page = dayPage(data, runDate);
  expect(page).not.toBeNull();
  expect(page!.items).toHaveLength(1);
  const [deal] = page!.items;
  expect(deal!.candidate.title).toEqual(expect.any(String));
  expect(deal!.candidate.title.length).toBeGreaterThan(0);
  expect(deal!.affiliate_link).toBe(LINK);
}

describe("end to end: replayed data to the published deals", () => {
  it(
    "publishes at 11:00 with one rival: shortlist, reply, revalidate, scheduled post, page",
    async () => {
      const w = createWorld(routedReplay(composedRoutes()), "2026-11-10T10:00:00-03:00");
      const id = await collectAndChoose(w, "2026-11-10");
      expect(w.calls.filter((c) => c.chat_id === OWNER && c.method === "sendPhoto" && c.photo === "png")).toHaveLength(1);

      w.at("2026-11-10T10:45:00-03:00"); // before publish_time: the hook must not ask for an early post
      expect(await runRevalidate(w.runDeps)).toBe(0);
      expect((await w.candidates()).find((c) => c.id === id)!.status).toBe("validated");
      expect(w.workerRequests).toEqual([]);
      expect(w.channelPosts()).toHaveLength(0);

      w.at("2026-11-10T11:00:00-03:00"); // 15 minutes after validated_at
      expect((await w.publishNow()).status).toBe(200);
      const posts = w.channelPosts();
      expect(posts).toHaveLength(1);
      expect(posts[0]!.photo).toBe("file_id");
      expect(posts[0]!.text).toContain(LINK);
      expect(posts[0]!.text).toContain(AFFILIATE_LEGEND);
      expect(await w.posts()).toEqual(["telegram_channel", "x_manual"]); // the channel post and the X material for the owner
      expect((await w.candidates()).find((c) => c.id === id)!.status).toBe("published");

      await expectPublishedDay(w, "2026-11-10");
    },
    60_000,
  );

  it(
    "publishes once when revalidation runs after 11:00 and the hook ships (build and upload stubbed), and a further publish-now adds nothing",
    async () => {
      const w = createWorld(routedReplay(composedRoutes()), "2026-11-10T10:00:00-03:00");
      await collectAndChoose(w, "2026-11-10");

      w.at("2026-11-10T11:05:00-03:00");
      expect(await runRevalidate(w.runDeps)).toBe(0);
      // ship loops until a call publishes nothing: one call that publishes, one that does not
      expect(w.workerRequests).toEqual(["/internal/publish-now", "/internal/publish-now"]);
      expect(w.channelPosts()).toHaveLength(1);

      expect((await w.publishNow()).status).toBe(200);
      expect(w.channelPosts()).toHaveLength(1);
      expect(await w.posts()).toEqual(["telegram_channel", "x_manual"]);
      await expectPublishedDay(w, "2026-11-10");
    },
    60_000,
  );

  it(
    "publishes no days when the replay listing has no results",
    async () => {
      const w = createWorld(routedReplay(composedRoutes("listing-no-results.html")), "2026-11-10T10:00:00-03:00");
      w.at("2026-11-10T10:00:00-03:00");
      expect((await runDaily(w.runDeps, { force: false, category: "aspiradoras-robot" })).exitCode).toBe(0);
      expect(await w.candidates()).toEqual([]);
      expect(listDays(await loadSiteData(w.db))).toEqual([]);
      expect(w.channelPosts()).toHaveLength(0);
    },
    60_000,
  );
});

// The owner records the real run with `pnpm fixtures:record run aspiradoras-robot`.
const RUNS_DIR = fixture("runs");
const recorded = existsSync(RUNS_DIR)
  ? readdirSync(RUNS_DIR).filter((d) => /^\d{4}-\d{2}-\d{2}-aspiradoras-robot$/.test(d)).sort().at(-1)
  : undefined;

describe.skipIf(recorded === undefined)(recorded === undefined ? SKIP_RECORDED : "end to end: recorded run", () => {
  it(
    "runs the same flow on the recorded replay",
    async () => {
      const date = recorded!.slice(0, 10);
      const w = createWorld(createReplayFetch(path.join(RUNS_DIR, recorded!)), `${date}T10:00:00-03:00`);
      const id = await collectAndChoose(w, date);
      w.at(`${date}T10:45:00-03:00`);
      expect(await runRevalidate(w.runDeps)).toBe(0);
      expect((await w.candidates()).find((c) => c.id === id)!.status).toBe("validated");
      w.at(`${date}T11:00:00-03:00`);
      expect((await w.publishNow()).status).toBe(200);
      expect(w.channelPosts()).toHaveLength(1);
      expect(w.channelPosts()[0]!.text).toContain(LINK);
      expect(w.channelPosts()[0]!.text).toContain(AFFILIATE_LEGEND);
      await expectPublishedDay(w, date);
    },
    120_000,
  );
});
