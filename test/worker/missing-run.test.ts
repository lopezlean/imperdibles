import { describe, expect, it, vi } from "vitest";
import type { TelegramClient } from "../../src/output/telegram/client.js";
import { checkMissingRun } from "../../src/worker/missing-run.js";
import { createSqliteClient } from "../support/sqlite-client.js";
import { seedRun } from "./support/seed.js";

const NOW = new Date("2026-11-10T10:30:00Z"); // 07:30 ART

function fakeTelegram() {
  const sendMessage = vi.fn(async () => ({ message_id: 1 }));
  const sendPhoto = vi.fn(async () => ({ message_id: 1, file_id: "f" }));
  return { sendMessage, sendPhoto } as unknown as TelegramClient & { sendMessage: typeof sendMessage };
}

describe("checkMissingRun", () => {
  it("messages the owner when there is no run today", async () => {
    const db = createSqliteClient();
    const telegram = fakeTelegram();
    expect(await checkMissingRun({ db, telegram, ownerChatId: "42", now: () => NOW })).toBe(true);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessage).toHaveBeenCalledWith({
      chat_id: "42",
      text: "Hoy no se recolectó nada. Se puede correr a mano con: imperdibles correr",
    });
  });

  it("messages the owner when the only run is from yesterday", async () => {
    const db = createSqliteClient();
    await seedRun(db, { fecha: "2026-11-09" });
    const telegram = fakeTelegram();
    expect(await checkMissingRun({ db, telegram, ownerChatId: "42", now: () => NOW })).toBe(true);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("stays silent when a run exists today, whatever its estado", async () => {
    const db = createSqliteClient();
    await seedRun(db, { fecha: "2026-11-10" });
    await db.run("UPDATE corridas SET estado = 'fallida'");
    const telegram = fakeTelegram();
    expect(await checkMissingRun({ db, telegram, ownerChatId: "42", now: () => NOW })).toBe(false);
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });
});
