import { describe, expect, it } from "vitest";
import type { ExtractedCoupon } from "../../../src/contract/coupon.js";
import { ExtractionError, type CouponExtractor } from "../../../src/local/coupons/extractor.js";
import { ingestCoupons, MAX_EXTRACTION_ATTEMPTS, type IngestDeps } from "../../../src/local/coupons/ingest.js";
import type { ChannelPost, ChannelReader } from "../../../src/local/coupons/reader.js";
import { CONFIG_CURSOR, CONFIG_LINK, getConfig, getPost, setConfig } from "../../../src/local/coupons/repo.js";
import type { SqlClient } from "../../../src/shared/db/sql-client.js";
import { postById } from "../../support/coupon-fixtures.js";
import { createSqliteClient } from "../../support/sqlite-client.js";

const LINK = "https://meli.la/2AbC_xY?r=1/";
const CHANNEL = "-100123";
const OWNER = "owner";

type Sent = { chat_id: string; text: string };

function fixturePost(id: number): ChannelPost {
  const p = postById(id);
  return { id: p.id, text: p.text, date: p.postedAt };
}

const CHEEKY_TEXT = "Cupón CHEEKY: $5.000 OFF. Compra mínima $50.000";
const cheeky = (over: Partial<ExtractedCoupon> = {}): ExtractedCoupon => ({
  code: "CHEEKY",
  discount_type: "amount",
  discount_value: 5000,
  min_purchase: 50000,
  cap: null,
  scope: "",
  valid_from: null,
  valid_until: null,
  ...over,
});

function setup(opts: { posts: ChannelPost[]; extract?: Map<number, ExtractedCoupon[] | Error>; now: string; failChannelFor?: Set<string> }) {
  const db = createSqliteClient();
  const sent: Sent[] = [];
  const calls: { afterId: number | null; since: Date }[] = [];
  let posts = opts.posts;
  let extractMap = opts.extract ?? new Map<number, ExtractedCoupon[] | Error>();
  let nowIso = opts.now;
  const failChannelFor = opts.failChannelFor ?? new Set<string>();
  let nextMessageId = 1000;

  const reader: ChannelReader = {
    async fetchPosts(o) {
      calls.push(o);
      return posts.filter((p) => (o.afterId !== null ? p.id > o.afterId : p.date.getTime() >= o.since.getTime())).sort((a, b) => a.id - b.id);
    },
  };
  const extractor: CouponExtractor = {
    async extract(post) {
      const id = posts.find((p) => p.text === post.text)!.id;
      const result = extractMap.get(id);
      if (result === undefined) return [];
      if (result instanceof Error) throw result;
      return result;
    },
  };
  const telegram: IngestDeps["telegram"] = {
    async sendMessage(p) {
      for (const code of failChannelFor) {
        if (p.chat_id === CHANNEL && p.text.includes(code)) {
          failChannelFor.delete(code);
          throw new Error("telegram down");
        }
      }
      sent.push({ chat_id: p.chat_id, text: p.text });
      return { message_id: nextMessageId++ };
    },
  };
  let dbForDeps: SqlClient = db;
  const run = () =>
    ingestCoupons({ db: dbForDeps, reader, extractor, telegram, channelId: CHANNEL, ownerChatId: OWNER, now: () => new Date(nowIso) });
  return {
    db,
    sent,
    calls,
    run,
    setLink: () => setConfig(db, CONFIG_LINK, LINK),
    set: (next: { posts?: ChannelPost[]; extract?: Map<number, ExtractedCoupon[] | Error>; now?: string }) => {
      if (next.posts) posts = next.posts;
      if (next.extract) extractMap = next.extract;
      if (next.now) nowIso = next.now;
    },
    wrapDb: (wrap: (db: SqlClient) => SqlClient) => {
      dbForDeps = wrap(db);
    },
    channel: () => sent.filter((s) => s.chat_id === CHANNEL),
    owner: () => sent.filter((s) => s.chat_id === OWNER),
  };
}

const goldens = (...ids: number[]) => new Map(ids.map((id) => [id, postById(id).coupons] as const));

describe("ingestCoupons", () => {
  it("first run asks the reader for today's messages only", async () => {
    const t = setup({ posts: [], now: "2026-11-04T13:20:00.000Z" });
    await t.run();
    expect(t.calls[0]!.afterId).toBeNull();
    expect(t.calls[0]!.since.toISOString()).toBe("2026-11-04T03:00:00.000Z");
  });

  it("later runs use the cursor and advance it to the highest id read", async () => {
    const t = setup({ posts: [fixturePost(2853)], extract: goldens(2853), now: "2026-11-02T20:00:00.000Z" });
    await t.setLink();
    await t.run();
    expect(await getConfig(t.db, CONFIG_CURSOR)).toBe("2853");
    await t.run();
    expect(t.calls[1]!.afterId).toBe(2853);
  });

  it("publishes the three CYBERALMAX coupons once", async () => {
    const post = fixturePost(2874);
    const t = setup({ posts: [post], extract: goldens(2874), now: "2026-11-04T13:20:00.000Z" });
    await t.setLink();
    const report = await t.run();
    expect(report).toMatchObject({ stored: 3, published: 3 });
    expect(t.channel()).toHaveLength(3);
    expect(t.channel()[0]!.text).toContain(LINK);
    expect(t.owner()).toHaveLength(3);
    for (const n of t.owner()) expect(n.text).toContain(post.text);
    const rows = await t.db.all<{ status: string; channel_message_id: number | null; owner_message_id: number | null }>("SELECT * FROM coupons");
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.status).toBe("published");
      expect(r.channel_message_id).not.toBeNull();
      expect(r.owner_message_id).not.toBeNull();
    }
    await t.run();
    expect(t.channel()).toHaveLength(3);
  });

  it('a "siguen vigentes" reminder posts nothing', async () => {
    const t = setup({ posts: [fixturePost(2853)], extract: goldens(2853, 2863), now: "2026-11-02T20:00:00.000Z" });
    await t.setLink();
    await t.run();
    const before = t.sent.length;
    t.set({ now: "2026-11-03T17:00:00.000Z", posts: [fixturePost(2853), fixturePost(2863)] });
    const report = await t.run();
    expect(t.sent).toHaveLength(before);
    expect(report).toMatchObject({ stored: 0, duplicates: 3, published: 0 });
  });

  it("a reminder with a later valid_until extends the row without reposting", async () => {
    const t = setup({ posts: [fixturePost(2853)], extract: goldens(2853), now: "2026-11-02T20:00:00.000Z" });
    await t.setLink();
    await t.run();
    const before = t.sent.length;
    const later = postById(2863).coupons.map((c) => (c.code === "47EXTRA10" ? { ...c, valid_until: "2026-11-12" } : c));
    t.set({ now: "2026-11-03T17:00:00.000Z", posts: [fixturePost(2853), fixturePost(2863)], extract: new Map([[2863, later]]) });
    const report = await t.run();
    expect(report).toMatchObject({ extended: 1, duplicates: 2, stored: 0 });
    expect(t.sent).toHaveLength(before);
    const [row] = await t.db.all<{ valid_until: string }>("SELECT valid_until FROM coupons WHERE code = '47EXTRA10'");
    expect(row!.valid_until).toBe("2026-11-13T02:59:59.000Z");
  });

  it("a code returning after its row expired is posted again", async () => {
    const t = setup({ posts: [fixturePost(2874)], extract: goldens(2874), now: "2026-11-04T13:20:00.000Z" });
    await t.setLink();
    await t.run();
    const again: ChannelPost = { id: 3000, text: "CYBERALMAX $20.000 OFF compra mínima $250.000", date: new Date("2026-11-05T13:00:00.000Z") };
    t.set({
      posts: [fixturePost(2874), again],
      extract: new Map([[3000, [{ ...postById(2874).coupons[0]!, valid_from: null, valid_until: null }]]]),
      now: "2026-11-05T13:30:00.000Z",
    });
    const report = await t.run();
    expect(report).toMatchObject({ stored: 1, published: 1 });
    expect(t.channel()).toHaveLength(4);
    expect(await t.db.all("SELECT id FROM coupons WHERE code = 'CYBERALMAX'")).toHaveLength(2);
  });

  it("a removed coupon is not resurrected by a reminder", async () => {
    const t = setup({ posts: [fixturePost(2853)], extract: goldens(2853, 2863), now: "2026-11-02T20:00:00.000Z" });
    await t.setLink();
    await t.run();
    await t.db.run("UPDATE coupons SET status = 'removed' WHERE code = 'CHEEKY'");
    const before = t.sent.length;
    t.set({ now: "2026-11-03T17:00:00.000Z", posts: [fixturePost(2853), fixturePost(2863)] });
    const report = await t.run();
    expect(report).toMatchObject({ stored: 0, duplicates: 3, extended: 0 });
    expect(t.sent).toHaveLength(before);
    const rows = await t.db.all<{ status: string }>("SELECT status FROM coupons WHERE code = 'CHEEKY'");
    expect(rows).toEqual([{ status: "removed" }]);
  });

  it("the same code twice in one post makes one row and one channel message", async () => {
    const post: ChannelPost = { id: 3100, text: CHEEKY_TEXT, date: new Date("2026-11-03T15:00:00.000Z") };
    const t = setup({ posts: [post], extract: new Map([[3100, [cheeky(), cheeky()]]]), now: "2026-11-03T15:05:00.000Z" });
    await t.setLink();
    const report = await t.run();
    expect(report).toMatchObject({ stored: 1, published: 1 });
    expect(await t.db.all("SELECT id FROM coupons")).toHaveLength(1);
    expect(t.channel()).toHaveLength(1);
  });

  it('a guard failure sends "No publicado" with the source and stores nothing', async () => {
    const post: ChannelPost = { id: 3101, text: CHEEKY_TEXT, date: new Date("2026-11-03T15:00:00.000Z") };
    const t = setup({ posts: [post], extract: new Map([[3101, [cheeky({ code: "ZZZZ99" })]]]), now: "2026-11-03T15:05:00.000Z" });
    await t.setLink();
    const report = await t.run();
    expect(report).toMatchObject({ rejected: 1, stored: 0, published: 0 });
    expect(await t.db.all("SELECT id FROM coupons")).toHaveLength(0);
    expect(t.channel()).toHaveLength(0);
    expect(t.owner()).toHaveLength(1);
    expect(t.owner()[0]!.text).toContain("No publicado");
    expect(t.owner()[0]!.text).toContain(CHEEKY_TEXT);
    expect(t.owner()[0]!.text).toContain("ZZZZ99");
  });

  it("a post with no coupons and a post without text are marked done with no messages", async () => {
    const empty: ChannelPost = { id: 3102, text: "hola, buen día", date: new Date("2026-11-03T15:00:00.000Z") };
    const blank: ChannelPost = { id: 3103, text: "   ", date: new Date("2026-11-03T15:01:00.000Z") };
    const t = setup({ posts: [empty, blank], now: "2026-11-03T15:05:00.000Z" });
    await t.setLink();
    await t.run();
    expect(t.sent).toHaveLength(0);
    expect(await getPost(t.db, 3102)).toMatchObject({ status: "done" });
    expect(await getPost(t.db, 3103)).toMatchObject({ status: "done" });
    expect(await getConfig(t.db, CONFIG_CURSOR)).toBe("3103");
  });

  it("an already expired coupon is dropped silently", async () => {
    const post: ChannelPost = { id: 3104, text: CHEEKY_TEXT, date: new Date("2026-10-30T15:00:00.000Z") };
    const t = setup({ posts: [post], extract: new Map([[3104, [cheeky()]]]), now: "2026-11-03T15:05:00.000Z" });
    await t.setLink();
    const report = await t.run();
    expect(report).toMatchObject({ stored: 0, rejected: 0, published: 0 });
    expect(t.sent).toHaveLength(0);
    expect(await t.db.all("SELECT id FROM coupons")).toHaveLength(0);
  });

  it("extraction failure: the failed post is retried while later posts are processed", async () => {
    const a: ChannelPost = { id: 3000, text: "buen día", date: new Date("2026-11-03T14:00:00.000Z") };
    const b: ChannelPost = { id: 3001, text: "cupón roto", date: new Date("2026-11-03T14:10:00.000Z") };
    const c: ChannelPost = { id: 3002, text: CHEEKY_TEXT, date: new Date("2026-11-03T14:20:00.000Z") };
    const extract = new Map<number, ExtractedCoupon[] | Error>([
      [3001, new ExtractionError("invalid output")],
      [3002, [cheeky()]],
    ]);
    const t = setup({ posts: [a, b, c], extract, now: "2026-11-03T15:00:00.000Z" });
    await t.setLink();

    const first = await t.run();
    expect(first).toMatchObject({ failedPosts: 1, stored: 1, published: 1 });
    expect(await getConfig(t.db, CONFIG_CURSOR)).toBe("3000");
    expect(await getPost(t.db, 3001)).toMatchObject({ status: "failed", attempts: 1 });
    expect(await getPost(t.db, 3002)).toMatchObject({ status: "done" });

    await t.run();
    expect(await getPost(t.db, 3001)).toMatchObject({ status: "failed", attempts: 2 });
    expect(await getConfig(t.db, CONFIG_CURSOR)).toBe("3000");
    expect(t.channel()).toHaveLength(1);

    await t.run();
    expect(MAX_EXTRACTION_ATTEMPTS).toBe(3);
    expect(await getPost(t.db, 3001)).toMatchObject({ status: "skipped", attempts: 3 });
    expect(await getConfig(t.db, CONFIG_CURSOR)).toBe("3002");
    const notices = t.owner().filter((m) => m.text.includes("no se pudo leer el mensaje tras 3 intentos"));
    expect(notices).toHaveLength(1);
    expect(notices[0]!.text).toContain("cupón roto");

    await t.run();
    expect(t.owner().filter((m) => m.text.includes("no se pudo leer el mensaje tras 3 intentos"))).toHaveLength(1);
  });

  it("a failed post that succeeds on retry is stored and the cursor moves on", async () => {
    const b: ChannelPost = { id: 3001, text: CHEEKY_TEXT, date: new Date("2026-11-03T14:10:00.000Z") };
    const t = setup({ posts: [b], extract: new Map([[3001, new Error("boom")]]), now: "2026-11-03T15:00:00.000Z" });
    await t.setLink();
    await t.run();
    expect(await getConfig(t.db, CONFIG_CURSOR)).toBe("3000");
    t.set({ extract: new Map([[3001, [cheeky()]]]) });
    const report = await t.run();
    expect(report).toMatchObject({ stored: 1, published: 1 });
    expect(await getPost(t.db, 3001)).toMatchObject({ status: "done" });
    expect(await getConfig(t.db, CONFIG_CURSOR)).toBe("3001");
  });

  it("without a configured link coupons stay pending, nothing goes to the channel, and the owner is told once per day", async () => {
    const post: ChannelPost = { id: 3200, text: CHEEKY_TEXT, date: new Date("2026-11-03T15:00:00.000Z") };
    const t = setup({ posts: [post], extract: new Map([[3200, [cheeky({ valid_until: "2026-11-10" })]]]), now: "2026-11-03T15:05:00.000Z" });
    const first = await t.run();
    expect(first).toMatchObject({ stored: 1, published: 0 });
    expect(t.channel()).toHaveLength(0);
    expect(t.owner()).toHaveLength(1);
    expect(t.owner()[0]!.text).toBe("Hay cupones nuevos pero falta el enlace de afiliado. Ejecutar: imperdibles cupones-link <enlace meli.la>.");
    expect((await t.db.all<{ status: string }>("SELECT status FROM coupons"))[0]!.status).toBe("pending");

    t.set({ now: "2026-11-03T19:00:00.000Z" });
    await t.run();
    expect(t.owner()).toHaveLength(1);

    t.set({ now: "2026-11-04T12:00:00.000Z" });
    await t.run();
    expect(t.owner()).toHaveLength(2);

    await t.setLink();
    const report = await t.run();
    expect(report.published).toBe(1);
    expect(t.channel()).toHaveLength(1);
    expect(t.channel()[0]!.text).toContain(LINK);
  });

  it("a pending coupon that expired before publishing is not posted", async () => {
    const t = setup({ posts: [fixturePost(2874)], extract: goldens(2874), now: "2026-11-04T13:20:00.000Z" });
    await t.run();
    expect(t.channel()).toHaveLength(0);
    await t.setLink();
    t.set({ now: "2026-11-05T13:00:00.000Z" });
    const report = await t.run();
    expect(report.published).toBe(0);
    expect(t.channel()).toHaveLength(0);
  });

  it("claim-before-send: a lost claim sends nothing for that row", async () => {
    const t = setup({ posts: [fixturePost(2874)], extract: goldens(2874), now: "2026-11-04T13:20:00.000Z" });
    await t.setLink();
    let lost = false;
    t.wrapDb((db) => ({
      all: (sql, params) => db.all(sql, params),
      run: async (sql, params) => {
        if (!lost && sql.includes("SET status = 'published'")) {
          lost = true;
          return { changes: 0 };
        }
        return db.run(sql, params);
      },
    }));
    const report = await t.run();
    expect(lost).toBe(true);
    expect(report.published).toBe(2);
    expect(t.channel()).toHaveLength(2);
    const pending = await t.db.all("SELECT id FROM coupons WHERE status = 'pending'");
    expect(pending).toHaveLength(1);
  });

  it("a failed channel send releases the claim, alerts the owner and the next run sends it", async () => {
    const t = setup({ posts: [fixturePost(2874)], extract: goldens(2874), now: "2026-11-04T13:20:00.000Z", failChannelFor: new Set(["MELIROMPETODO"]) });
    await t.setLink();
    const first = await t.run();
    expect(first.published).toBe(2);
    expect(t.channel()).toHaveLength(2);
    expect(t.owner().some((m) => m.text === "No se pudo publicar el cupón MELIROMPETODO en el canal. Se reintenta en la próxima revalidación.")).toBe(true);
    const rows = await t.db.all<{ code: string; status: string }>("SELECT code, status FROM coupons ORDER BY id");
    expect(rows.find((r) => r.code === "MELIROMPETODO")!.status).toBe("pending");

    const second = await t.run();
    expect(second.published).toBe(1);
    expect(t.channel()).toHaveLength(3);
    expect(t.channel()[2]!.text).toContain("MELIROMPETODO");
  });
});
