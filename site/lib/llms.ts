import { formatArs } from "../../src/output/format.js";
import { absoluteUrl } from "./seo.js";
import { categoryPath, dayPath } from "./slugs.js";

export type LlmsOffer = { title: string; mlPriceArs: number; pct: string; path: string };

export type LlmsInput = {
  siteUrl: string;
  thresholdPct: number;
  categories: { id: string; name: string }[];
  /** Run date of the offers listed, or null when nothing is published. */
  runDate: string | null;
  offers: LlmsOffer[];
};

/** One-line link text: whitespace collapsed, brackets escaped so the markdown link stays intact. */
const linkText = (s: string): string => s.replace(/\s+/g, " ").trim().replace(/[[\]]/g, "\\$&");

const link = (siteUrl: string, text: string, path: string, note?: string): string =>
  `- [${linkText(text)}](${absoluteUrl(siteUrl, path)})${note ? `: ${note}` : ""}`;

/** Builds /llms.txt (llms.txt convention): site summary, verification method and key links, in Spanish like the site. */
export function buildLlmsTxt(i: LlmsInput): string {
  const pct = String(i.thresholdPct).replace(".", ",");
  const lines: string[] = [
    "# imperdibles",
    "",
    `> Selección diaria de productos que están en Mercado Libre al menos ${pct}% más baratos que en otras tiendas de Argentina. Cada día se compara el mismo modelo en Mercado Libre y en otras tiendas, y solo se publica el que pasa el filtro. Los precios están en pesos argentinos (ARS).`,
    "",
    "## Cómo se verifican los precios",
    "",
    `Se compara el mismo modelo en Mercado Libre y en otras tiendas, y solo se publica si Mercado Libre cuesta ${pct}% o más menos. La página de transparencia muestra cuántos modelos se revisaron y cuántos se publicaron.`,
    "",
    link(i.siteUrl, "Transparencia", "/transparencia/", "modelos revisados frente a publicados"),
    "",
    "## Páginas principales",
    "",
    link(i.siteUrl, "Inicio", "/", "los imperdibles más recientes"),
    ...(i.runDate ? [link(i.siteUrl, "Ofertas del día", dayPath(i.runDate), "todas las ofertas publicadas ese día")] : []),
    link(i.siteUrl, "Cupones", "/cupones/", "cupones de descuento de Mercado Libre"),
    link(i.siteUrl, "Black Friday", "/black-friday/"),
    link(i.siteUrl, "Transparencia", "/transparencia/"),
    link(i.siteUrl, "Sitemap", "/sitemap-index.xml"),
    "",
  ];

  if (i.categories.length > 0) {
    lines.push("## Categorías", "", ...i.categories.map((c) => link(i.siteUrl, c.name, categoryPath(c.id))), "");
  }

  lines.push("## Ofertas de hoy", "");
  if (i.offers.length === 0) {
    lines.push("Todavía no hay ofertas publicadas.");
  } else {
    lines.push(
      ...i.offers.map((o) =>
        link(i.siteUrl, o.title, o.path, `${formatArs(o.mlPriceArs)} en Mercado Libre, ${o.pct}% más barato que en otras tiendas`),
      ),
    );
  }
  return `${lines.join("\n")}\n`;
}
