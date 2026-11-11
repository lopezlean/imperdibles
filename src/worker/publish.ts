import type { Candidate } from "../contract/candidate-list.js";
import { buildChannelCaption, buildXPost } from "../output/publish/messages.js";
import { isInvalidFileId, type TelegramClient } from "../output/telegram/client.js";
import type { SqlClient } from "../shared/db/sql-client.js";
import { artDate, artIso } from "../shared/time.js";

/**
 * Candidates published per call. V-O2 (D1 per-invocation query limit) is PENDING OWNER: if the real
 * limit is 50, lower this to 5. 10 x (2 channel attempts + 1 owner message) + 1 alert stays under 50 subrequests.
 */
export const PUBLISH_CAP_PER_CALL = 10;

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

type Row = { id: string; modelo_id: string; payload: string; enlace_afiliado: string; telegram_file_id: string; validado_en: string | null };

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
    `SELECT c.* FROM candidatos c JOIN corridas r ON r.id = c.corrida_id
     WHERE r.fecha = ? AND c.estado = 'validado' AND c.enlace_afiliado IS NOT NULL AND c.telegram_file_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM salidas s WHERE s.candidato_id = c.id AND s.canal = 'telegram_canal')
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
  for (const row of rows) {
    // validado_en is an artIso string with -03:00: compare as an instant, never as a string.
    const validatedAt = row.validado_en === null ? Number.NaN : Date.parse(row.validado_en);
    if (!(validatedAt >= now.getTime() - WINDOW_MS)) {
      report.stale.push(row.id);
      continue;
    }
    if (attempted >= PUBLISH_CAP_PER_CALL) break;

    const sibling = await db.all<{ id: string }>(
      `SELECT c2.id FROM candidatos c2 JOIN corridas r2 ON r2.id = c2.corrida_id
       WHERE c2.modelo_id = ? AND c2.id <> ? AND r2.fecha = ?
         AND (c2.estado = 'publicado' OR EXISTS (SELECT 1 FROM salidas s WHERE s.candidato_id = c2.id AND s.canal = 'telegram_canal'))
       LIMIT 1`,
      [row.modelo_id, row.id, today],
    );
    if (sibling.length > 0) continue; // one post per model per day; stays validado

    let candidate: Candidate;
    try {
      candidate = JSON.parse(row.payload) as Candidate;
    } catch {
      report.failed.push(row.id);
      continue;
    }

    // The claim is the guard against two concurrent calls posting the same candidate.
    const claim = await db.run("UPDATE candidatos SET estado = 'publicado' WHERE id = ? AND estado = 'validado'", [row.id]);
    if (claim.changes !== 1) continue;
    attempted++;

    try {
      const sent = await sendWithRetry(telegram, deps.channelId, row.telegram_file_id, buildChannelCaption(candidate, row.enlace_afiliado));
      await db.run(
        "INSERT INTO salidas (candidato_id, canal, mensaje_externo_id, publicado_en) VALUES (?, 'telegram_canal', ?, ?)",
        [row.id, String(sent.message_id), artIso(deps.now())],
      );
    } catch (e) {
      await db.run("UPDATE candidatos SET estado = 'validado' WHERE id = ? AND estado = 'publicado'", [row.id]);
      if (isInvalidFileId(e)) await db.run("UPDATE candidatos SET telegram_file_id = NULL WHERE id = ?", [row.id]);
      report.failed.push(row.id);
      await alertOwner(`No se pudo publicar ${candidate.titulo} en el canal. Queda validado y se reintenta en la próxima revalidación.`);
      continue;
    }
    report.published.push(row.id);

    try {
      const x = await telegram.sendPhoto({
        chat_id: deps.ownerChatId,
        photo: { fileId: row.telegram_file_id },
        caption: buildXPost(candidate, row.enlace_afiliado),
      });
      await db.run(
        "INSERT INTO salidas (candidato_id, canal, mensaje_externo_id, publicado_en) VALUES (?, 'x_manual', ?, ?)",
        [row.id, String(x.message_id), artIso(deps.now())],
      );
    } catch {
      // The channel post is already out; a failed owner delivery must not undo or abort it.
    }
  }

  if (report.published.length > 0) await deps.afterPublish();
  return report;
}
