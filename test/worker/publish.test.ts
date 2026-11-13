import { beforeEach, describe, expect, it } from "vitest";
import { categoryChannelKey } from "../../src/worker/category-channels.js";
import { buildXPost } from "../../src/output/publish/messages.js";
import { TelegramError, type TelegramClient } from "../../src/output/telegram/client.js";
import { PUBLISH_CAP_PER_CALL, publishValidated } from "../../src/worker/publish.js";
import type { SqlClient } from "../../src/shared/db/sql-client.js";
import { createSqliteClient } from "../support/sqlite-client.js";
import { seedRun } from "./support/seed.js";

const CHANNEL = "-1001";
const OWNER = "42";
const NOW = new Date("2026-11-10T14:30:00Z"); // 11:30 ART
const FRESH = "2026-11-10T11:05:00-03:00"; // 25 minutes before NOW
const OLD = "2026-11-10T10:59:00-03:00"; // 31 minutes before NOW
const LINK = "https://meli.la/2AbC_xY?r=1/";

type Db = ReturnType<typeof createSqliteClient>;
let db: Db;

function payloadFor(title: string): string {
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
    ml: { ...offer("ml", 329999), ml_product_id: "MLA1", ml_seller_id: "1" },
    others: [offer("fravega", 399999)],
    difference_ars: 70000,
    difference_pct: 17.5,
    confidence: "high",
    match_rule: "gtin",
  });
}

async function addRun(runId: string, modelIds: string[], run_date = "2026-11-10") {
  await seedRun(db, { run_date, modelIds, runId });
}

async function addCandidate(
  id: string,
  runId: string,
  modelId: string,
  o: { status?: string; validated_at?: string | null; link?: string | null; fileId?: string | null } = {},
) {
  await db.run(
    "INSERT INTO candidates (id, run_id, model_id, payload, status, affiliate_link, telegram_file_id, validated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      runId,
      modelId,
      payloadFor(`Robot ${id}`),
      o.status ?? "validated",
      o.link === undefined ? LINK : o.link,
      o.fileId === undefined ? `file-${id}` : o.fileId,
      o.validated_at === undefined ? FRESH : o.validated_at,
    ],
  );
}

type Call = { kind: "photo" | "message"; chat: string; fileId?: string; caption?: string; text?: string };

function fakeTelegram(opts: { failChannel?: (fileId: string) => unknown; failOwnerPhoto?: boolean; failMessage?: boolean } = {}) {
  const calls: Call[] = [];
  let n = 100;
  const client: TelegramClient = {
    async sendPhoto(p) {
      const fileId = "fileId" in p.photo ? p.photo.fileId : "png";
      calls.push({ kind: "photo", chat: p.chat_id, fileId, caption: p.caption });
      await Promise.resolve();
      if (p.chat_id === CHANNEL && opts.failChannel) {
        const err = opts.failChannel(fileId);
        if (err) throw err;
      }
      if (p.chat_id === OWNER && opts.failOwnerPhoto) throw new TelegramError(500, "boom");
      return { message_id: ++n, file_id: fileId };
    },
    async deleteMessage() {},
    async sendMessage(p) {
      calls.push({ kind: "message", chat: p.chat_id, text: p.text });
      if (opts.failMessage) throw new TelegramError(500, "boom");
      return { message_id: ++n };
    },
  };
  return { client, calls, channelPhotos: () => calls.filter((c) => c.kind === "photo" && c.chat === CHANNEL) };
}

const run = (tg: TelegramClient, now = NOW, client: SqlClient = db) =>
  publishValidated({ db: client, telegram: tg, channelId: CHANNEL, ownerChatId: OWNER, now: () => now });

/** A SqlClient that throws on the nth call (1-based) whose SQL matches `pattern`. */
function failingDb(pattern: RegExp, nth: number): SqlClient {
  let seen = 0;
  const hit = (sql: string) => pattern.test(sql) && ++seen === nth;
  return {
    all: async (sql, params) => {
      if (hit(sql)) throw new Error("d1 down");
      return db.all(sql, params);
    },
    run: async (sql, params) => {
      if (hit(sql)) throw new Error("d1 down");
      return db.run(sql, params);
    },
  };
}

const status = (id: string) =>
  db.all<{ status: string; telegram_file_id: string | null }>("SELECT status, telegram_file_id FROM candidates WHERE id = ?", [id]).then((r) => r[0]!);
const posts = (channel: string) =>
  db.all<{ candidate_id: string; external_message_id: string | null }>("SELECT candidate_id, external_message_id FROM posts WHERE channel = ? ORDER BY candidate_id", [channel]);

beforeEach(async () => {
  db = createSqliteClient();
  await addRun("r1", ["m1", "m2", "m3"]);
});

const CATEGORY_CHAT = "@imperdibles_robots";

describe("category channels", () => {
  it("also posts the same card to the category channel when one is configured", async () => {
    await db.run("INSERT INTO config (name, value) VALUES (?, ?)", [categoryChannelKey("aspiradoras-robot"), CATEGORY_CHAT]);
    await addCandidate("c1", "r1", "m1");
    const tg = fakeTelegram();
    await run(tg.client);
    const sent = tg.calls.filter((c) => c.kind === "photo" && c.chat === CATEGORY_CHAT);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.fileId).toBe("file-c1");
    expect(sent[0]!.caption).toContain(LINK);
  });

  it("posts nothing extra when the category has no channel", async () => {
    await addCandidate("c1", "r1", "m1");
    const tg = fakeTelegram();
    await run(tg.client);
    expect(tg.calls.filter((c) => c.kind === "photo").map((c) => c.chat)).toEqual([CHANNEL, OWNER]);
  });

  it("keeps the main post and the report when the category channel fails", async () => {
    await db.run("INSERT INTO config (name, value) VALUES (?, ?)", [categoryChannelKey("aspiradoras-robot"), CATEGORY_CHAT]);
    await addCandidate("c1", "r1", "m1");
    const tg = fakeTelegram();
    const failing: TelegramClient = {
      ...tg.client,
      sendPhoto: async (p) => {
        if (p.chat_id === CATEGORY_CHAT) throw new TelegramError(400, "chat not found");
        return tg.client.sendPhoto(p);
      },
    };
    expect(await run(failing)).toEqual({ published: ["c1"], failed: [], stale: [] });
    expect((await status("c1")).status).toBe("published");
  });
});

describe("publishValidated", () => {
  it("publishes a fresh validated candidate to the channel and records the post", async () => {
    await addCandidate("c1", "r1", "m1");
    const tg = fakeTelegram();
    const report = await run(tg.client);
    expect(report).toEqual({ published: ["c1"], failed: [], stale: [] });
    expect((await status("c1")).status).toBe("published");
    expect(tg.channelPhotos()).toHaveLength(1);
    expect(tg.channelPhotos()[0]!.fileId).toBe("file-c1");
    expect(tg.channelPhotos()[0]!.caption).toContain(LINK);
    expect(await posts("telegram_channel")).toEqual([{ candidate_id: "c1", external_message_id: "101" }]);
  });

  it("sends the owner the X material and records x_manual", async () => {
    await addCandidate("c1", "r1", "m1");
    const tg = fakeTelegram();
    await run(tg.client);
    const ownerPhoto = tg.calls.find((c) => c.kind === "photo" && c.chat === OWNER)!;
    expect(ownerPhoto.fileId).toBe("file-c1");
    const c = JSON.parse(payloadFor("Robot c1"));
    expect(ownerPhoto.caption).toBe(buildXPost(c, LINK));
    expect((await posts("x_manual")).map((s) => s.candidate_id)).toEqual(["c1"]);
  });

  it("reports a candidate validated 31 minutes ago as stale and does not send it", async () => {
    await addCandidate("c1", "r1", "m1", { validated_at: OLD });
    const tg = fakeTelegram();
    const report = await run(tg.client);
    expect(report).toEqual({ published: [], failed: [], stale: ["c1"] });
    expect(tg.calls).toHaveLength(0);
    expect((await status("c1")).status).toBe("validated");
  });

  it("ignores candidates without link, without file_id, not validated, or from another day", async () => {
    await addRun("r0", ["m9"], "2026-11-09");
    await addCandidate("a", "r1", "m1", { link: null });
    await addCandidate("b", "r1", "m2", { fileId: null });
    await addCandidate("c", "r1", "m3", { status: "chosen" });
    await addCandidate("d", "r0", "m9");
    const tg = fakeTelegram();
    const report = await run(tg.client);
    expect(report).toEqual({ published: [], failed: [], stale: [] });
    expect(tg.calls).toHaveLength(0);
  });

  it("publishes one candidate per model when --forzar made two runs the same day", async () => {
    await addRun("r2", ["m1"]);
    await addCandidate("c1", "r1", "m1");
    await addCandidate("c2", "r2", "m1");
    const tg = fakeTelegram();
    const report = await run(tg.client);
    expect(report.published).toHaveLength(1);
    expect(report.failed).toEqual([]);
    expect(tg.channelPhotos()).toHaveLength(1);
    expect(await posts("telegram_channel")).toHaveLength(1);
    const states = await db.all<{ status: string }>("SELECT status FROM candidates ORDER BY id");
    expect(states.map((s) => s.status).sort()).toEqual(["published", "validated"]);
    // A later call still leaves the sibling alone.
    const again = fakeTelegram();
    await run(again.client);
    expect(again.channelPhotos()).toHaveLength(0);
  });

  it("skips a candidate whose model already has a telegram_channel post today", async () => {
    await addRun("r2", ["m1"]);
    await addCandidate("c1", "r1", "m1", { status: "invalidated" });
    await db.run("INSERT INTO posts (candidate_id, channel, external_message_id, published_at) VALUES ('c1', 'telegram_channel', '7', 'x')");
    await addCandidate("c2", "r2", "m1");
    const tg = fakeTelegram();
    const report = await run(tg.client);
    expect(report).toEqual({ published: [], failed: [], stale: [] });
    expect(tg.calls).toHaveLength(0);
  });

  it("never sends a candidate that already has a telegram_channel post", async () => {
    await addCandidate("c1", "r1", "m1");
    await db.run("INSERT INTO posts (candidate_id, channel, external_message_id, published_at) VALUES ('c1', 'telegram_channel', '7', 'x')");
    const tg = fakeTelegram();
    const report = await run(tg.client);
    expect(report.published).toEqual([]);
    expect(tg.calls).toHaveLength(0);
  });

  it("publishes at most PUBLISH_CAP_PER_CALL candidates per call", async () => {
    const ids = Array.from({ length: 8 }, (_, i) => `m${i}`);
    await addRun("rc", ids);
    for (const [i, m] of ids.entries()) await addCandidate(`k${String(i).padStart(2, "0")}`, "rc", m);
    const tg = fakeTelegram();
    const report = await run(tg.client);
    expect(PUBLISH_CAP_PER_CALL).toBe(5);
    expect(report.published).toHaveLength(5);
    expect(tg.channelPhotos()).toHaveLength(5);
    const left = await db.all<{ n: number }>("SELECT COUNT(*) AS n FROM candidates WHERE status = 'validated'");
    expect(left[0]!.n).toBe(3);
  });

  it("rethrows when a database call fails after a successful publish", async () => {
    await addCandidate("c1", "r1", "m1");
    await addCandidate("c2", "r1", "m2");
    const tg = fakeTelegram();
    await expect(run(tg.client, NOW, failingDb(/SELECT c2\.id/, 2))).rejects.toThrow("d1 down");
    expect((await status("c1")).status).toBe("published");
    expect((await status("c2")).status).toBe("validated");
  });

  it("rethrows when the database fails before anything was published", async () => {
    await addCandidate("c1", "r1", "m1");
    await expect(run(fakeTelegram().client, NOW, failingDb(/SELECT c2\.id/, 1))).rejects.toThrow("d1 down");
  });

  it("alerts the owner and keeps going when the revert to validated fails", async () => {
    await addCandidate("c1", "r1", "m1");
    await addCandidate("c2", "r1", "m2");
    const tg = fakeTelegram({ failChannel: (fileId) => (fileId === "file-c1" ? new TelegramError(500, "boom") : undefined) });
    const report = await run(tg.client, NOW, failingDb(/SET status = 'validated'/, 1));
    expect(report.published).toEqual(["c2"]);
    expect(report.failed).toEqual(["c1"]);
    const alerts = tg.calls.filter((c) => c.kind === "message").map((c) => c.text ?? "");
    expect(alerts.some((t) => t.includes("Robot c1") && t.includes("publicado"))).toBe(true);
  });

  it("sends exactly one channel photo per candidate when run twice concurrently", async () => {
    await addCandidate("c1", "r1", "m1");
    await addCandidate("c2", "r1", "m2");
    const tg = fakeTelegram();
    const [a, b] = await Promise.all([run(tg.client), run(tg.client)]);
    expect(tg.channelPhotos()).toHaveLength(2);
    expect([...a.published, ...b.published].sort()).toEqual(["c1", "c2"]);
    expect(await posts("telegram_channel")).toHaveLength(2);
  });

  it("reverts to validated, alerts the owner and records no post after two channel failures", async () => {
    await addCandidate("c1", "r1", "m1");
    const tg = fakeTelegram({ failChannel: () => new TelegramError(500, "sendPhoto: boom") });
    const report = await run(tg.client);
    expect(report).toEqual({ published: [], failed: ["c1"], stale: [] });
    expect(tg.channelPhotos()).toHaveLength(2);
    expect((await status("c1")).status).toBe("validated");
    expect(await posts("telegram_channel")).toEqual([]);
    const alert = tg.calls.find((c) => c.kind === "message")!;
    expect(alert.chat).toBe(OWNER);
    expect(alert.text).toBe(
      "No se pudo publicar Robot c1 en el canal. Queda validado y se reintenta en la próxima revalidación.",
    );
  });

  it("retries once and publishes when the second attempt works", async () => {
    await addCandidate("c1", "r1", "m1");
    let n = 0;
    const tg = fakeTelegram({ failChannel: () => (++n === 1 ? new TelegramError(502, "sendPhoto: bad gateway") : null) });
    const report = await run(tg.client);
    expect(report.published).toEqual(["c1"]);
    expect(tg.channelPhotos()).toHaveLength(2);
  });

  it("clears telegram_file_id and alerts the owner on an invalid file_id", async () => {
    await addCandidate("c1", "r1", "m1");
    const tg = fakeTelegram({ failChannel: () => new TelegramError(400, "sendPhoto: Bad Request: wrong file identifier") });
    const report = await run(tg.client);
    expect(report.failed).toEqual(["c1"]);
    const row = await status("c1");
    expect(row).toEqual({ status: "validated", telegram_file_id: null });
    expect(tg.calls.filter((c) => c.kind === "message")).toHaveLength(1);
  });

  it("keeps going when the owner alert itself fails", async () => {
    await addCandidate("c1", "r1", "m1");
    await addCandidate("c2", "r1", "m2");
    const tg = fakeTelegram({ failChannel: (f) => (f === "file-c1" ? new TelegramError(500, "sendPhoto: boom") : null), failMessage: true });
    const report = await run(tg.client);
    expect(report).toEqual({ published: ["c2"], failed: ["c1"], stale: [] });
  });

  it("still counts the publication when the owner X photo fails", async () => {
    await addCandidate("c1", "r1", "m1");
    const tg = fakeTelegram({ failOwnerPhoto: true });
    const report = await run(tg.client);
    expect(report.published).toEqual(["c1"]);
    expect(await posts("x_manual")).toEqual([]);
  });

  it("keeps the candidate published and never reposts when the posts insert fails after a successful send", async () => {
    await addCandidate("c1", "r1", "m1");
    const failing = {
      all: db.all.bind(db),
      run: (sql: string, params?: Parameters<typeof db.run>[1]) =>
        sql.includes("INSERT INTO posts") && sql.includes("'telegram_channel'")
          ? Promise.reject(new Error("d1 unavailable"))
          : db.run(sql, params),
    };
    const tg = fakeTelegram();
    const report = await publishValidated({
      db: failing, telegram: tg.client, channelId: CHANNEL, ownerChatId: OWNER, now: () => NOW
    });
    expect(report.failed).toEqual([]);
    expect(report.published).toEqual(["c1"]);
    expect((await status("c1")).status).toBe("published");
    expect(tg.channelPhotos()).toHaveLength(1);
    expect(tg.calls.some((c) => c.kind === "message" && c.text?.startsWith("No se pudo publicar"))).toBe(false);
    const again = fakeTelegram();
    await run(again.client);
    expect(again.channelPhotos()).toHaveLength(0);
  });
});
