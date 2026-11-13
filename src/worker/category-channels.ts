import type { SqlClient } from "../shared/db/sql-client.js";

/** Config key holding the public Telegram handle ("@name") of a category's channel. */
export const categoryChannelKey = (categoryId: string): string => `tg_cat:${categoryId}`;

/** The configured channel handle of a category, or null. */
export async function getCategoryChannel(db: SqlClient, categoryId: string): Promise<string | null> {
  const rows = await db.all<{ value: string }>("SELECT value FROM config WHERE name = ?", [categoryChannelKey(categoryId)]);
  return rows[0]?.value ?? null;
}
