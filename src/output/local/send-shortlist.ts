import type { Candidate, CandidateList } from "../../contract/candidate-list.js";
import type { SqlClient } from "../../shared/db/sql-client.js";
import { buildNoCandidatesText, buildShortlistCaption } from "../shortlist/messages.js";
import type { TelegramClient } from "../telegram/client.js";

const MAX_CANDIDATES = 10;

export type RenderCard = (c: Candidate, opts: { run_date: string; category?: string | null }) => Promise<Uint8Array>;

export type SendShortlistDeps = { db: SqlClient; telegram: TelegramClient; ownerChatId: string; render: RenderCard };

/**
 * Sends the first 10 candidates to the owner as cards and records the Telegram ids.
 * Candidates whose row already has `telegram_message_id` are skipped, so a re-run only sends what is missing.
 * One failure is logged and the rest continue.
 */
export async function sendShortlist(
  deps: SendShortlistDeps,
  list: CandidateList,
): Promise<{ sent: number; failed: number }> {
  const { db, telegram, ownerChatId, render } = deps;
  if (list.candidates.length === 0) {
    await telegram.sendMessage({ chat_id: ownerChatId, text: buildNoCandidatesText(list) });
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;
  for (const c of list.candidates.slice(0, MAX_CANDIDATES)) {
    try {
      const rows = await db.all<{ telegram_message_id: number | null }>(
        "SELECT telegram_message_id FROM candidates WHERE id = ?",
        [c.candidate_id],
      );
      if (rows.length === 0) throw new Error("candidate row not found");
      if (rows[0]!.telegram_message_id !== null) continue;
      const png = await render(c, { run_date: list.run_date, category: list.category });
      const r = await telegram.sendPhoto({ chat_id: ownerChatId, photo: { png }, caption: buildShortlistCaption(c) });
      await db.run("UPDATE candidates SET telegram_file_id = ?, telegram_message_id = ? WHERE id = ?", [
        r.file_id,
        r.message_id,
        c.candidate_id,
      ]);
      sent++;
    } catch (e) {
      failed++;
      console.error(`shortlist: candidate ${c.candidate_id} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (failed > 0) {
    try {
      await telegram.sendMessage({
        chat_id: ownerChatId,
        text: `No se pudieron enviar ${failed} candidatos de la lista de hoy. Volver a correr el comando los reintenta.`,
      });
    } catch (e) {
      console.error(`shortlist: owner notice failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { sent, failed };
}
