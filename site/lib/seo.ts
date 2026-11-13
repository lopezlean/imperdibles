import { MONTH_NAMES, formatArs, formatDateLong, formatPct, pctTenths, truncate } from "../../src/output/format.js";
import { catalogPhotoUrl } from "../../src/output/photo-url.js";
import type { Deal } from "./deals.js";
import type { Product } from "./products.js";
import { ogPath, productPath, weekdayName } from "./slugs.js";

const SUFFIX = "en Mercado Libre | imperdibles";

export const dayTitle = (runDate: string): string =>
  `Mejores ofertas del ${weekdayName(runDate)} ${formatDateLong(runDate)} ${SUFFIX}`;

export const monthTitle = (month: string): string => {
  const [y = "", m = ""] = month.split("-");
  return `Mejores ofertas de ${MONTH_NAMES[Number(m) - 1]} ${y} ${SUFFIX}`;
};

export const homeTitle = (pct: string): string =>
  `Ofertas en Mercado Libre hasta ${pct}% más baratas que en otras tiendas | imperdibles`;

export const buildDescription = (o: { count: number; topPct: string; names: string[] }): string => {
  const lead = o.count === 1 ? "1 oferta verificada" : `${o.count} ofertas verificadas`;
  const text = `${lead} en Mercado Libre, hasta ${o.topPct}% más baratas que en otras tiendas: ${o.names.join(", ")}.`;
  return truncate(text, 155);
};

const tenths = (d: Deal) => pctTenths(d.candidate.ml.price_ars, Math.min(...d.candidate.others.map((x) => x.price_ars)));

/** Percentage of the best-discount deal ("25,0"); "0,0" when there are none. */
export const topPct = (items: Deal[]): string => {
  const best = items.reduce<Deal | null>((a, b) => (a === null || tenths(b) > tenths(a) ? b : a), null);
  return best ? formatPct(best.candidate) : "0,0";
};

/** The best-discount deal's photo, only when it is an mlstatic URL. */
export const ogImageOf = (items: Deal[]): string | null => {
  const best = items.reduce<Deal | null>((a, b) => (a === null || tenths(b) > tenths(a) ? b : a), null);
  return best ? catalogPhotoUrl(best.candidate.image_url) : null;
};

export const absoluteUrl = (site: string, path: string): string => `${site.replace(/\/+$/, "")}${path}`;

/** Absolute URL of a product's share card; `version` busts the chat apps' image cache when prices change. */
export const ogCardUrl = (site: string, slug: string, version: string): string =>
  `${absoluteUrl(site, ogPath(slug))}?v=${version}`;

export const breadcrumbLd = (crumbs: { name: string; url: string }[]): object => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.url })),
});

/** ListItem only: a Product without offers warns in Search Console and a static page cannot claim live prices. */
export const itemListLd = (items: Deal[]): object => ({
  "@context": "https://schema.org",
  "@type": "ItemList",
  itemListElement: items.map((d, i) => {
    const image = catalogPhotoUrl(d.candidate.image_url);
    return {
      "@type": "ListItem",
      position: i + 1,
      name: d.candidate.title,
      url: d.affiliate_link,
      ...(image ? { image } : {}),
    };
  }),
});

/** JSON for an inline script tag; "<" is escaped so the content cannot close the tag. */
export const jsonLdScript = (data: object): string => JSON.stringify(data).replace(/</g, "\\u003c");

export const buildRobotsTxt = (siteUrl: string): string =>
  `User-agent: *\nAllow: /\nDisallow: /internal/\nDisallow: /telegram/\n\nSitemap: ${absoluteUrl(siteUrl, "/sitemap-index.xml")}\n`;

export const productTitle = (p: Product): string =>
  `${p.latest.candidate.title}: ${formatPct(p.latest.candidate)}% más barato en Mercado Libre | imperdibles`;

export const productDescription = (p: Product): string => {
  const c = p.latest.candidate;
  return truncate(
    `${c.title} a ${formatArs(c.ml.price_ars)} en Mercado Libre, ${formatPct(c)}% más barato que en otras tiendas (precio al ${formatDateLong(p.latest.run_date)}).`,
    155,
  );
};

/** Product JSON-LD. A stale page carries no Offer: it must not claim a price that may have changed. */
export const productLd = (p: Product, siteUrl: string, stale: boolean): object => {
  const c = p.latest.candidate;
  const image = catalogPhotoUrl(c.image_url);
  const url = absoluteUrl(siteUrl, productPath(p.slug));
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: c.title,
    brand: { "@type": "Brand", name: c.brand },
    url,
    ...(image ? { image } : {}),
    ...(stale ? {} : { offers: { "@type": "Offer", price: c.ml.price_ars, priceCurrency: "ARS", url } }),
  };
};

export const categoryTitle = (name: string): string => `Mejores ofertas de ${name} en Mercado Libre | imperdibles`;

export const categoryDescription = (name: string, count: number): string =>
  truncate(`${count === 1 ? "1 producto" : `${count} productos`} de ${name} que estuvieron más baratos en Mercado Libre que en otras tiendas.`, 155);

export const categoryItemListLd = (products: Product[], siteUrl: string): object => ({
  "@context": "https://schema.org",
  "@type": "ItemList",
  itemListElement: products.map((p, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: p.latest.candidate.title,
    url: absoluteUrl(siteUrl, productPath(p.slug)),
  })),
});
