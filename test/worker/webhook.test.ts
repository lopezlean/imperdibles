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
const deps = () => ({ db, ownerChatId: OWNER, now: () => NOW });

function payload(titulo: string, otras: { tienda: string; ref: string }[]): string {
  return JSON.stringify({ titulo, otras: otras.map((o) => ({ tienda: o.tienda, ref_externa: o.ref })) });
}

async function candidate(id: string, opts: { fecha?: string; estado?: string; msg?: number; otras?: { tienda: string; ref: string }[] } = {}) {
  const fecha = opts.fecha ?? "2026-11-11";
  const existing = await db.all<{ id: string }>("SELECT id FROM corridas WHERE fecha = ?", [fecha]);
  let corridaId: string;
  if (existing[0]) {
    corridaId = existing[0].id;
    await db.run(
      "INSERT INTO modelos (id, categoria, marca, codigo_modelo, clave, titulo, creado_en) VALUES (?, 'aspiradoras-robot', 'Fake', ?, ?, 'Fake', 'x')",
      [`m-${id}`, `m-${id}`, `m-${id}`],
    );
  } else {
    corridaId = (await seedRun(db, { fecha, modeloIds: [`m-${id}`] })).corridaId;
  }
  await db.run(
    "INSERT INTO candidatos (id, corrida_id, modelo_id, payload, estado, telegram_mensaje_id) VALUES (?, ?, ?, ?, ?, ?)",
    [id, corridaId, `m-${id}`, payload(`Robot ${id}`, opts.otras ?? [{ tienda: "fravega", ref: "F1" }]), opts.estado ?? "pendiente", opts.msg ?? 202],
  );
}

async function pairing(modelo: string, ref: string) {
  await db.run(
    "INSERT OR IGNORE INTO publicaciones_tienda (tienda_id, ref_externa, titulo, url, primera_vez, ultima_vez) VALUES ('fravega', ?, 't', 'u', 'x', 'x')",
    [ref],
  );
  const [p] = await db.all<{ id: number }>("SELECT id FROM publicaciones_tienda WHERE tienda_id='fravega' AND ref_externa=?", [ref]);
  await db.run(
    "INSERT INTO emparejados (modelo_id, publicacion_id, confianza, regla, evidencia, estado, creado_en) VALUES (?, ?, 'alta', 'gtin', 'e', 'auto', 'x')",
    [modelo, p!.id],
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
  db.all<{ estado: string; enlace_afiliado: string | null }>("SELECT estado, enlace_afiliado FROM candidatos WHERE id = ?", [id]).then((r) => r[0]!);

/** A client that moves the candidate to `publicado` right before the first matching UPDATE: the publish race. */
function racingDeps(updatePattern: RegExp) {
  let raced = false;
  const racing = {
    all: db.all.bind(db),
    run: async (sql: string, params?: (string | number | null)[]) => {
      if (!raced && updatePattern.test(sql)) {
        raced = true;
        await db.run("UPDATE candidatos SET estado = 'publicado' WHERE id = 'c1'");
      }
      return db.run(sql, params);
    },
  };
  return { db: racing, ownerChatId: OWNER, now: () => NOW };
}

beforeEach(() => {
  db = createSqliteClient();
});

describe("handleTelegramUpdate", () => {
  it("stores a valid link byte for byte and marks the candidate elegido", async () => {
    await candidate("c1");
    const reply = await handleTelegramUpdate(deps(), upd(`  ${LINK}  `));
    expect(reply).toEqual({
      method: "sendMessage",
      chat_id: 123456789,
      text: "Enlace guardado para Robot c1. Se publica tras revalidar el precio.",
      reply_to_message_id: 501,
    });
    const r = await row("c1");
    expect(r.estado).toBe("elegido");
    expect(Buffer.from(r.enlace_afiliado!).equals(Buffer.from(LINK))).toBe(true);
  });

  it("works from the recorded fixture", async () => {
    await candidate("c1");
    const fixture = JSON.parse(readFileSync("fixtures/telegram/update-reply-link.json", "utf8"));
    const reply = await handleTelegramUpdate(deps(), fixture);
    expect(reply?.text).toContain("Enlace guardado para Robot c1");
  });

  it("allows replacing the link on an elegido candidate", async () => {
    await candidate("c1", { estado: "elegido" });
    await handleTelegramUpdate(deps(), upd("https://meli.la/NEW"));
    expect((await row("c1")).enlace_afiliado).toBe("https://meli.la/NEW");
  });

  it("explains an invalid link in Spanish and changes nothing", async () => {
    await candidate("c1");
    const reply = await handleTelegramUpdate(deps(), upd("http://meli.la/x"));
    expect(reply?.text).toBe("No se guardó el enlace: el enlace no usa https. Debe ser un único enlace https://meli.la/...");
    expect(await row("c1")).toEqual({ estado: "pendiente", enlace_afiliado: null });
    const r2 = await handleTelegramUpdate(deps(), upd("https://www.meli.la/x"));
    expect(r2?.text).toContain("el enlace no es de meli.la");
    const r3 = await handleTelegramUpdate(deps(), upd("mirá https://meli.la/x"));
    expect(r3?.text).toContain("tiene que ser un único enlace, sin otro texto");
  });

  it.each(["publicado", "descartado"])("rechazar on a %s candidate changes nothing", async (estado) => {
    await candidate("c1", { estado });
    const reply = await handleTelegramUpdate(deps(), upd("rechazar"));
    expect(reply?.text).toBe(`Este candidato ya está ${estado}; no se cambió nada.`);
    expect((await row("c1")).estado).toBe(estado);
  });

  it("rechazar loses the race against a publish: the row stays publicado and the pairings are untouched", async () => {
    await candidate("c1");
    await pairing("m-c1", "F1");
    const reply = await handleTelegramUpdate(racingDeps(/UPDATE candidatos SET estado = 'descartado'/), upd("rechazar"));
    expect(reply?.text).toBe("Este candidato ya está publicado; no se cambió nada.");
    expect((await row("c1")).estado).toBe("publicado");
    const e = await db.all<{ estado: string }>("SELECT estado FROM emparejados");
    expect(e).toEqual([{ estado: "auto" }]);
  });

  it("a link reply loses the race against a publish: the row stays publicado and keeps no new link", async () => {
    await candidate("c1");
    const reply = await handleTelegramUpdate(racingDeps(/UPDATE candidatos SET estado = 'elegido'/), upd(LINK));
    expect(reply?.text).toBe("Este candidato ya está publicado; no se cambió nada.");
    expect(await row("c1")).toEqual({ estado: "publicado", enlace_afiliado: null });
  });

  it("returns null and saves nothing for another chat", async () => {
    await candidate("c1");
    expect(await handleTelegramUpdate(deps(), upd(LINK, { chat: 999 }))).toBeNull();
    expect(await row("c1")).toEqual({ estado: "pendiente", enlace_afiliado: null });
  });

  it("returns null for malformed updates", async () => {
    for (const u of [null, "x", 5, {}, { message: {} }, { message: { chat: {} } }, { message: { chat: { id: "x" } } }]) {
      expect(await handleTelegramUpdate(deps(), u)).toBeNull();
    }
  });

  it("explains that yesterday's candidate cannot be published", async () => {
    await candidate("c1", { fecha: "2026-11-10" });
    const reply = await handleTelegramUpdate(deps(), upd(LINK));
    expect(reply?.text).toBe("Ese candidato es de otro día y ya no se puede publicar.");
    expect(await row("c1")).toEqual({ estado: "pendiente", enlace_afiliado: null });
  });

  it("answers with help when the message is not a reply", async () => {
    await candidate("c1");
    const reply = await handleTelegramUpdate(deps(), upd(LINK, { replyTo: null }));
    expect(reply).toEqual({ method: "sendMessage", chat_id: 123456789, text: HELP, reply_to_message_id: 501 });
    expect((await row("c1")).estado).toBe("pendiente");
  });

  it("answers with help when the reply targets no candidate", async () => {
    await candidate("c1");
    const reply = await handleTelegramUpdate(deps(), upd(LINK, { replyTo: 9999 }));
    expect(reply?.text).toBe(HELP);
    expect((await row("c1")).estado).toBe("pendiente");
  });

  it.each([["Rechazar", 1], ["  RECHAZAR ", 3]])("%j discards the candidate and rejects %i rival pairing(s)", async (text, n) => {
    const otras = Array.from({ length: n }, (_, i) => ({ tienda: "fravega", ref: `F${i}` }));
    await candidate("c1", { otras });
    await candidate("c2");
    for (const o of otras) await pairing("m-c1", o.ref);
    await pairing("m-c2", "F1");
    const reply = await handleTelegramUpdate(deps(), upd(text));
    expect(reply?.text).toBe("Descartado: Robot c1. No se volverá a proponer.");
    expect((await row("c1")).estado).toBe("descartado");
    const rows = await db.all<{ modelo_id: string; estado: string }>("SELECT modelo_id, estado FROM emparejados");
    expect(rows.filter((r) => r.modelo_id === "m-c1").map((r) => r.estado)).toEqual(Array(n).fill("rechazado"));
    expect(rows.filter((r) => r.modelo_id === "m-c2").map((r) => r.estado)).toEqual(["auto"]);
    expect((await row("c2")).estado).toBe("pendiente");
  });

  it.each(["pendiente", "elegido", "validado"])("allows rechazar on %s", async (estado) => {
    await candidate("c1", { estado });
    await handleTelegramUpdate(deps(), upd("rechazar"));
    expect((await row("c1")).estado).toBe("descartado");
  });

  it("refuses a link on a validado candidate", async () => {
    await candidate("c1", { estado: "validado" });
    const reply = await handleTelegramUpdate(deps(), upd(LINK));
    expect(reply?.text).toBe("Este candidato ya está validado; no se cambió nada.");
    expect(await row("c1")).toEqual({ estado: "validado", enlace_afiliado: null });
  });
});
