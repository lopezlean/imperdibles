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
  store: z.string().min(1),
  listing_title: z.string(),
  url: z.string().min(1),
  price_ars: price,
  observed_at: isoWithZone,
  external_ref: z.string().min(1),
  seller: z.string().nullable(),
};

/** Mercado Libre offer: `store === "ml"`, with product and seller ids. */
const mlOfferSchema = z.object({
  ...offerFields,
  store: z.literal("ml"),
  ml_product_id: z.string().min(1),
  ml_seller_id: z.string().min(1),
});

/** Other-store offer: never "ml", never any `ml_*` key. */
const otherOfferSchema = z.strictObject({
  ...offerFields,
  store: z.string().min(1).refine((t) => t !== "ml", { message: 'must not be "ml"' }),
});

/** Any offer, as seen by consumers: `ml_*` keys exist only on the Mercado Libre one. */
export const storeOfferSchema = z.union([mlOfferSchema, otherOfferSchema]);

export const candidateSchema = z
  .object({
    candidate_id: z.string().min(1),
    model_id: z.string().min(1),
    brand: z.string().min(1),
    title: z.string().min(1),
    image_url: z.string().nullable(),
    ml: mlOfferSchema,
    others: z.array(otherOfferSchema).min(1),
    difference_ars: z.number().int(),
    difference_pct: z.number(),
    confidence: z.literal("high"),
    match_rule: z.enum(["gtin", "brand_code_variant"]),
  })
  .superRefine((c, ctx) => {
    for (let i = 1; i < c.others.length; i++) {
      if (c.others[i]!.price_ars < c.others[i - 1]!.price_ars) {
        ctx.addIssue({ code: "custom", path: ["others"], message: "must be sorted by price_ars ascending" });
        break;
      }
    }
    const first = c.others[0];
    if (first && c.difference_ars !== first.price_ars - c.ml.price_ars) {
      ctx.addIssue({ code: "custom", path: ["difference_ars"], message: "must equal others[0].price_ars - ml.price_ars" });
    }
  });

export const candidateListSchema = z
  .object({
    version: z.literal(1),
    run_id: z.string().min(1),
    run_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    category: z.string().min(1),
    threshold_pct: z.number().positive(),
    models_compared: z.number().int().nonnegative(),
    candidates: z.array(candidateSchema),
  })
  .superRefine((l, ctx) => {
    for (let i = 1; i < l.candidates.length; i++) {
      if (l.candidates[i]!.difference_pct > l.candidates[i - 1]!.difference_pct) {
        ctx.addIssue({ code: "custom", path: ["candidates"], message: "must be sorted by difference_pct descending" });
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
