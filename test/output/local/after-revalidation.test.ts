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
const RUN_DATE = "2026-11-10";
// ART is UTC-3: 10:45 ART = 13:45Z, 12:45 ART = 15:45Z.
const AT_1045 = new Date("2026-11-10T13:45:00Z");
const AT_1245 = new Date("2026-11-10T15:45:00Z");

const candidate: Candidate = parseCandidateList(
  JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "lista-candidatos", "valid-2026-11-10.json"), "utf8")),
).candidates[0]!;

async function setup(opts: { status?: string; fileId?: string | null; withPost?: boolean; seedCandidate?: boolean } = {}) {
  const db = createSqliteClient();
  const { runId } = await seedRun(db, { run_date: RUN_DATE, modelIds: [candidate.model_id] });
  if (opts.seedCandidate !== false) {
    await db.run(
      "INSERT INTO candidates (id, run_id, model_id, payload, status, telegram_file_id, validated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        candidate.candidate_id,
        runId,
        candidate.model_id,
        JSON.stringify(candidate),
        opts.status ?? "validated",
        opts.fileId === undefined ? null : opts.fileId,
        "2026-11-10T10:40:00-03:00",
      ],
    );
    if (opts.withPost) {
      await db.run("INSERT INTO posts (candidate_id, channel, published_at) VALUES (?, 'telegram_channel', ?)", [
        candidate.candidate_id,
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

function fakeShip(result: number | Error = 0) {
  const calls = { n: 0 };
  const runShip = async (): Promise<number> => {
    calls.n++;
    if (result instanceof Error) throw result;
    return result;
  };
  return { runShip, calls };
}

const render = async () => new Uint8Array([137, 80, 78, 71]);
const empty: RevalidationReport = { run_date: RUN_DATE, validated: [], invalidated: [] };

function deps(db: Awaited<ReturnType<typeof setup>>, tg: TelegramClient, runShip: () => Promise<number>, now: Date, r = render) {
  return { db, telegram: tg, ownerChatId: OWNER, render: r, runShip, now: () => now };
}

describe("afterRevalidation", () => {
  it("tells the owner about every invalidated candidate", async () => {
    const db = await setup({ seedCandidate: false });
    const { t, messages } = fakeTelegram();
    const w = fakeShip();
    await afterRevalidation(deps(db, t, w.runShip, AT_1045), {
      ...empty,
      invalidated: [
        { candidate_id: "a", title: "Robot A", reason: "below_threshold" },
        { candidate_id: "b", title: "Robot B", reason: "offer_missing" },
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
    await afterRevalidation(deps(db, t, fakeShip().runShip, AT_1045), empty);
    expect(photos).toEqual([{ caption: `Tarjeta actualizada: ${candidate.title}` }]);
    const rows = await db.all<{ telegram_file_id: string }>("SELECT telegram_file_id FROM candidates");
    expect(rows[0]!.telegram_file_id).toBe("new-file-id");
  });

  it("does not re-upload a card that already has a file_id", async () => {
    const db = await setup({ fileId: "kept" });
    const { t, photos } = fakeTelegram();
    await afterRevalidation(deps(db, t, fakeShip().runShip, AT_1045), empty);
    expect(photos).toEqual([]);
  });

  it("a failed re-upload informs the owner, continues and does not stop ship", async () => {
    const db = await setup({ fileId: null });
    const { t, messages } = fakeTelegram({ failPhoto: true });
    const w = fakeShip();
    await afterRevalidation(deps(db, t, w.runShip, AT_1245), { ...empty, validated: [candidate.candidate_id] });
    expect(messages.some((m) => m.includes(candidate.title))).toBe(true);
    expect(w.calls.n).toBe(1);
  });

  it("a failing render is handled like a failing upload", async () => {
    const db = await setup({ fileId: null });
    const { t, messages } = fakeTelegram();
    const w = fakeShip();
    await afterRevalidation(
      deps(db, t, w.runShip, AT_1245, () => Promise.reject(new Error("no renderer"))),
      { ...empty, validated: [candidate.candidate_id] },
    );
    expect(messages.some((m) => m.includes(candidate.title))).toBe(true);
    expect(w.calls.n).toBe(1);
  });

  it("does not run ship before publish_time", async () => {
    const db = await setup({ fileId: "f" });
    const w = fakeShip();
    await afterRevalidation(deps(db, fakeTelegram().t, w.runShip, AT_1045), { ...empty, validated: [candidate.candidate_id] });
    expect(w.calls.n).toBe(0);
  });

  it("runs ship once when the hour has passed and something is pending", async () => {
    const db = await setup({ fileId: "f" });
    const w = fakeShip();
    await afterRevalidation(deps(db, fakeTelegram().t, w.runShip, AT_1245), { ...empty, validated: [candidate.candidate_id] });
    expect(w.calls.n).toBe(1);
  });

  it("does not run ship when nothing is pending", async () => {
    const db = await setup({ fileId: "f", withPost: true });
    const w = fakeShip();
    await afterRevalidation(deps(db, fakeTelegram().t, w.runShip, AT_1245), empty);
    expect(w.calls.n).toBe(0);
  });

  it("runs ship with an empty report when a validated candidate of today has no post", async () => {
    const db = await setup({ fileId: "f" });
    const w = fakeShip();
    await afterRevalidation(deps(db, fakeTelegram().t, w.runShip, AT_1245), empty);
    expect(w.calls.n).toBe(1);
  });

  it("tells the owner when ship fails", async () => {
    const msg = "No se pudo completar el ship (publicación y web). Revisar la salida del job.";
    for (const result of [1, new Error("boom")]) {
      const db = await setup({ fileId: "f" });
      const { t, messages } = fakeTelegram();
      await afterRevalidation(deps(db, t, fakeShip(result).runShip, AT_1245), { ...empty, validated: ["x"] });
      expect(messages).toEqual([msg]);
    }
  });

  it("a failing first owner message does not stop re-uploads or ship", async () => {
    const db = await setup({ fileId: null });
    const { t, photos } = fakeTelegram({ failFirstMessage: true });
    const w = fakeShip();
    await afterRevalidation(deps(db, t, w.runShip, AT_1245), {
      ...empty,
      invalidated: [{ candidate_id: "a", title: "Robot A", reason: "offer_missing" }],
    });
    expect(photos).toHaveLength(1);
    expect(w.calls.n).toBe(1);
  });
});
