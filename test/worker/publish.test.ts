import { beforeEach, describe, expect, it, vi } from "vitest";
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

function payloadFor(titulo: string): string {
  const offer = (tienda: string, precio: number) => ({
    tienda,
    titulo_listado: titulo,
    url: `https://example.test/${tienda}`,
    precio_ars: precio,
    observado_en: "2026-11-10T10:00:00-03:00",
    ref_externa: `${tienda}-1`,
    vendedor: null,
  });
  return JSON.stringify({
    candidato_id: "x",
    modelo_id: "x",
    marca: "Fake",
    titulo,
    imagen_url: null,
    ml: { ...offer("ml", 329999), ml_product_id: "MLA1", ml_seller_id: "1" },
    otras: [offer("fravega", 399999)],
    diferencia_ars: 70000,
    diferencia_pct: 17.5,
    confianza: "alta",
    regla_emparejado: "gtin",
  });
}

async function addRun(corridaId: string, modeloIds: string[], fecha = "2026-11-10") {
  await seedRun(db, { fecha, modeloIds, corridaId });
}

async function addCandidate(
  id: string,
  corridaId: string,
  modeloId: string,
  o: { estado?: string; validado_en?: string | null; link?: string | null; fileId?: string | null } = {},
) {
  await db.run(
    "INSERT INTO candidatos (id, corrida_id, modelo_id, payload, estado, enlace_afiliado, telegram_file_id, validado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      corridaId,
      modeloId,
      payloadFor(`Robot ${id}`),
      o.estado ?? "validado",
      o.link === undefined ? LINK : o.link,
      o.fileId === undefined ? `file-${id}` : o.fileId,
      o.validado_en === undefined ? FRESH : o.validado_en,
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
    async sendMessage(p) {
      calls.push({ kind: "message", chat: p.chat_id, text: p.text });
      if (opts.failMessage) throw new TelegramError(500, "boom");
      return { message_id: ++n };
    },
  };
  return { client, calls, channelPhotos: () => calls.filter((c) => c.kind === "photo" && c.chat === CHANNEL) };
}

const run = (tg: TelegramClient, afterPublish = async () => {}, now = NOW, client: SqlClient = db) =>
  publishValidated({ db: client, telegram: tg, channelId: CHANNEL, ownerChatId: OWNER, now: () => now, afterPublish });

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

const estado = (id: string) =>
  db.all<{ estado: string; telegram_file_id: string | null }>("SELECT estado, telegram_file_id FROM candidatos WHERE id = ?", [id]).then((r) => r[0]!);
const salidas = (canal: string) =>
  db.all<{ candidato_id: string; mensaje_externo_id: string | null }>("SELECT candidato_id, mensaje_externo_id FROM salidas WHERE canal = ? ORDER BY candidato_id", [canal]);

beforeEach(async () => {
  db = createSqliteClient();
  await addRun("r1", ["m1", "m2", "m3"]);
});

describe("publishValidated", () => {
  it("publishes a fresh validado candidate to the channel and records the salida", async () => {
    await addCandidate("c1", "r1", "m1");
    const tg = fakeTelegram();
    const report = await run(tg.client);
    expect(report).toEqual({ published: ["c1"], failed: [], stale: [] });
    expect((await estado("c1")).estado).toBe("publicado");
    expect(tg.channelPhotos()).toHaveLength(1);
    expect(tg.channelPhotos()[0]!.fileId).toBe("file-c1");
    expect(tg.channelPhotos()[0]!.caption).toContain(LINK);
    expect(await salidas("telegram_canal")).toEqual([{ candidato_id: "c1", mensaje_externo_id: "101" }]);
  });

  it("sends the owner the X material and records x_manual", async () => {
    await addCandidate("c1", "r1", "m1");
    const tg = fakeTelegram();
    await run(tg.client);
    const ownerPhoto = tg.calls.find((c) => c.kind === "photo" && c.chat === OWNER)!;
    expect(ownerPhoto.fileId).toBe("file-c1");
    const c = JSON.parse(payloadFor("Robot c1"));
    expect(ownerPhoto.caption).toBe(buildXPost(c, LINK));
    expect((await salidas("x_manual")).map((s) => s.candidato_id)).toEqual(["c1"]);
  });

  it("reports a candidate validated 31 minutes ago as stale and does not send it", async () => {
    await addCandidate("c1", "r1", "m1", { validado_en: OLD });
    const tg = fakeTelegram();
    const report = await run(tg.client);
    expect(report).toEqual({ published: [], failed: [], stale: ["c1"] });
    expect(tg.calls).toHaveLength(0);
    expect((await estado("c1")).estado).toBe("validado");
  });

  it("ignores candidates without link, without file_id, not validado, or from another day", async () => {
    await addRun("r0", ["m9"], "2026-11-09");
    await addCandidate("a", "r1", "m1", { link: null });
    await addCandidate("b", "r1", "m2", { fileId: null });
    await addCandidate("c", "r1", "m3", { estado: "elegido" });
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
    expect(await salidas("telegram_canal")).toHaveLength(1);
    const states = await db.all<{ estado: string }>("SELECT estado FROM candidatos ORDER BY id");
    expect(states.map((s) => s.estado).sort()).toEqual(["publicado", "validado"]);
    // A later call still leaves the sibling alone.
    const again = fakeTelegram();
    await run(again.client);
    expect(again.channelPhotos()).toHaveLength(0);
  });

  it("skips a candidate whose model already has a telegram_canal salida today", async () => {
    await addRun("r2", ["m1"]);
    await addCandidate("c1", "r1", "m1", { estado: "invalidado" });
    await db.run("INSERT INTO salidas (candidato_id, canal, mensaje_externo_id, publicado_en) VALUES ('c1', 'telegram_canal', '7', 'x')");
    await addCandidate("c2", "r2", "m1");
    const tg = fakeTelegram();
    const report = await run(tg.client);
    expect(report).toEqual({ published: [], failed: [], stale: [] });
    expect(tg.calls).toHaveLength(0);
  });

  it("never sends a candidate that already has a telegram_canal salida", async () => {
    await addCandidate("c1", "r1", "m1");
    await db.run("INSERT INTO salidas (candidato_id, canal, mensaje_externo_id, publicado_en) VALUES ('c1', 'telegram_canal', '7', 'x')");
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
    const left = await db.all<{ n: number }>("SELECT COUNT(*) AS n FROM candidatos WHERE estado = 'validado'");
    expect(left[0]!.n).toBe(3);
  });

  it("still regenerates the page, then rethrows, when a database call fails after a successful publish", async () => {
    await addCandidate("c1", "r1", "m1");
    await addCandidate("c2", "r1", "m2");
    const tg = fakeTelegram();
    const after = vi.fn(async () => {});
    await expect(run(tg.client, after, NOW, failingDb(/SELECT c2\.id/, 2))).rejects.toThrow("d1 down");
    expect(after).toHaveBeenCalledTimes(1);
    expect((await estado("c1")).estado).toBe("publicado");
    expect((await estado("c2")).estado).toBe("validado");
  });

  it("does not regenerate when the database fails before anything was published", async () => {
    await addCandidate("c1", "r1", "m1");
    const after = vi.fn(async () => {});
    await expect(run(fakeTelegram().client, after, NOW, failingDb(/SELECT c2\.id/, 1))).rejects.toThrow("d1 down");
    expect(after).not.toHaveBeenCalled();
  });

  it("alerts the owner and keeps going when the revert to validado fails", async () => {
    await addCandidate("c1", "r1", "m1");
    await addCandidate("c2", "r1", "m2");
    const tg = fakeTelegram({ failChannel: (fileId) => (fileId === "file-c1" ? new TelegramError(500, "boom") : undefined) });
    const after = vi.fn(async () => {});
    const report = await run(tg.client, after, NOW, failingDb(/SET estado = 'validado'/, 1));
    expect(report.published).toEqual(["c2"]);
    expect(report.failed).toEqual(["c1"]);
    expect(after).toHaveBeenCalledTimes(1);
    const alerts = tg.calls.filter((c) => c.kind === "message").map((c) => c.text ?? "");
    expect(alerts.some((t) => t.includes("Robot c1") && t.includes("publicado"))).toBe(true);
  });

  it("sends exactly one channel photo per candidate when run twice concurrently", async () => {
    await addCandidate("c1", "r1", "m1");
    await addCandidate("c2", "r1", "m2");
    const tg = fakeTelegram();
    const after = vi.fn(async () => {});
    const [a, b] = await Promise.all([run(tg.client, after), run(tg.client, after)]);
    expect(tg.channelPhotos()).toHaveLength(2);
    expect([...a.published, ...b.published].sort()).toEqual(["c1", "c2"]);
    expect(await salidas("telegram_canal")).toHaveLength(2);
  });

  it("reverts to validado, alerts the owner and records no salida after two channel failures", async () => {
    await addCandidate("c1", "r1", "m1");
    const tg = fakeTelegram({ failChannel: () => new TelegramError(500, "sendPhoto: boom") });
    const report = await run(tg.client);
    expect(report).toEqual({ published: [], failed: ["c1"], stale: [] });
    expect(tg.channelPhotos()).toHaveLength(2);
    expect((await estado("c1")).estado).toBe("validado");
    expect(await salidas("telegram_canal")).toEqual([]);
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
    const row = await estado("c1");
    expect(row).toEqual({ estado: "validado", telegram_file_id: null });
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
    expect(await salidas("x_manual")).toEqual([]);
  });

  it("keeps the candidate publicado and never reposts when the salidas insert fails after a successful send", async () => {
    await addCandidate("c1", "r1", "m1");
    const failing = {
      all: db.all.bind(db),
      run: (sql: string, params?: Parameters<typeof db.run>[1]) =>
        sql.includes("INSERT INTO salidas") && sql.includes("'telegram_canal'")
          ? Promise.reject(new Error("d1 unavailable"))
          : db.run(sql, params),
    };
    const tg = fakeTelegram();
    const report = await publishValidated({
      db: failing, telegram: tg.client, channelId: CHANNEL, ownerChatId: OWNER, now: () => NOW, afterPublish: async () => {},
    });
    expect(report.failed).toEqual([]);
    expect(report.published).toEqual(["c1"]);
    expect((await estado("c1")).estado).toBe("publicado");
    expect(tg.channelPhotos()).toHaveLength(1);
    expect(tg.calls.some((c) => c.kind === "message" && c.text?.startsWith("No se pudo publicar"))).toBe(false);
    const again = fakeTelegram();
    await run(again.client);
    expect(again.channelPhotos()).toHaveLength(0);
  });

  it("calls afterPublish once when something was published, never otherwise", async () => {
    const after = vi.fn(async () => {});
    await run(fakeTelegram().client, after);
    expect(after).not.toHaveBeenCalled();
    await addCandidate("c1", "r1", "m1");
    await addCandidate("c2", "r1", "m2");
    await run(fakeTelegram().client, after);
    expect(after).toHaveBeenCalledTimes(1);
    const failing = vi.fn(async () => {});
    await db.run("UPDATE candidatos SET estado = 'validado'");
    await db.run("DELETE FROM salidas");
    await run(fakeTelegram({ failChannel: () => new TelegramError(500, "sendPhoto: boom") }).client, failing);
    expect(failing).not.toHaveBeenCalled();
  });
});
