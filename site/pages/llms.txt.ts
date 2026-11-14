import { dayPage, listDays } from "../lib/deals.js";
import { readSiteEnv } from "../lib/env.js";
import { buildLlmsTxt } from "../lib/llms.js";
import { activeCategories, buildProducts } from "../lib/products.js";
import { getSiteData } from "../lib/site-data.js";
import { productPath } from "../lib/slugs.js";
import { formatPct } from "../../src/output/format.js";

export const GET = async () => {
  const d = await getSiteData();
  const { siteUrl } = readSiteEnv(process.env);
  const slugs = new Map(buildProducts(d).map((p) => [p.model_id, p.slug]));
  const latest = listDays(d).at(-1);
  const page = latest ? dayPage(d, latest) : null;
  const offers = (page?.items ?? []).flatMap((x) => {
    const slug = slugs.get(x.model_id);
    return slug
      ? [{ title: x.candidate.title, mlPriceArs: x.candidate.ml.price_ars, pct: formatPct(x.candidate), path: productPath(slug) }]
      : [];
  });
  const body = buildLlmsTxt({
    siteUrl,
    thresholdPct: d.threshold_pct,
    categories: activeCategories(d),
    runDate: page && offers.length > 0 ? page.run_date : null,
    offers,
  });
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
