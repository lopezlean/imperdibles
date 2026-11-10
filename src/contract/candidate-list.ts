import { z } from "zod";

/** Thrown when input does not satisfy `ListaDeCandidatos` v1. `message` lists every zod issue path. */
export class ContractError extends Error {
  constructor(
    message: string,
    readonly issues: readonly z.core.$ZodIssue[] = [],
  ) {
    super(message);
    this.name = "ContractError";
  }
}

const price = z.number().int().positive();
const isoWithZone = z.iso.datetime({ offset: true });

const offerFields = {
  tienda: z.string().min(1),
  titulo_listado: z.string(),
  url: z.string().min(1),
  precio_ars: price,
  observado_en: isoWithZone,
  ref_externa: z.string().min(1),
  vendedor: z.string().nullable(),
};

/** Mercado Libre offer: `tienda === "ml"`, with product and seller ids. */
const mlOfferSchema = z.object({
  ...offerFields,
  tienda: z.literal("ml"),
  ml_product_id: z.string().min(1),
  ml_seller_id: z.string().min(1),
});

/** Other-store offer: never "ml", never any `ml_*` key. */
const otherOfferSchema = z.strictObject({
  ...offerFields,
  tienda: z.string().min(1).refine((t) => t !== "ml", { message: 'must not be "ml"' }),
});

/** Any offer, as seen by consumers: `ml_*` keys exist only on the Mercado Libre one. */
export const storeOfferSchema = z.union([mlOfferSchema, otherOfferSchema]);

export const candidateSchema = z
  .object({
    candidato_id: z.string().min(1),
    modelo_id: z.string().min(1),
    marca: z.string().min(1),
    titulo: z.string().min(1),
    imagen_url: z.string().nullable(),
    ml: mlOfferSchema,
    otras: z.array(otherOfferSchema).min(1),
    diferencia_ars: z.number().int(),
    diferencia_pct: z.number(),
    confianza: z.literal("alta"),
    regla_emparejado: z.enum(["gtin", "marca_codigo_variante"]),
  })
  .superRefine((c, ctx) => {
    for (let i = 1; i < c.otras.length; i++) {
      if (c.otras[i]!.precio_ars < c.otras[i - 1]!.precio_ars) {
        ctx.addIssue({ code: "custom", path: ["otras"], message: "must be sorted by precio_ars ascending" });
        break;
      }
    }
    const first = c.otras[0];
    if (first && c.diferencia_ars !== first.precio_ars - c.ml.precio_ars) {
      ctx.addIssue({ code: "custom", path: ["diferencia_ars"], message: "must equal otras[0].precio_ars - ml.precio_ars" });
    }
  });

export const candidateListSchema = z
  .object({
    version: z.literal(1),
    corrida_id: z.string().min(1),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    categoria: z.string().min(1),
    umbral_pct: z.number().positive(),
    modelos_comparados: z.number().int().nonnegative(),
    candidatos: z.array(candidateSchema),
  })
  .superRefine((l, ctx) => {
    for (let i = 1; i < l.candidatos.length; i++) {
      if (l.candidatos[i]!.diferencia_pct > l.candidatos[i - 1]!.diferencia_pct) {
        ctx.addIssue({ code: "custom", path: ["candidatos"], message: "must be sorted by diferencia_pct descending" });
        break;
      }
    }
  });

export type StoreOffer = z.infer<typeof storeOfferSchema>;
export type Candidate = z.infer<typeof candidateSchema>;
export type CandidateList = z.infer<typeof candidateListSchema>;

export function parseCandidateList(input: unknown): CandidateList {
  const result = candidateListSchema.safeParse(input);
  if (result.success) return result.data;
  const detail = result.error.issues
    .map((i) => `${i.path.length > 0 ? i.path.join(".") : "(root)"}: ${i.message}`)
    .join("; ");
  throw new ContractError(`Invalid ListaDeCandidatos v1: ${detail}`, result.error.issues);
}
