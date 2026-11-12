import { AFFILIATE_REASON_ES, parseAffiliateLink } from "../output/affiliate-link.js";
import type { TelegramClient } from "../output/telegram/client.js";
import type { SqlClient } from "../shared/db/sql-client.js";
import { artDate, artIso } from "../shared/time.js";

export type WebhookReply = { method: "sendMessage"; chat_id: number; text: string; reply_to_message_id: number };

type Deps = {
  db: SqlClient;
  ownerChatId: string;
  channelId: string;
  telegram: Pick<TelegramClient, "deleteMessage">;
  now: () => Date;
};

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

type CouponRow = { id: number; code: string; status: string; channel_message_id: number | null };

const COUPON_HELP = 'Para bajar este cupón, responder "rechazar".';
const COUPON_ALREADY_REMOVED = "Ese cupón ya está retirado; no se cambió nada.";

/** A reply to a coupon notice: only "rechazar" does anything. Reached when no candidate owns the replied message. */
async function handleCouponReply(
  deps: Deps,
  replied: number,
  text: string,
  reply: (text: string) => WebhookReply,
): Promise<WebhookReply> {
  const [coupon] = await deps.db.all<CouponRow>(
    "SELECT id, code, status, channel_message_id FROM coupons WHERE owner_message_id = ?",
    [replied],
  );
  if (!coupon) return reply(HELP);
  if (text.trim().toLowerCase() !== "rechazar") return reply(COUPON_HELP);
  if (coupon.status === "removed") return reply(COUPON_ALREADY_REMOVED);
  // Guarded claim first: a concurrent rechazar must not delete the channel message twice.
  const claim = await deps.db.run(
    "UPDATE coupons SET status = 'removed', updated_at = ? WHERE id = ? AND status IN ('pending','published')",
    [artIso(deps.now()), coupon.id],
  );
  if (claim.changes !== 1) return reply(COUPON_ALREADY_REMOVED);
  if (coupon.channel_message_id !== null) {
    try {
      await deps.telegram.deleteMessage({ chat_id: deps.channelId, message_id: coupon.channel_message_id });
    } catch {
      return reply("Cupón retirado de la web, pero no se pudo borrar el mensaje del canal. Borrarlo a mano.");
    }
  }
  return reply(`Cupón retirado: ${coupon.code}. Se quita de la web en la próxima actualización (hasta una hora).`);
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
  if (!cand) return handleCouponReply(deps, replied, typeof message.text === "string" ? message.text : "", reply);
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
    return reply(`No se guardó el enlace: ${AFFILIATE_REASON_ES[parsed.reason]}. Debe ser un único enlace https://meli.la/...`);
  }
  if (cand.status !== "pending" && cand.status !== "chosen") return unchanged();
  const saved = await deps.db.run(
    "UPDATE candidates SET status = 'chosen', affiliate_link = ? WHERE id = ? AND status IN ('pending','chosen')",
    [parsed.link, cand.id],
  );
  if (saved.changes !== 1) return lostRace();
  return reply(`Enlace guardado para ${title}. Se publica tras revalidar el precio.`);
}
