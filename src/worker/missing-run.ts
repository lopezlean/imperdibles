import type { TelegramClient } from "../output/telegram/client.js";
import type { SqlClient } from "../shared/db/sql-client.js";
import { artDate } from "../shared/time.js";

const MISSING_RUN_TEXT = "Hoy no se recolectó nada. Se puede correr a mano con: imperdibles correr";

/** Tells the owner when no run exists for today's ART date (any estado counts as a run). Returns true if it alerted. */
export async function checkMissingRun(deps: {
  db: SqlClient;
  telegram: TelegramClient;
  ownerChatId: string;
  now: () => Date;
}): Promise<boolean> {
  const rows = await deps.db.all<{ id: string }>("SELECT id FROM corridas WHERE fecha = ? LIMIT 1", [artDate(deps.now())]);
  if (rows.length > 0) return false;
  await deps.telegram.sendMessage({ chat_id: deps.ownerChatId, text: MISSING_RUN_TEXT });
  return true;
}
