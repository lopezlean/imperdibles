import type { LocalOutputHooks } from "../contract/local-hooks.js";
import { renderOwnerAlert } from "../output/alerts.js";
import { afterRevalidation } from "../output/local/after-revalidation.js";
import { renderCardPng } from "../output/card/render.js";
import { sendShortlist } from "../output/local/send-shortlist.js";
import { createTelegramClient } from "../output/telegram/client.js";
import type { SqlClient } from "../shared/db/sql-client.js";
import type { LocalEnv } from "../shared/env.js";

export type OutputHookDeps = { db: SqlClient; env: LocalEnv; now: () => Date; fetch: typeof fetch };

export function createOutputHooks(deps: OutputHookDeps): LocalOutputHooks {
  const { db, env } = deps;
  const missing = [
    env.telegramBotToken === "" ? "TELEGRAM_BOT_TOKEN" : null,
    env.telegramOwnerChatId === "" ? "TELEGRAM_OWNER_CHAT_ID" : null,
  ].filter((n): n is string => n !== null);
  if (missing.length > 0) throw new Error(`Missing environment variables: ${missing.join(", ")}`);

  const telegram = createTelegramClient({ token: env.telegramBotToken, fetch: deps.fetch });
  const ownerChatId = env.telegramOwnerChatId;

  return {
    async onCandidatesReady(list) {
      const r = await sendShortlist({ db, telegram, ownerChatId, render: renderCardPng }, list);
      if (r.sent === 0 && r.failed > 0) {
        throw new Error(`No se pudo enviar ninguno de los ${r.failed} candidatos de la lista de hoy.`);
      }
    },
    onRevalidated: (report) => {
      const absent = [
        env.workerBaseUrl === "" ? "WORKER_BASE_URL" : null,
        env.publishNowSecret === "" ? "PUBLISH_NOW_SECRET" : null,
      ].filter((n): n is string => n !== null);
      if (absent.length > 0) return Promise.reject(new Error(`Missing environment variables: ${absent.join(", ")}`));
      return afterRevalidation(
        {
          db,
          telegram,
          ownerChatId,
          render: renderCardPng,
          fetch: deps.fetch,
          workerBaseUrl: env.workerBaseUrl,
          publishSecret: env.publishNowSecret,
          now: deps.now,
        },
        report,
      );
    },
    async notifyOwner(alert) {
      await telegram.sendMessage({ chat_id: ownerChatId, text: renderOwnerAlert(alert) });
    },
  };
}
