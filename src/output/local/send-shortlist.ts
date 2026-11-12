import type { Candidate, CandidateList } from "../../contract/candidate-list.js";
import { buildAffiliateLink, type AffiliateIds } from "../affiliate-link.js";
import type { SqlClient } from "../../shared/db/sql-client.js";
import { buildNoCandidatesText, buildShortlistCaption } from "../shortlist/messages.js";
import type { TelegramClient } from "../telegram/client.js";

const MAX_CANDIDATES = 10;

export type RenderCard = (c: Candidate, opts: { run_date: string }) => Promise<Uint8Array>;

export type SendShortlistDeps = { db: SqlClient; telegram: TelegramClient; ownerChatId: string; render: RenderCard;
  /** Automatic affiliate mode: when set, each candidate gets its link built from the Mercado Libre URL. */
  affiliate?: AffiliateIds;
};

/** The automatic link, or null (manual flow for this candidate) when the ML URL cannot take one. */
function autoLink(c: Candidate, ids: AffiliateIds): string | null {
  try {
    return buildAffiliateLink(c.ml.url, ids);
  } catch {
    return null;
  }
}

/**
 * Sends the first 10 candidates to the owner as cards and records the Telegram ids.
 * Candidates whose row already has `telegram_message_id` are skipped, so a re-run only sends what is missing.
 * One failure is logged and the rest continue.
 */
export async function sendShortlist(
  deps: SendShortlistDeps,
  list: CandidateList,
): Promise<{ sent: number; failed: number }> {
  const { db, telegram, ownerChatId, render, affiliate } = deps;
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
      const png = await render(c, { run_date: list.run_date });
      const auto = affiliate ? autoLink(c, affiliate) : null;
      const r = await telegram.sendPhoto({
        chat_id: ownerChatId,
        photo: { png },
        caption: buildShortlistCaption(c, { autoAffiliate: auto !== null }),
      });
      if (auto === null) {
        await db.run("UPDATE candidates SET telegram_file_id = ?, telegram_message_id = ? WHERE id = ?", [
          r.file_id,
          r.message_id,
          c.candidate_id,
        ]);
      } else {
        await db.run(
          "UPDATE candidates SET telegram_file_id = ?, telegram_message_id = ?, affiliate_link = ? WHERE id = ?",
          [r.file_id, r.message_id, auto, c.candidate_id],
        );
      }
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
