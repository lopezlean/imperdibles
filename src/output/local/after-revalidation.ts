import { candidateSchema } from "../../contract/candidate-list.js";
import type { RevalidationReport } from "../../contract/local-hooks.js";
import { loadConfig } from "../../shared/config.js";
import type { SqlClient } from "../../shared/db/sql-client.js";
import { artDate, artTime } from "../../shared/time.js";
import { formatThreshold } from "../format.js";
import type { TelegramClient } from "../telegram/client.js";
import type { RenderCard } from "./send-shortlist.js";

export type AfterRevalidationDeps = {
  db: SqlClient;
  telegram: TelegramClient;
  ownerChatId: string;
  render: RenderCard;
  /** Runs the full ship (publish + build + upload); resolves with the exit code. */
  runShip: () => Promise<number>;
  now: () => Date;
};

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** `H:MM` or `HH:MM` to a zero-padded `HH:MM`, so the comparison is lexicographic and safe. */
const padTime = (t: string): string => t.trim().padStart(5, "0");

/**
 * Runs after the data pipeline revalidated the chosen candidates: tells the owner what dropped, re-uploads cards
 * whose prices changed, and runs the full ship (publish, build and upload) when the publication hour has passed and something is pending.
 * Every owner message and every re-upload is isolated, so one failure never blocks the rest.
 */
export async function afterRevalidation(deps: AfterRevalidationDeps, report: RevalidationReport): Promise<void> {
  const { db, telegram, ownerChatId, render } = deps;
  const now = deps.now();
  const config = await loadConfig(db);

  const tell = async (text: string): Promise<void> => {
    try {
      await telegram.sendMessage({ chat_id: ownerChatId, text });
    } catch (e) {
      console.error(`after-revalidation: owner message failed: ${errText(e)}`);
    }
  };

  for (const inv of report.invalidated) {
    await tell(
      inv.reason === "below_threshold"
        ? `No se publica ${inv.title}: el precio cambió y ya no pasa el ${formatThreshold(config.threshold_pct)}%.`
        : `No se publica ${inv.title}: la oferta ya no está disponible.`,
    );
  }

  const run_date = artDate(now);
  const stale = await db.all<{ id: string; payload: string }>(
    `SELECT c.id, c.payload FROM candidates c JOIN runs r ON r.id = c.run_id
     WHERE r.run_date = ? AND c.status = 'validated' AND c.telegram_file_id IS NULL`,
    [run_date],
  );
  for (const row of stale) {
    let title = row.id;
    try {
      const candidate = candidateSchema.parse(JSON.parse(row.payload));
      title = candidate.title;
      const png = await render(candidate, { run_date });
      const sent = await telegram.sendPhoto({
        chat_id: ownerChatId,
        photo: { png },
        caption: `Tarjeta actualizada: ${title}`,
      });
      await db.run("UPDATE candidates SET telegram_file_id = ? WHERE id = ?", [sent.file_id, row.id]);
    } catch (e) {
      console.error(`after-revalidation: re-upload of ${row.id} failed: ${errText(e)}`);
      await tell(`No se pudo actualizar la tarjeta de ${title}. Revisar antes de publicar.`);
    }
  }

  if (artTime(now) < padTime(config.publish_time)) return;

  let pending = report.validated.length > 0;
  if (!pending) {
    const rows = await db.all<{ n: number }>(
      `SELECT COUNT(*) AS n FROM candidates c JOIN runs r ON r.id = c.run_id
       WHERE r.run_date = ? AND c.status = 'validated'
         AND NOT EXISTS (SELECT 1 FROM posts s WHERE s.candidate_id = c.id AND s.channel = 'telegram_channel')`,
      [run_date],
    );
    pending = (rows[0]?.n ?? 0) > 0;
  }
  if (!pending) return;

  try {
    const code = await deps.runShip();
    if (code !== 0) throw new Error(`ship exited with code ${code}`);
  } catch (e) {
    console.error(`after-revalidation: ship failed: ${errText(e)}`);
    await tell("No se pudo completar el ship (publicación y web). Revisar la salida del job.");
  }
}
