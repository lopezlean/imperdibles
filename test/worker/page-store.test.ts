import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TelegramClient } from "../../src/output/telegram/client.js";
import type { WorkerDeps } from "../../src/worker/deps.js";
import type { Env } from "../../src/worker/env.js";
import { handleFetch } from "../../src/worker/index.js";
import { regeneratePages, servePage } from "../../src/worker/page-store.js";
import { createSqliteClient } from "../support/sqlite-client.js";
import { seedRun } from "./support/seed.js";

const CHANNEL_URL = "https://t.me/page_store_test";
const PUBLISH_AT = new Date("2026-11-10T14:30:00Z"); // 11:30 ART
const SAME_DAY = new Date("2026-11-10T15:00:00Z");
const NEXT_DAY = new Date("2026-11-11T12:00:00Z");
const FRESH = "2026-11-10T11:05:00-03:00";

type Db = ReturnType<typeof createSqliteClient>;
let db: Db;

function payloadFor(titulo: string, ml = 329999, rival = 399999): string {
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
    ml: { ...offer("ml", ml), ml_product_id: "MLA1", ml_seller_id: "1" },
    otras: [offer("fravega", rival)],
    diferencia_ars: rival - ml,
    diferencia_pct: 17.5,
    confianza: "alta",
    regla_emparejado: "gtin",
  });
}

async function addCandidate(
  id: string,
  corridaId: string,
  modeloId: string,
  o: { estado?: string; titulo?: string; ml?: number; rival?: number; link?: string | null; publishedAt?: string } = {},
) {
  const estado = o.estado ?? "publicado";
  await db.run(
    "INSERT INTO candidatos (id, corrida_id, modelo_id, payload, estado, enlace_afiliado, telegram_file_id, validado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      corridaId,
      modeloId,
      payloadFor(o.titulo ?? `Robot ${id}`, o.ml, o.rival),
      estado,
      o.link === undefined ? `https://meli.la/${id}` : o.link,
      `file-${id}`,
      FRESH,
    ],
  );
  if (o.publishedAt) {
    await db.run("INSERT INTO salidas (candidato_id, canal, mensaje_externo_id, publicado_en) VALUES (?, 'telegram_canal', '1', ?)", [
      id,
      o.publishedAt,
    ]);
  }
}

const deps = (now: Date) => ({ db, now: () => now, channelUrl: CHANNEL_URL });
const pageKeys = async () => (await db.all<{ clave: string }>("SELECT clave FROM paginas ORDER BY clave")).map((r) => r.clave);

function workerDeps(now: Date, telegram?: TelegramClient): WorkerDeps {
  const env = {
    TELEGRAM_BOT_TOKEN: "t",
    TELEGRAM_OWNER_CHAT_ID: "42",
    TELEGRAM_CHANNEL_ID: "-100",
    TELEGRAM_WEBHOOK_SECRET: "hook",
    PUBLISH_NOW_SECRET: "pub-secret",
    TELEGRAM_CHANNEL_URL: CHANNEL_URL,
  } as unknown as Env;
  return { db, env, now: () => now, telegram };
}

const fakeTelegram = (): TelegramClient =>
  ({
    sendMessage: vi.fn(async () => ({ message_id: 1 })),
    sendPhoto: vi.fn(async () => ({ message_id: 2, file_id: "f" })),
  }) as unknown as TelegramClient;

const publishNow = (now: Date, tg = fakeTelegram()) =>
  handleFetch(
    new Request("https://imperdibles.ar/internal/publish-now", { method: "POST", headers: { Authorization: "Bearer pub-secret" } }),
    workerDeps(now, tg),
  );
const getHome = (now: Date, method = "GET") => handleFetch(new Request("https://imperdibles.ar/", { method }), workerDeps(now));

beforeEach(() => {
  db = createSqliteClient();
});

describe("regeneratePages", () => {
  it("writes hoy:<fecha> and archivo for the latest day with published candidates", async () => {
    await seedRun(db, { fecha: "2026-11-09", modeloIds: ["A:0"], corridaId: "r0" });
    await seedRun(db, { fecha: "2026-11-10", modeloIds: ["A:1"], corridaId: "r1" });
    await db.run("UPDATE corridas SET modelos_comparados = 37 WHERE id = 'r1'");
    await addCandidate("c0", "r0", "A:0", { titulo: "Robot viejo" });
    await addCandidate("c1", "r1", "A:1", { titulo: "Robot nuevo" });
    await regeneratePages(deps(SAME_DAY));
    expect(await pageKeys()).toEqual(["archivo", "hoy:2026-11-10"]);
    const rows = await db.all<{ clave: string; html: string }>("SELECT clave, html FROM paginas");
    for (const r of rows) {
      expect(r.html).toContain("Robot nuevo");
      expect(r.html).not.toContain("Robot viejo");
      expect(r.html).toContain("37");
      expect(r.html).toContain("Aspiradoras robot");
      expect(r.html).toContain("https://meli.la/c1");
    }
    expect(rows.find((r) => r.clave === "hoy:2026-11-10")?.html).toContain("Los imperdibles de hoy");
    expect(rows.find((r) => r.clave === "archivo")?.html).toContain("Los imperdibles del 10 de noviembre de 2026");
  });

  it("writes only archivo in mode none when nothing was ever published", async () => {
    await seedRun(db, { fecha: "2026-11-10", modeloIds: ["A:1"], corridaId: "r1" });
    await addCandidate("c1", "r1", "A:1", { estado: "validado" });
    await regeneratePages(deps(SAME_DAY));
    expect(await pageKeys()).toEqual(["archivo"]);
    const [row] = await db.all<{ html: string }>("SELECT html FROM paginas");
    expect(row?.html).toContain("Todavía no hay imperdibles publicados.");
  });

  it("ignores published candidates without an affiliate link", async () => {
    await seedRun(db, { fecha: "2026-11-10", modeloIds: ["A:1"], corridaId: "r1" });
    await addCandidate("c1", "r1", "A:1", { link: null });
    await regeneratePages(deps(SAME_DAY));
    expect(await pageKeys()).toEqual(["archivo"]);
  });

  it("orders by descending percentage, then title", async () => {
    await seedRun(db, { fecha: "2026-11-10", modeloIds: ["A:1", "A:2", "A:3"], corridaId: "r1" });
    await addCandidate("c1", "r1", "A:1", { titulo: "Zeta robot", ml: 80, rival: 100 }); // 20.0%
    await addCandidate("c2", "r1", "A:2", { titulo: "Alfa robot", ml: 80, rival: 100 }); // 20.0%
    await addCandidate("c3", "r1", "A:3", { titulo: "Mayor robot", ml: 50, rival: 100 }); // 50.0%
    await regeneratePages(deps(SAME_DAY));
    const [row] = await db.all<{ html: string }>("SELECT html FROM paginas WHERE clave = 'archivo'");
    const html = row?.html ?? "";
    const at = (t: string) => html.indexOf(t);
    expect(at("Mayor robot")).toBeGreaterThan(-1);
    expect(at("Mayor robot")).toBeLessThan(at("Alfa robot"));
    expect(at("Alfa robot")).toBeLessThan(at("Zeta robot"));
  });

  it("keeps only the earliest-published candidate per model", async () => {
    await seedRun(db, { fecha: "2026-11-10", modeloIds: ["A:1"], corridaId: "r1" });
    await addCandidate("c1", "r1", "A:1", { titulo: "Segundo", publishedAt: "2026-11-10T11:10:00-03:00" });
    await addCandidate("c2", "r1", "A:1", { titulo: "Primero", publishedAt: "2026-11-10T11:05:00-03:00" });
    await regeneratePages(deps(SAME_DAY));
    const [row] = await db.all<{ html: string }>("SELECT html FROM paginas WHERE clave = 'archivo'");
    expect(row?.html).toContain("Primero");
    expect(row?.html).not.toContain("Segundo");
  });

  it("replaces the previous rows on a second run", async () => {
    await seedRun(db, { fecha: "2026-11-10", modeloIds: ["A:1", "A:2"], corridaId: "r1" });
    await addCandidate("c1", "r1", "A:1", { titulo: "Primero" });
    await regeneratePages(deps(SAME_DAY));
    await addCandidate("c2", "r1", "A:2", { titulo: "Segundo" });
    await regeneratePages(deps(SAME_DAY));
    expect(await pageKeys()).toEqual(["archivo", "hoy:2026-11-10"]);
    const [row] = await db.all<{ html: string }>("SELECT html FROM paginas WHERE clave = 'archivo'");
    expect(row?.html).toContain("Segundo");
  });

  it("writes nothing when rendering cannot complete", async () => {
    await seedRun(db, { fecha: "2026-11-10", modeloIds: ["A:1"], corridaId: "r1" });
    await addCandidate("c1", "r1", "A:1");
    await db.run("UPDATE config SET valor = '{not json' WHERE clave = 'categorias'");
    await expect(regeneratePages(deps(SAME_DAY))).rejects.toThrow();
    expect(await pageKeys()).toEqual([]);
  });
});

describe("servePage", () => {
  it("serves the empty-database page with the cache headers", async () => {
    const res = await servePage(deps(SAME_DAY));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const html = await res.text();
    expect(html).toContain("Todavía no hay imperdibles publicados.");
    expect(html).toContain(CHANNEL_URL);
  });

  it("serves the day page after publication, the archive the next day", async () => {
    await seedRun(db, { fecha: "2026-11-10", modeloIds: ["A:1"], corridaId: "r1" });
    await addCandidate("c1", "r1", "A:1", { estado: "validado", publishedAt: undefined });
    const res = await publishNow(PUBLISH_AT);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { published: string[] }).published).toEqual(["c1"]);

    const same = await (await getHome(SAME_DAY)).text();
    expect(same).toContain("Los imperdibles de hoy");
    expect(same).toContain("https://meli.la/c1");
    expect(same).toContain('rel="sponsored noopener"');

    const next = await (await getHome(NEXT_DAY)).text();
    expect(next).toContain("Los imperdibles del 10 de noviembre de 2026");
    expect(next).not.toContain("Los imperdibles de hoy");
  });

  it("issues exactly one SQL query on the normal path", async () => {
    await seedRun(db, { fecha: "2026-11-10", modeloIds: ["A:1"], corridaId: "r1" });
    await addCandidate("c1", "r1", "A:1");
    await regeneratePages(deps(SAME_DAY));
    const all = vi.spyOn(db, "all");
    const run = vi.spyOn(db, "run");
    const res = await servePage(deps(SAME_DAY));
    expect(res.status).toBe(200);
    expect(all).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    const next = await servePage(deps(NEXT_DAY));
    expect(next.status).toBe(200);
    expect(all).toHaveBeenCalledTimes(2);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("GET / route", () => {
  it("answers HEAD with the headers and no body", async () => {
    const res = await getHome(SAME_DAY, "HEAD");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe("");
  });

  it("answers 405 for other methods", async () => {
    const res = await getHome(SAME_DAY, "POST");
    expect(res.status).toBe(405);
  });
});

describe("page failure isolation", () => {
  it("keeps the publication when regenerating the page fails", async () => {
    await seedRun(db, { fecha: "2026-11-10", modeloIds: ["A:1"], corridaId: "r1" });
    await addCandidate("c1", "r1", "A:1", { estado: "validado" });
    await db.run("DROP TABLE paginas");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await publishNow(PUBLISH_AT);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { published: string[] }).published).toEqual(["c1"]);
    const [c] = await db.all<{ estado: string }>("SELECT estado FROM candidatos WHERE id = 'c1'");
    expect(c?.estado).toBe("publicado");
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});
