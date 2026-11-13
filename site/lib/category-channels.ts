import type { SqlClient } from "../../src/shared/db/sql-client.js";

const PREFIX = "tg_cat:";

/** category id -> public Telegram handle ("@name"), from the config table. */
export async function loadCategoryChannels(db: SqlClient): Promise<Record<string, string>> {
  const rows = await db.all<{ name: string; value: string }>("SELECT name, value FROM config WHERE name LIKE ?", [`${PREFIX}%`]);
  return Object.fromEntries(rows.map((r) => [r.name.slice(PREFIX.length), r.value]));
}

/** Public URL of a channel handle. */
export const channelUrlOf = (handle: string): string => `https://t.me/${handle.replace(/^@/, "")}`;
