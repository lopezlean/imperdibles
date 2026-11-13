import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { renderCardPng } from "../../src/output/card/render.js";
import type { FetchLike } from "../../src/output/card/photo.js";
import type { Product } from "./products.js";

// Node-only (build): satori and resvg never reach the Worker.

const DEFAULT_DIR = ".cache/og";

/** Cache file for one card; the price is part of the key so a price change renders a fresh card. */
export function cardCachePath(dir: string, candidateId: string, priceArs: number): string {
  const id = candidateId.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  return join(dir, `${id}-${priceArs}.png`);
}

/** The Telegram card for a product's latest deal, rendered once and cached on disk. */
export async function productCardPng(
  p: Product,
  opts: { cacheDir?: string; fetch?: FetchLike } = {},
): Promise<Uint8Array> {
  const dir = opts.cacheDir ?? process.env.SITE_OG_CACHE ?? DEFAULT_DIR;
  const c = p.latest.candidate;
  const file = cardCachePath(dir, c.candidate_id, c.ml.price_ars);
  if (existsSync(file)) return new Uint8Array(readFileSync(file));
  const png = await renderCardPng(c, { run_date: p.latest.run_date, category: p.latest.category, fetch: opts.fetch });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, png);
  return png;
}
