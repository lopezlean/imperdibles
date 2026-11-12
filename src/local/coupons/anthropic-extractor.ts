import { z } from "zod";
import { artDate, artTime } from "../../shared/time.js";
import { ExtractionError, extractionResultSchema, type CouponExtractor } from "./extractor.js";

export const DEFAULT_MODEL = "claude-haiku-5-5";

export type AnthropicLike = {
  messages: {
    create(params: Record<string, unknown>): Promise<{ content: { type: string; input?: unknown }[] }>;
  };
};

const TOOL_NAME = "report_coupons";

const SYSTEM_PROMPT = `Extraés cupones de descuento de mensajes de un canal argentino de ofertas de Mercado Libre.
Respondé siempre llamando a la herramienta ${TOOL_NAME}.

Reglas:
- Solo reportá códigos que aparecen literalmente en el texto; nunca inventes un código ni lo completes o corrijas.
- Los montos van como números enteros en pesos, sin separadores ni símbolo (20.000 -> 20000).
- Si el descuento es porcentual, discount_type es "percent" y discount_value es el número del porcentaje (25% -> 25). Si es un monto fijo, "amount".
- min_purchase es la compra mínima y cap el tope de descuento; usá null si el mensaje no los indica.
- scope describe cómo el mensaje limita el cupón (categoría, tienda, medio de pago, etc.); dejalo vacío si no dice nada.
- valid_from y valid_until son hora de pared de Argentina (ART), formato "YYYY-MM-DD" o "YYYY-MM-DDTHH:MM". Resolvé frases como "Del 2 al 9 de noviembre" usando el año de la fecha del mensaje.
- Si el mensaje no indica inicio, valid_from es null; si no indica fin, valid_until es null.
- Los recordatorios ("Siguen vigentes") también devuelven sus códigos.
- Si el mensaje no contiene cupones, devolvé una lista vacía.`;

export function createAnthropicExtractor(cfg: { client: AnthropicLike; model: string }): CouponExtractor {
  return {
    async extract(post) {
      let response: Awaited<ReturnType<AnthropicLike["messages"]["create"]>>;
      try {
        response = await cfg.client.messages.create({
          model: cfg.model,
          max_tokens: 2000,
          system: SYSTEM_PROMPT,
          tools: [
            {
              name: TOOL_NAME,
              description: "Reporta los cupones de descuento encontrados en el mensaje (lista vacía si no hay).",
              input_schema: z.toJSONSchema(extractionResultSchema),
            },
          ],
          tool_choice: { type: "tool", name: TOOL_NAME },
          messages: [
            {
              role: "user",
              content: `Fecha del mensaje (ART): ${artDate(post.postedAt)} ${artTime(post.postedAt)}\n\nMensaje:\n${post.text}`,
            },
          ],
        });
      } catch (err) {
        // Only the error class name: SDK errors can carry request headers or echo the key.
        const name = err instanceof Error ? err.name : "unknown error";
        throw new ExtractionError(`Anthropic request failed (${name})`);
      }
      const block = response.content.find((b) => b.type === "tool_use");
      if (!block) throw new ExtractionError("Anthropic response had no tool_use block");
      const parsed = extractionResultSchema.safeParse(block.input);
      if (!parsed.success) throw new ExtractionError("Anthropic tool output did not match the coupon schema");
      return parsed.data.coupons;
    },
  };
}
