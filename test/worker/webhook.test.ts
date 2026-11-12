import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { handleTelegramUpdate } from "../../src/worker/webhook.js";
import { createSqliteClient } from "../support/sqlite-client.js";
import { seedRun } from "./support/seed.js";

const OWNER = "123456789";
const NOW = new Date("2026-11-11T13:00:00Z"); // 2026-11-11 10:00 ART
const HELP = 'Para elegir un candidato, responder a su mensaje con el enlace de afiliado. Para descartarlo, responder "rechazar".';
const LINK = "https://meli.la/2AbC_xY?r=1/";

type Db = ReturnType<typeof createSqliteClient>;
let db: Db;
const CHANNEL = "-1001234";
let deleted: { chat_id: string; message_id: number }[] = [];
let deleteFails = false;
const telegram = {
  async deleteMessage(p: { chat_id: string; message_id: number }) {
    deleted.push(p);
    if (deleteFails) throw new Error("Telegram error 400: deleteMessage: Bad Request: message to delete not found");
  },
};
const deps = () => ({ db, ownerChatId: OWNER, channelId: CHANNEL, telegram, now: () => NOW });

function payload(title: string, others: { store: string; ref: string }[]): string {
  return JSON.stringify({ title, others: others.map((o) => ({ store: o.store, external_ref: o.ref })) });
}

async function candidate(id: string, opts: { run_date?: string; status?: string; msg?: number; others?: { store: string; ref: string }[] } = {}) {
  const run_date = opts.run_date ?? "2026-11-11";
  const existing = await db.all<{ id: string }>("SELECT id FROM runs WHERE run_date = ?", [run_date]);
  let runId: string;
  if (existing[0]) {
    runId = existing[0].id;
    await db.run(
      "INSERT INTO models (id, category, brand, model_code, model_key, title, created_at) VALUES (?, 'aspiradoras-robot', 'Fake', ?, ?, 'Fake', 'x')",
      [`m-${id}`, `m-${id}`, `m-${id}`],
    );
  } else {
    runId = (await seedRun(db, { run_date, modelIds: [`m-${id}`] })).runId;
  }
  await db.run(
    "INSERT INTO candidates (id, run_id, model_id, payload, status, telegram_message_id) VALUES (?, ?, ?, ?, ?, ?)",
    [id, runId, `m-${id}`, payload(`Robot ${id}`, opts.others ?? [{ store: "fravega", ref: "F1" }]), opts.status ?? "pending", opts.msg ?? 202],
  );
}

async function pairing(model: string, ref: string) {
  await db.run(
    "INSERT OR IGNORE INTO store_listings (store_id, external_ref, title, url, first_seen_at, last_seen_at) VALUES ('fravega', ?, 't', 'u', 'x', 'x')",
    [ref],
  );
  const [p] = await db.all<{ id: number }>("SELECT id FROM store_listings WHERE store_id='fravega' AND external_ref=?", [ref]);
  await db.run(
    "INSERT INTO matches (model_id, listing_id, confidence, rule, evidence, status, created_at) VALUES (?, ?, 'high', 'gtin', 'e', 'auto', 'x')",
    [model, p!.id],
  );
}

const upd = (text: string, o: { chat?: number; replyTo?: number | null; messageId?: number } = {}) => ({
  update_id: 1,
  message: {
    message_id: o.messageId ?? 501,
    chat: { id: o.chat ?? Number(OWNER), type: "private" },
    text,
    ...(o.replyTo === null ? {} : { reply_to_message: { message_id: o.replyTo ?? 202 } }),
  },
});

const row = (id: string) =>
  db.all<{ status: string; affiliate_link: string | null }>("SELECT status, affiliate_link FROM candidates WHERE id = ?", [id]).then((r) => r[0]!);

/** A client that moves the candidate to `published` right before the first matching UPDATE: the publish race. */
function racingDeps(updatePattern: RegExp) {
  let raced = false;
  const racing = {
    all: db.all.bind(db),
    run: async (sql: string, params?: (string | number | null)[]) => {
      if (!raced && updatePattern.test(sql)) {
        raced = true;
        await db.run("UPDATE candidates SET status = 'published' WHERE id = 'c1'");
      }
      return db.run(sql, params);
    },
  };
  return { db: racing, ownerChatId: OWNER, channelId: CHANNEL, telegram, now: () => NOW };
}

beforeEach(() => {
  db = createSqliteClient();
  deleted = [];
  deleteFails = false;
});

describe("handleTelegramUpdate", () => {
  it("stores a valid link byte for byte and marks the candidate chosen", async () => {
    await candidate("c1");
    const reply = await handleTelegramUpdate(deps(), upd(`  ${LINK}  `));
    expect(reply).toEqual({
      method: "sendMessage",
      chat_id: 123456789,
      text: "Enlace guardado para Robot c1. Se publica tras revalidar el precio.",
      reply_to_message_id: 501,
    });
    const r = await row("c1");
    expect(r.status).toBe("chosen");
    expect(Buffer.from(r.affiliate_link!).equals(Buffer.from(LINK))).toBe(true);
  });

  it("works from the recorded fixture", async () => {
    await candidate("c1");
    const fixture = JSON.parse(readFileSync("fixtures/telegram/update-reply-link.json", "utf8"));
    const reply = await handleTelegramUpdate(deps(), fixture);
    expect(reply?.text).toContain("Enlace guardado para Robot c1");
  });

  it("allows replacing the link on an chosen candidate", async () => {
    await candidate("c1", { status: "chosen" });
    await handleTelegramUpdate(deps(), upd("https://meli.la/NEW"));
    expect((await row("c1")).affiliate_link).toBe("https://meli.la/NEW");
  });

  it("explains an invalid link in Spanish and changes nothing", async () => {
    await candidate("c1");
    const reply = await handleTelegramUpdate(deps(), upd("http://meli.la/x"));
    expect(reply?.text).toBe("No se guardó el enlace: el enlace no usa https. Debe ser un único enlace https://meli.la/...");
    expect(await row("c1")).toEqual({ status: "pending", affiliate_link: null });
    const r2 = await handleTelegramUpdate(deps(), upd("https://www.meli.la/x"));
    expect(r2?.text).toContain("el enlace no es de meli.la");
    const r3 = await handleTelegramUpdate(deps(), upd("mirá https://meli.la/x"));
    expect(r3?.text).toContain("tiene que ser un único enlace, sin otro texto");
  });

  it.each([["published", "publicado"], ["discarded", "descartado"]])("rechazar on a %s candidate changes nothing", async (status, label) => {
    await candidate("c1", { status });
    const reply = await handleTelegramUpdate(deps(), upd("rechazar"));
    expect(reply?.text).toBe(`Este candidato ya está ${label}; no se cambió nada.`);
    expect((await row("c1")).status).toBe(status);
  });

  it("rechazar loses the race against a publish: the row stays published and the pairings are untouched", async () => {
    await candidate("c1");
    await pairing("m-c1", "F1");
    const reply = await handleTelegramUpdate(racingDeps(/UPDATE candidates SET status = 'discarded'/), upd("rechazar"));
    expect(reply?.text).toBe("Este candidato ya está publicado; no se cambió nada.");
    expect((await row("c1")).status).toBe("published");
    const e = await db.all<{ status: string }>("SELECT status FROM matches");
    expect(e).toEqual([{ status: "auto" }]);
  });

  it("a link reply loses the race against a publish: the row stays published and keeps no new link", async () => {
    await candidate("c1");
    const reply = await handleTelegramUpdate(racingDeps(/UPDATE candidates SET status = 'chosen'/), upd(LINK));
    expect(reply?.text).toBe("Este candidato ya está publicado; no se cambió nada.");
    expect(await row("c1")).toEqual({ status: "published", affiliate_link: null });
  });

  it("returns null and saves nothing for another chat", async () => {
    await candidate("c1");
    expect(await handleTelegramUpdate(deps(), upd(LINK, { chat: 999 }))).toBeNull();
    expect(await row("c1")).toEqual({ status: "pending", affiliate_link: null });
  });

  it("returns null for malformed updates", async () => {
    for (const u of [null, "x", 5, {}, { message: {} }, { message: { chat: {} } }, { message: { chat: { id: "x" } } }]) {
      expect(await handleTelegramUpdate(deps(), u)).toBeNull();
    }
  });

  it("explains that yesterday's candidate cannot be published", async () => {
    await candidate("c1", { run_date: "2026-11-10" });
    const reply = await handleTelegramUpdate(deps(), upd(LINK));
    expect(reply?.text).toBe("Ese candidato es de otro día y ya no se puede publicar.");
    expect(await row("c1")).toEqual({ status: "pending", affiliate_link: null });
  });

  it("answers with help when the message is not a reply", async () => {
    await candidate("c1");
    const reply = await handleTelegramUpdate(deps(), upd(LINK, { replyTo: null }));
    expect(reply).toEqual({ method: "sendMessage", chat_id: 123456789, text: HELP, reply_to_message_id: 501 });
    expect((await row("c1")).status).toBe("pending");
  });

  it("answers with help when the reply targets no candidate", async () => {
    await candidate("c1");
    const reply = await handleTelegramUpdate(deps(), upd(LINK, { replyTo: 9999 }));
    expect(reply?.text).toBe(HELP);
    expect((await row("c1")).status).toBe("pending");
  });

  it.each([["Rechazar", 1], ["  RECHAZAR ", 3]])("%j discards the candidate and rejects %i rival pairing(s)", async (text, n) => {
    const others = Array.from({ length: n }, (_, i) => ({ store: "fravega", ref: `F${i}` }));
    await candidate("c1", { others });
    await candidate("c2");
    for (const o of others) await pairing("m-c1", o.ref);
    await pairing("m-c2", "F1");
    const reply = await handleTelegramUpdate(deps(), upd(text));
    expect(reply?.text).toBe("Descartado: Robot c1. No se volverá a proponer.");
    expect((await row("c1")).status).toBe("discarded");
    const rows = await db.all<{ model_id: string; status: string }>("SELECT model_id, status FROM matches");
    expect(rows.filter((r) => r.model_id === "m-c1").map((r) => r.status)).toEqual(Array(n).fill("rejected"));
    expect(rows.filter((r) => r.model_id === "m-c2").map((r) => r.status)).toEqual(["auto"]);
    expect((await row("c2")).status).toBe("pending");
  });

  it.each(["pending", "chosen", "validated"])("allows rechazar on %s", async (status) => {
    await candidate("c1", { status });
    await handleTelegramUpdate(deps(), upd("rechazar"));
    expect((await row("c1")).status).toBe("discarded");
  });

  it("refuses a link on a validated candidate", async () => {
    await candidate("c1", { status: "validated" });
    const reply = await handleTelegramUpdate(deps(), upd(LINK));
    expect(reply?.text).toBe("Este candidato ya está validado; no se cambió nada.");
    expect(await row("c1")).toEqual({ status: "validated", affiliate_link: null });
  });
});

describe("coupons", () => {
  async function coupon(o: { status?: string; owner?: number; channel?: number | null; code?: string } = {}) {
    await db.run(
      `INSERT INTO coupons (code, discount_type, discount_value, valid_from, valid_until, status, source_message_id, source_text,
         channel_message_id, owner_message_id, created_at, updated_at)
       VALUES (?, 'percent', 10, 'a', 'b', ?, 1, 'src', ?, ?, 'x', 'x')`,
      [o.code ?? "CYBERALMAX", o.status ?? "published", o.channel === undefined ? 900 : o.channel, o.owner ?? 700],
    );
  }
  const cstatus = () => db.all<{ status: string }>("SELECT status FROM coupons").then((r) => r[0]!.status);
  const REMOVED = "Cupón retirado: CYBERALMAX. Se quita de la web en la próxima actualización (hasta una hora).";

  it("rechazar marks the coupon removed and deletes the channel message", async () => {
    await coupon();
    const reply = await handleTelegramUpdate(deps(), upd("rechazar", { replyTo: 700 }));
    expect(reply?.text).toBe(REMOVED);
    expect(await cstatus()).toBe("removed");
    expect(deleted).toEqual([{ chat_id: CHANNEL, message_id: 900 }]);
  });

  it("ignores case and surrounding spaces", async () => {
    await coupon();
    const reply = await handleTelegramUpdate(deps(), upd("  Rechazar ", { replyTo: 700 }));
    expect(reply?.text).toBe(REMOVED);
  });

  it("a second rechazar changes nothing", async () => {
    await coupon();
    await handleTelegramUpdate(deps(), upd("rechazar", { replyTo: 700 }));
    const reply = await handleTelegramUpdate(deps(), upd("rechazar", { replyTo: 700 }));
    expect(reply?.text).toBe("Ese cupón ya está retirado; no se cambió nada.");
    expect(deleted).toHaveLength(1);
  });

  it("deleteMessage failing still leaves the coupon removed", async () => {
    await coupon();
    deleteFails = true;
    const reply = await handleTelegramUpdate(deps(), upd("rechazar", { replyTo: 700 }));
    expect(reply?.text).toBe("Cupón retirado de la web, pero no se pudo borrar el mensaje del canal. Borrarlo a mano.");
    expect(await cstatus()).toBe("removed");
  });

  it("a pending coupon without a channel message is removed with no delete call", async () => {
    await coupon({ status: "pending", channel: null });
    const reply = await handleTelegramUpdate(deps(), upd("rechazar", { replyTo: 700 }));
    expect(reply?.text).toBe(REMOVED);
    expect(await cstatus()).toBe("removed");
    expect(deleted).toEqual([]);
  });

  it("any other reply text explains how to take the coupon down", async () => {
    await coupon();
    const reply = await handleTelegramUpdate(deps(), upd("hola", { replyTo: 700 }));
    expect(reply?.text).toBe('Para bajar este cupón, responder "rechazar".');
    expect(await cstatus()).toBe("published");
    expect(deleted).toEqual([]);
  });

  it("a reply to a message that is neither a candidate nor a coupon notice gets the help text", async () => {
    await coupon();
    const reply = await handleTelegramUpdate(deps(), upd("rechazar", { replyTo: 12345 }));
    expect(reply?.text).toBe(HELP);
    expect(await cstatus()).toBe("published");
  });

  it("a candidate wins when both tables hold the same message id", async () => {
    await candidate("c1", { msg: 700 });
    await coupon();
    const reply = await handleTelegramUpdate(deps(), upd("rechazar", { replyTo: 700 }));
    expect(reply?.text).toBe("Descartado: Robot c1. No se volverá a proponer.");
    expect(await cstatus()).toBe("published");
  });

  it("the removal is a guarded UPDATE: a coupon removed between SELECT and UPDATE reports unchanged", async () => {
    await coupon();
    let raced = false;
    const racing = {
      all: db.all.bind(db),
      run: async (sql: string, params?: (string | number | null)[]) => {
        if (!raced && /UPDATE coupons SET status = 'removed'/.test(sql)) {
          raced = true;
          await db.run("UPDATE coupons SET status = 'removed'");
        }
        return db.run(sql, params);
      },
    };
    const reply = await handleTelegramUpdate(
      { db: racing, ownerChatId: OWNER, channelId: CHANNEL, telegram, now: () => NOW },
      upd("rechazar", { replyTo: 700 }),
    );
    expect(reply?.text).toBe("Ese cupón ya está retirado; no se cambió nada.");
    expect(deleted).toEqual([]);
  });

  it("non-owner chats are still ignored", async () => {
    await coupon();
    expect(await handleTelegramUpdate(deps(), upd("rechazar", { chat: 999, replyTo: 700 }))).toBeNull();
    expect(await cstatus()).toBe("published");
  });
});
