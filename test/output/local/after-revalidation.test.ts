import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCandidateList, type Candidate } from "../../../src/contract/candidate-list.js";
import type { RevalidationReport } from "../../../src/contract/local-hooks.js";
import { afterRevalidation } from "../../../src/output/local/after-revalidation.js";
import type { TelegramClient } from "../../../src/output/telegram/client.js";
import { createSqliteClient } from "../../support/sqlite-client.js";
import { seedRun } from "../../worker/support/seed.js";

const OWNER = "42";
const SECRET = "publish-secret";
const BASE = "https://worker.example";
const FECHA = "2026-11-10";
// ART is UTC-3: 10:45 ART = 13:45Z, 12:45 ART = 15:45Z.
const AT_1045 = new Date("2026-11-10T13:45:00Z");
const AT_1245 = new Date("2026-11-10T15:45:00Z");

const candidate: Candidate = parseCandidateList(
  JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "lista-candidatos", "valid-2026-11-10.json"), "utf8")),
).candidatos[0]!;

async function setup(opts: { estado?: string; fileId?: string | null; withSalida?: boolean; seedCandidate?: boolean } = {}) {
  const db = createSqliteClient();
  const { corridaId } = await seedRun(db, { fecha: FECHA, modeloIds: [candidate.modelo_id] });
  if (opts.seedCandidate !== false) {
    await db.run(
      "INSERT INTO candidatos (id, corrida_id, modelo_id, payload, estado, telegram_file_id, validado_en) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        candidate.candidato_id,
        corridaId,
        candidate.modelo_id,
        JSON.stringify(candidate),
        opts.estado ?? "validado",
        opts.fileId === undefined ? null : opts.fileId,
        "2026-11-10T10:40:00-03:00",
      ],
    );
    if (opts.withSalida) {
      await db.run("INSERT INTO salidas (candidato_id, canal, publicado_en) VALUES (?, 'telegram_canal', ?)", [
        candidate.candidato_id,
        "2026-11-10T11:00:00-03:00",
      ]);
    }
  }
  return db;
}

function fakeTelegram(opts: { failFirstMessage?: boolean; failPhoto?: boolean } = {}) {
  const messages: string[] = [];
  const photos: { caption: string }[] = [];
  let msgCalls = 0;
  const t: TelegramClient = {
    async sendMessage(p) {
      msgCalls++;
      if (opts.failFirstMessage && msgCalls === 1) throw new Error("telegram down");
      messages.push(p.text);
      return { message_id: 1 };
    },
    async sendPhoto(p) {
      if (opts.failPhoto) throw new Error("photo failed");
      photos.push({ caption: p.caption });
      return { message_id: 9, file_id: "new-file-id" };
    },
  };
  return { t, messages, photos };
}

function fakeWorker(status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("{}", { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const render = async () => new Uint8Array([137, 80, 78, 71]);
const empty: RevalidationReport = { fecha: FECHA, validated: [], invalidated: [] };

function deps(db: Awaited<ReturnType<typeof setup>>, tg: TelegramClient, f: typeof fetch, now: Date, r = render) {
  return { db, telegram: tg, ownerChatId: OWNER, render: r, fetch: f, workerBaseUrl: BASE, publishSecret: SECRET, now: () => now };
}

describe("afterRevalidation", () => {
  it("tells the owner about every invalidated candidate", async () => {
    const db = await setup({ seedCandidate: false });
    const { t, messages } = fakeTelegram();
    const w = fakeWorker();
    await afterRevalidation(deps(db, t, w.f, AT_1045), {
      ...empty,
      invalidated: [
        { candidato_id: "a", titulo: "Robot A", reason: "below_threshold" },
        { candidato_id: "b", titulo: "Robot B", reason: "offer_missing" },
      ],
    });
    expect(messages).toEqual([
      "No se publica Robot A: el precio cambió y ya no pasa el 15%.",
      "No se publica Robot B: la oferta ya no está disponible.",
    ]);
  });

  it("re-uploads a validated card without file_id and stores the new one", async () => {
    const db = await setup({ fileId: null });
    const { t, photos } = fakeTelegram();
    await afterRevalidation(deps(db, t, fakeWorker().f, AT_1045), empty);
    expect(photos).toEqual([{ caption: `Tarjeta actualizada: ${candidate.titulo}` }]);
    const rows = await db.all<{ telegram_file_id: string }>("SELECT telegram_file_id FROM candidatos");
    expect(rows[0]!.telegram_file_id).toBe("new-file-id");
  });

  it("does not re-upload a card that already has a file_id", async () => {
    const db = await setup({ fileId: "kept" });
    const { t, photos } = fakeTelegram();
    await afterRevalidation(deps(db, t, fakeWorker().f, AT_1045), empty);
    expect(photos).toEqual([]);
  });

  it("a failed re-upload informs the owner, continues and does not stop publish-now", async () => {
    const db = await setup({ fileId: null });
    const { t, messages } = fakeTelegram({ failPhoto: true });
    const w = fakeWorker();
    await afterRevalidation(deps(db, t, w.f, AT_1245), { ...empty, validated: [candidate.candidato_id] });
    expect(messages.some((m) => m.includes(candidate.titulo))).toBe(true);
    expect(w.calls).toHaveLength(1);
  });

  it("a failing render is handled like a failing upload", async () => {
    const db = await setup({ fileId: null });
    const { t, messages } = fakeTelegram();
    const w = fakeWorker();
    await afterRevalidation(
      deps(db, t, w.f, AT_1245, () => Promise.reject(new Error("no renderer"))),
      { ...empty, validated: [candidate.candidato_id] },
    );
    expect(messages.some((m) => m.includes(candidate.titulo))).toBe(true);
    expect(w.calls).toHaveLength(1);
  });

  it("does not call publish-now before the publication hour", async () => {
    const db = await setup({ fileId: "f" });
    const w = fakeWorker();
    await afterRevalidation(deps(db, fakeTelegram().t, w.f, AT_1045), { ...empty, validated: [candidate.candidato_id] });
    expect(w.calls).toHaveLength(0);
  });

  it("calls publish-now once with the Bearer secret after the hour when something validated", async () => {
    const db = await setup({ fileId: "f" });
    const w = fakeWorker();
    await afterRevalidation(deps(db, fakeTelegram().t, w.f, AT_1245), { ...empty, validated: [candidate.candidato_id] });
    expect(w.calls).toHaveLength(1);
    expect(w.calls[0]!.url).toBe(`${BASE}/internal/publish-now`);
    expect(w.calls[0]!.init.method).toBe("POST");
    expect((w.calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
  });

  it("trims one trailing slash from the base url", async () => {
    const db = await setup({ fileId: "f" });
    const w = fakeWorker();
    await afterRevalidation(
      { ...deps(db, fakeTelegram().t, w.f, AT_1245), workerBaseUrl: `${BASE}/` },
      { ...empty, validated: ["x"] },
    );
    expect(w.calls[0]!.url).toBe(`${BASE}/internal/publish-now`);
  });

  it("does not call publish-now with an empty report and nothing pending", async () => {
    const db = await setup({ fileId: "f", withSalida: true });
    const w = fakeWorker();
    await afterRevalidation(deps(db, fakeTelegram().t, w.f, AT_1245), empty);
    expect(w.calls).toHaveLength(0);
  });

  it("calls publish-now with an empty report when a validated candidate of today has no salida", async () => {
    const db = await setup({ fileId: "f" });
    const w = fakeWorker();
    await afterRevalidation(deps(db, fakeTelegram().t, w.f, AT_1245), empty);
    expect(w.calls).toHaveLength(1);
  });

  it("a publish-now 500 informs the owner and does not throw", async () => {
    const db = await setup({ fileId: "f" });
    const { t, messages } = fakeTelegram();
    await afterRevalidation(deps(db, t, fakeWorker(500).f, AT_1245), { ...empty, validated: ["x"] });
    expect(messages).toHaveLength(1);
    expect(messages[0]).not.toContain(SECRET);
  });

  it("a network failure on publish-now informs the owner and does not throw", async () => {
    const db = await setup({ fileId: "f" });
    const { t, messages } = fakeTelegram();
    const f = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await afterRevalidation(deps(db, t, f, AT_1245), { ...empty, validated: ["x"] });
    expect(messages).toHaveLength(1);
  });

  it("a failing first owner message does not stop re-uploads or publish-now", async () => {
    const db = await setup({ fileId: null });
    const { t, photos } = fakeTelegram({ failFirstMessage: true });
    const w = fakeWorker();
    await afterRevalidation(deps(db, t, w.f, AT_1245), {
      ...empty,
      invalidated: [{ candidato_id: "a", titulo: "Robot A", reason: "offer_missing" }],
    });
    expect(photos).toHaveLength(1);
    expect(w.calls).toHaveLength(1);
  });
});
