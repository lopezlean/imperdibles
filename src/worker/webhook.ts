import { parseAffiliateLink } from "../output/affiliate-link.js";
import type { SqlClient } from "../shared/db/sql-client.js";
import { artDate } from "../shared/time.js";

export type WebhookReply = { method: "sendMessage"; chat_id: number; text: string; reply_to_message_id: number };

type Deps = { db: SqlClient; ownerChatId: string; now: () => Date };

type CandidateRow = { id: string; model_id: string; payload: string; status: string; run_date: string };

const HELP =
  'Para elegir un candidato, responder a su mensaje con el enlace de afiliado. Para descartarlo, responder "rechazar".';
const OTHER_DAY = "Ese candidato es de otro día y ya no se puede publicar.";

/** Spanish label of a candidates.status value, for owner-facing replies. */
const STATUS_ES: Record<string, string> = {
  pending: "pendiente",
  chosen: "elegido",
  validated: "validado",
  discarded: "descartado",
  published: "publicado",
  invalidated: "invalidado",
};

const REASON_ES = {
  empty: "el mensaje está vacío",
  not_single_url: "tiene que ser un único enlace, sin otro texto",
  not_https: "el enlace no usa https",
  wrong_host: "el enlace no es de meli.la",
} as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function storedPayload(raw: string): { title: string; rivals: { store: string; ref: string }[] } {
  try {
    const p: unknown = JSON.parse(raw);
    if (!isRecord(p)) return { title: "", rivals: [] };
    const rivals = Array.isArray(p.others)
      ? p.others.flatMap((o: unknown) =>
          isRecord(o) && typeof o.store === "string" && typeof o.external_ref === "string"
            ? [{ store: o.store, ref: o.external_ref }]
            : [],
        )
      : [];
    return { title: typeof p.title === "string" ? p.title : "", rivals };
  } catch {
    return { title: "", rivals: [] };
  }
}

/**
 * Handles one Telegram update from the owner. The returned reply is sent as the webhook HTTP
 * response body, so no subrequest is needed. Anything not from the owner chat returns null.
 */
export async function handleTelegramUpdate(deps: Deps, update: unknown): Promise<WebhookReply | null> {
  const message = isRecord(update) ? update.message : undefined;
  if (!isRecord(message) || !isRecord(message.chat) || typeof message.chat.id !== "number") return null;
  const chatId = message.chat.id;
  if (String(chatId) !== deps.ownerChatId) return null;
  if (typeof message.message_id !== "number") return null;
  const messageId = message.message_id;

  const reply = (text: string): WebhookReply => ({
    method: "sendMessage",
    chat_id: chatId,
    text,
    reply_to_message_id: messageId,
  });

  const replied = isRecord(message.reply_to_message) ? message.reply_to_message.message_id : undefined;
  if (typeof replied !== "number") return reply(HELP);

  const rows = await deps.db.all<CandidateRow>(
    "SELECT c.id, c.model_id, c.payload, c.status, r.run_date FROM candidates c JOIN runs r ON r.id = c.run_id WHERE c.telegram_message_id = ?",
    [replied],
  );
  const cand = rows[0];
  if (!cand) return reply(HELP);
  if (cand.run_date !== artDate(deps.now())) return reply(OTHER_DAY);

  const { title, rivals } = storedPayload(cand.payload);
  const text = typeof message.text === "string" ? message.text : "";
  const unchanged = (status = cand.status) => reply(`Este candidato ya está ${STATUS_ES[status] ?? status}; no se cambió nada.`);
  // The state moved (a publish) between the SELECT and the guarded UPDATE: report the fresh state.
  const lostRace = async () => {
    const [now] = await deps.db.all<{ status: string }>("SELECT status FROM candidates WHERE id = ?", [cand.id]);
    return unchanged(now?.status ?? cand.status);
  };

  if (text.trim().toLowerCase() === "rechazar") {
    if (!["pending", "chosen", "validated"].includes(cand.status)) return unchanged();
    // Guarded claim first: if a publish won the race, the pairings must stay untouched.
    const claim = await deps.db.run(
      "UPDATE candidates SET status = 'discarded' WHERE id = ? AND status IN ('pending','chosen','validated')",
      [cand.id],
    );
    if (claim.changes !== 1) return lostRace();
    for (const r of rivals) {
      await deps.db.run(
        "UPDATE matches SET status = 'rejected' WHERE model_id = ? AND listing_id IN (SELECT id FROM store_listings WHERE store_id = ? AND external_ref = ?)",
        [cand.model_id, r.store, r.ref],
      );
    }
    return reply(`Descartado: ${title}. No se volverá a proponer.`);
  }

  const parsed = parseAffiliateLink(text);
  if (!parsed.ok) {
    return reply(`No se guardó el enlace: ${REASON_ES[parsed.reason]}. Debe ser un único enlace https://meli.la/...`);
  }
  if (cand.status !== "pending" && cand.status !== "chosen") return unchanged();
  const saved = await deps.db.run(
    "UPDATE candidates SET status = 'chosen', affiliate_link = ? WHERE id = ? AND status IN ('pending','chosen')",
    [parsed.link, cand.id],
  );
  if (saved.changes !== 1) return lostRace();
  return reply(`Enlace guardado para ${title}. Se publica tras revalidar el precio.`);
}
