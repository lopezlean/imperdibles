import type { Candidate } from "../contract/candidate-list.js";
import { buildChannelCaption, buildXPost } from "../output/publish/messages.js";
import { isInvalidFileId, type TelegramClient } from "../output/telegram/client.js";
import type { SqlClient } from "../shared/db/sql-client.js";
import { artDate, artIso } from "../shared/time.js";

/**
 * Candidates published per call. Raise to 10 only after V-O2 records the D1 per-invocation limit and the
 * 10-candidate query count fits under it (each candidate costs about 6 D1 queries plus up to 3 Telegram calls).
 */
export const PUBLISH_CAP_PER_CALL = 5;

const WINDOW_MS = 30 * 60_000;

export type PublishReport = { published: string[]; failed: string[]; stale: string[] };

type Deps = {
  db: SqlClient;
  telegram: TelegramClient;
  channelId: string;
  ownerChatId: string;
  now: () => Date;
  afterPublish: () => Promise<void>;
};

type Row = { id: string; model_id: string; payload: string; affiliate_link: string; telegram_file_id: string; validated_at: string | null };

async function sendWithRetry(telegram: TelegramClient, chatId: string, fileId: string, caption: string) {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await telegram.sendPhoto({ chat_id: chatId, photo: { fileId }, caption });
    } catch (e) {
      last = e;
      if (isInvalidFileId(e)) break; // retrying the same file_id cannot work
    }
  }
  throw last;
}

/** Publishes today's validated candidates to the channel once and hands the owner the X material. */
export async function publishValidated(deps: Deps): Promise<PublishReport> {
  const { db, telegram } = deps;
  const now = deps.now();
  const today = artDate(now);
  const report: PublishReport = { published: [], failed: [], stale: [] };

  const rows = await db.all<Row>(
    `SELECT c.* FROM candidates c JOIN runs r ON r.id = c.run_id
     WHERE r.run_date = ? AND c.status = 'validated' AND c.affiliate_link IS NOT NULL AND c.telegram_file_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM posts s WHERE s.candidate_id = c.id AND s.channel = 'telegram_channel')
     ORDER BY c.id`,
    [today],
  );

  const alertOwner = async (text: string) => {
    try {
      await telegram.sendMessage({ chat_id: deps.ownerChatId, text });
    } catch {
      // An alert failure must never abort the loop.
    }
  };

  let attempted = 0;
  let pending: { error: unknown } | undefined;
  try {
    for (const row of rows) {
      // validated_at is an artIso string with -03:00: compare as an instant, never as a string.
      const validatedAt = row.validated_at === null ? Number.NaN : Date.parse(row.validated_at);
      if (!(validatedAt >= now.getTime() - WINDOW_MS)) {
        report.stale.push(row.id);
        continue;
      }
      if (attempted >= PUBLISH_CAP_PER_CALL) break;

      const sibling = await db.all<{ id: string }>(
        `SELECT c2.id FROM candidates c2 JOIN runs r2 ON r2.id = c2.run_id
         WHERE c2.model_id = ? AND c2.id <> ? AND r2.run_date = ?
           AND (c2.status = 'published' OR EXISTS (SELECT 1 FROM posts s WHERE s.candidate_id = c2.id AND s.channel = 'telegram_channel'))
         LIMIT 1`,
        [row.model_id, row.id, today],
      );
      if (sibling.length > 0) continue; // one post per model per day; stays validated

      let candidate: Candidate;
      try {
        candidate = JSON.parse(row.payload) as Candidate;
      } catch {
        report.failed.push(row.id);
        continue;
      }

      // The claim is the guard against two concurrent calls posting the same candidate.
      const claim = await db.run("UPDATE candidates SET status = 'published' WHERE id = ? AND status = 'validated'", [row.id]);
      if (claim.changes !== 1) continue;
      attempted++;

      let sent: { message_id: number };
      try {
        sent = await sendWithRetry(telegram, deps.channelId, row.telegram_file_id, buildChannelCaption(candidate, row.affiliate_link));
      } catch (e) {
        try {
          await db.run("UPDATE candidates SET status = 'validated' WHERE id = ? AND status = 'published'", [row.id]);
          if (isInvalidFileId(e)) await db.run("UPDATE candidates SET telegram_file_id = NULL WHERE id = ?", [row.id]);
        } catch {
          await alertOwner(`No se pudo publicar ${candidate.title} y quedó marcado como publicado sin estar en el canal. Revisar a mano.`);
        }
        report.failed.push(row.id);
        await alertOwner(`No se pudo publicar ${candidate.title} en el canal. Queda validado y se reintenta en la próxima revalidación.`);
        continue;
      }
      // The post is out: from here the candidate stays published whatever happens, or the next call would repost it.
      try {
        await db.run(
          "INSERT INTO posts (candidate_id, channel, external_message_id, published_at) VALUES (?, 'telegram_channel', ?, ?)",
          [row.id, String(sent.message_id), artIso(deps.now())],
        );
      } catch {
        await alertOwner(`Se publicó ${candidate.title} en el canal, pero no se pudo registrar la salida. Queda publicado; no se reenvía.`);
      }
      report.published.push(row.id);

      try {
        const x = await telegram.sendPhoto({
          chat_id: deps.ownerChatId,
          photo: { fileId: row.telegram_file_id },
          caption: buildXPost(candidate, row.affiliate_link),
        });
        await db.run(
          "INSERT INTO posts (candidate_id, channel, external_message_id, published_at) VALUES (?, 'x_manual', ?, ?)",
          [row.id, String(x.message_id), artIso(deps.now())],
        );
      } catch {
        // The channel post is already out; a failed owner delivery must not undo or abort it.
      }
    }
  } catch (e) {
    pending = { error: e };
  }

  // Whatever happened above, a page that is missing published candidates must be regenerated.
  if (report.published.length > 0) {
    try {
      await deps.afterPublish();
    } catch (e) {
      pending ??= { error: e };
    }
  }
  if (pending) throw pending.error;
  return report;
}
