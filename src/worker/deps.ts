import type { TelegramClient } from "../output/telegram/client.js";
import type { SqlClient } from "../shared/db/sql-client.js";
import type { Env } from "./env.js";

export type WorkerDeps = {
  db: SqlClient;
  env: Env;
  now: () => Date;
  /** Handlers default to createTelegramClient({ token: env.TELEGRAM_BOT_TOKEN, fetch }); tests inject a fake. */
  telegram?: TelegramClient;
};
