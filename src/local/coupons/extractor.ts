import { z } from "zod";
import type { ExtractedCoupon } from "../../contract/coupon.js";
import { artDate, artTime } from "../../shared/time.js";

const validity = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/).nullable();

export const extractedCouponSchema: z.ZodType<ExtractedCoupon> = z.object({
  code: z.string(),
  discount_type: z.enum(["amount", "percent"]),
  discount_value: z.number().int().positive(),
  min_purchase: z.number().int().positive().nullable(),
  cap: z.number().int().positive().nullable(),
  scope: z.string(),
  valid_from: validity,
  valid_until: validity,
});

export const extractionResultSchema: z.ZodType<{ coupons: ExtractedCoupon[] }> = z.object({
  coupons: z.array(extractedCouponSchema),
});

export interface CouponExtractor {
  extract(post: { text: string; postedAt: Date }): Promise<ExtractedCoupon[]>;
}

/** Extraction failed (transport, missing tool call or invalid output). Messages never carry secrets. */
export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

export const TOOL_NAME = "report_coupons";

export const SYSTEM_PROMPT = `Extraés cupones de descuento de mensajes de un canal argentino de ofertas de Mercado Libre.
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

export const TOOL_DESCRIPTION = "Reporta los cupones de descuento encontrados en el mensaje (lista vacía si no hay).";

/** JSON schema of the report_coupons tool input, shared by every adapter. */
export const couponToolSchema = (): Record<string, unknown> => z.toJSONSchema(extractionResultSchema) as Record<string, unknown>;

/** The user turn: the post's ART date plus its text. */
export const userContent = (post: { text: string; postedAt: Date }): string =>
  `Fecha del mensaje (ART): ${artDate(post.postedAt)} ${artTime(post.postedAt)}\n\nMensaje:\n${post.text}`;
