import type { APIRoute } from "astro";
import { buildProducts } from "../../lib/products.js";
import { productCardPng } from "../../lib/share-card.js";
import { getSiteData } from "../../lib/site-data.js";

export async function getStaticPaths() {
  const d = await getSiteData();
  return buildProducts(d).map((p) => ({ params: { slug: p.slug }, props: { slug: p.slug } }));
}

export const GET: APIRoute = async ({ props }) => {
  const d = await getSiteData();
  const product = buildProducts(d).find((p) => p.slug === props.slug)!;
  const png = await productCardPng(product);
  return new Response(png, { headers: { "Content-Type": "image/png" } });
};
