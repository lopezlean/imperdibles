import { describe, expect, it } from "vitest";
import { createSqliteClient } from "../support/sqlite-client.js";
import { handleFetch } from "../../src/worker/index.js";
import type { Env } from "../../src/worker/env.js";
import type { WorkerDeps } from "../../src/worker/deps.js";
import { seedRun } from "./support/seed.js";

function makeDeps(): WorkerDeps {
  const env = {
    TELEGRAM_BOT_TOKEN: "fake-token",
    TELEGRAM_OWNER_CHAT_ID: "1",
    TELEGRAM_CHANNEL_ID: "-100",
    TELEGRAM_WEBHOOK_SECRET: "fake-secret",
    PUBLISH_NOW_SECRET: "fake-publish",
    TELEGRAM_CHANNEL_URL: "https://t.me/fake",
  } as unknown as Env;
  return { db: createSqliteClient(), env, now: () => new Date("2026-11-10T10:30:00Z") };
}

describe("worker /healthz", () => {
  it("answers 200 ok after querying the database", async () => {
    const res = await handleFetch(new Request("https://imperdibles.ar/healthz"), makeDeps());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("answers 404 for any other path", async () => {
    const res = await handleFetch(new Request("https://imperdibles.ar/nada"), makeDeps());
    expect(res.status).toBe(404);
  });

  it("answers 404 for non-GET on /healthz", async () => {
    const res = await handleFetch(new Request("https://imperdibles.ar/healthz", { method: "POST" }), makeDeps());
    expect(res.status).toBe(404);
  });
});

describe("seedRun", () => {
  it("inserts the rows candidatos foreign keys need", async () => {
    const db = createSqliteClient();
    const { corridaId } = await seedRun(db, { fecha: "2026-11-10", modeloIds: ["A:1", "B:2"] });
    await db.run(
      "INSERT INTO candidatos (id, corrida_id, modelo_id, payload, estado) VALUES ('c1', ?, 'A:1', '{}', 'pendiente')",
      [corridaId],
    );
    const rows = await db.all<{ n: number }>("SELECT COUNT(*) AS n FROM modelos");
    expect(rows[0]?.n).toBe(2);
  });
});
