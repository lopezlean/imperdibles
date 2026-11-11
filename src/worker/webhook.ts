import { parseAffiliateLink } from "../output/affiliate-link.js";
import type { SqlClient } from "../shared/db/sql-client.js";
import { artDate } from "../shared/time.js";

export type WebhookReply = { method: "sendMessage"; chat_id: number; text: string; reply_to_message_id: number };

type Deps = { db: SqlClient; ownerChatId: string; now: () => Date };

type CandidateRow = { id: string; modelo_id: string; payload: string; estado: string; fecha: string };

const HELP =
  'Para elegir un candidato, responder a su mensaje con el enlace de afiliado. Para descartarlo, responder "rechazar".';
const OTHER_DAY = "Ese candidato es de otro día y ya no se puede publicar.";

const REASON_ES = {
  empty: "el mensaje está vacío",
  not_single_url: "tiene que ser un único enlace, sin otro texto",
  not_https: "el enlace no usa https",
  wrong_host: "el enlace no es de meli.la",
} as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function storedPayload(raw: string): { titulo: string; rivals: { tienda: string; ref: string }[] } {
  try {
    const p: unknown = JSON.parse(raw);
    if (!isRecord(p)) return { titulo: "", rivals: [] };
    const rivals = Array.isArray(p.otras)
      ? p.otras.flatMap((o: unknown) =>
          isRecord(o) && typeof o.tienda === "string" && typeof o.ref_externa === "string"
            ? [{ tienda: o.tienda, ref: o.ref_externa }]
            : [],
        )
      : [];
    return { titulo: typeof p.titulo === "string" ? p.titulo : "", rivals };
  } catch {
    return { titulo: "", rivals: [] };
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
    "SELECT c.id, c.modelo_id, c.payload, c.estado, r.fecha FROM candidatos c JOIN corridas r ON r.id = c.corrida_id WHERE c.telegram_mensaje_id = ?",
    [replied],
  );
  const cand = rows[0];
  if (!cand) return reply(HELP);
  if (cand.fecha !== artDate(deps.now())) return reply(OTHER_DAY);

  const { titulo, rivals } = storedPayload(cand.payload);
  const text = typeof message.text === "string" ? message.text : "";
  const unchanged = () => reply(`Este candidato ya está ${cand.estado}; no se cambió nada.`);

  if (text.trim().toLowerCase() === "rechazar") {
    if (!["pendiente", "elegido", "validado"].includes(cand.estado)) return unchanged();
    // SqlClient has no batch: pairings first, candidate last, so a failure midway is retried by the same reply.
    for (const r of rivals) {
      await deps.db.run(
        "UPDATE emparejados SET estado = 'rechazado' WHERE modelo_id = ? AND publicacion_id IN (SELECT id FROM publicaciones_tienda WHERE tienda_id = ? AND ref_externa = ?)",
        [cand.modelo_id, r.tienda, r.ref],
      );
    }
    await deps.db.run("UPDATE candidatos SET estado = 'descartado' WHERE id = ?", [cand.id]);
    return reply(`Descartado: ${titulo}. No se volverá a proponer.`);
  }

  const parsed = parseAffiliateLink(text);
  if (!parsed.ok) {
    return reply(`No se guardó el enlace: ${REASON_ES[parsed.reason]}. Debe ser un único enlace https://meli.la/...`);
  }
  if (cand.estado !== "pendiente" && cand.estado !== "elegido") return unchanged();
  await deps.db.run("UPDATE candidatos SET estado = 'elegido', enlace_afiliado = ? WHERE id = ?", [parsed.link, cand.id]);
  return reply(`Enlace guardado para ${titulo}. Se publica tras revalidar el precio.`);
}
