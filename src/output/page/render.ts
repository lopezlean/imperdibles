import type { Candidate } from "../../contract/candidate-list.js";
import {
  AFFILIATE_LEGEND,
  CARD_FOOTER,
  CHANNEL_CTA,
  CHANNEL_EYEBROW,
  CHANNEL_HEADING,
  CHANNEL_LEAD,
  COMPARED_CHIP,
  CTA_ML,
  DIFFERENCE,
  EMPTY_PAGE,
  EMPTY_PAGE_LEAD,
  HERO_LEAD,
  HOW_HEADING,
  HOW_STEPS,
  METHOD_TAGLINE,
  NAV,
  NOT_AFFILIATED,
  PAGE_TITLE_HERO,
  PCT_BADGE,
  PRICES_NOTE,
  PUBLISHED_CHIP,
  TODAY_HEADING,
  storeName,
} from "../copy.js";
import { categoryArtLabel, categoryArtSvg } from "../category-art.js";
import { formatArs, formatDateDots, formatDateLong, formatDateShort, formatPct, formatThreshold } from "../format.js";
import { escapeHtml as e } from "../html.js";
import { catalogPhotoUrl } from "../photo-url.js";
import { PAGE_CSS, PAGE_FONTS } from "./styles.js";

export type PageInput = {
  mode: "today" | "archive" | "none";
  run_date: string | null;
  categoryName: string | null;
  /** Category id that picks the illustration; the generic one is used when absent. */
  categoryId?: string | null;
  threshold_pct: number;
  models_compared: number;
  /** `category` is the item's own category id (art fallback); it wins over the page-level `categoryId`. */
  items: { candidate: Candidate; affiliate_link: string; category?: string | null }[];
  channelUrl: string;
};

function photoBox(c: Candidate, categoryId: string | null): string {
  const photo = catalogPhotoUrl(c.image_url);
  if (photo)
    return `<div class="photo"><img src="${e(photo)}" alt="${e(c.title)}" loading="lazy" width="264" height="240"></div>`;
  return `<div class="photo" role="img" aria-label="${e(categoryArtLabel(categoryId))}"><div class="art" aria-hidden="true">${categoryArtSvg(categoryId)}</div></div>`;
}

/** Bar width as a share of the dearest price in the card, one decimal. Every bar uses the same scale. */
function scaleWidth(price: number, max: number): string {
  return `${Math.round((price / max) * 1000) / 10}%`;
}

function article(item: PageInput["items"][number], categoryId: string | null, runDate: string): string {
  const c = item.candidate;
  const rivals = [...c.others].sort((a, b) => a.price_ars - b.price_ars);
  const max = Math.max(c.ml.price_ars, ...rivals.map((o) => o.price_ars));
  const rivalRows = rivals
    .map(
      (o) => `<div class="price-row">
<div class="price-line"><span class="store">${e(storeName(o.store))}</span><span class="p-rival">${e(formatArs(o.price_ars))}</span></div>
<div class="scale" aria-hidden="true"><i style="width: ${scaleWidth(o.price_ars, max)}"></i></div>
</div>`,
    )
    .join("\n");
  return `<article class="card">
<div class="top">
${photoBox(c, categoryId)}
<div class="info">
<h2 class="title">${e(c.title)}</h2>
<span class="badge">${e(PCT_BADGE(formatPct(c)))}</span>
<p class="diff">${e(DIFFERENCE)}: ${e(formatArs(c.difference_ars))}</p>
</div>
</div>
<div class="prices">
<div class="price-row">
<div class="price-line"><span class="store store-ml">${e(storeName("ml"))}</span><span class="p-ml">${e(formatArs(c.ml.price_ars))}</span></div>
<div class="scale scale-ml" aria-hidden="true"><i style="width: ${scaleWidth(c.ml.price_ars, max)}"></i></div>
</div>
${rivalRows}
<a class="cta" href="${e(item.affiliate_link)}" rel="sponsored noopener">${e(CTA_ML)}</a>
<p class="note">${e(CARD_FOOTER(formatDateShort(runDate)))}</p>
</div>
</article>`;
}

function chips(input: PageInput): string {
  if (input.mode === "none") return "";
  return `<div class="chips">
<span class="chip">${e(COMPARED_CHIP(input.models_compared))}</span>
<span class="chip">${e(PUBLISHED_CHIP(input.items.length))}</span>
</div>`;
}

function todaySection(input: PageInput): string {
  const empty = input.mode === "none" || input.items.length === 0 || !input.run_date;
  const runDate = input.run_date;
  const heading =
    !empty && input.mode === "archive" && runDate ? `Los imperdibles del ${formatDateLong(runDate)}` : TODAY_HEADING;
  const meta =
    input.mode !== "none" && runDate
      ? `<p class="meta mono">${e([formatDateDots(runDate), input.categoryName].filter((p): p is string => !!p).join(" / "))}</p>`
      : "";
  const body = empty
    ? `<div class="empty">
<p class="display zero" aria-hidden="true">0</p>
<h2>${e(EMPTY_PAGE)}</h2>
<p>${e(EMPTY_PAGE_LEAD)}</p>
</div>`
    : `<div class="list">
${input.items.map((i) => article(i, i.category ?? input.categoryId ?? null, runDate as string)).join("\n")}
</div>`;
  return `<main id="hoy" class="wrap today">
<div class="sel">
<h1>${e(heading)}</h1>
${meta}
</div>
${chips(input)}
${body}
</main>`;
}

export function renderHomePage(input: PageInput): string {
  const threshold = formatThreshold(input.threshold_pct);
  const steps = HOW_STEPS(threshold)
    .map(
      (s, i) => `<li class="step">
<span class="step-n" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span>
<div>
<h3>${e(s.title)}</h3>
<p>${e(s.body)}</p>
</div>
</li>`,
    )
    .join("\n");
  const channel = e(input.channelUrl);
  const pricesNote = input.run_date ? `\n<p>${e(PRICES_NOTE(formatDateLong(input.run_date)))}</p>` : "";
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>imperdibles.com.ar</title>
<link href="${PAGE_FONTS}" rel="stylesheet">
<style>${PAGE_CSS}</style>
</head>
<body>

<header class="hd">
<div class="wrap hd-row">
<div class="brand-row">
<a href="/" class="brand"><b>imperdibles</b><i>.com.ar</i></a>
<span class="monogram" aria-hidden="true">i</span>
</div>
<nav class="nav" aria-label="Principal">
<a href="#hoy">${e(NAV.hoy)}</a>
<a href="#como">${e(NAV.como)}</a>
<a href="#canal">${e(NAV.canal)}</a>
</nav>
</div>
<div class="wrap"><div class="rule"></div></div>
</header>

${todaySection(input)}

<section class="why" aria-label="Por qué aparecen estos productos">
<div class="wrap">
<p class="why-lead">${e(PAGE_TITLE_HERO(threshold))}</p>
<p class="why-sub">${e(HERO_LEAD)}</p>
</div>
</section>

<section id="como" class="method">
<div class="wrap">
<div class="method-head">
<h2 class="display">${e(HOW_HEADING)}</h2>
<p>${e(METHOD_TAGLINE)}</p>
</div>
<ol class="steps">
${steps}
</ol>
</div>
</section>

<section id="canal" class="channel on-accent">
<div class="wrap">
<p class="mono">${e(CHANNEL_EYEBROW.toUpperCase())}</p>
<div class="channel-row">
<div class="channel-copy">
<h2 class="display">${e(CHANNEL_HEADING)}</h2>
<p>${e(CHANNEL_LEAD)}</p>
</div>
<a href="${channel}" class="channel-btn"><span aria-hidden="true">↗</span>${e(CHANNEL_CTA)}</a>
</div>
</div>
</section>

<footer class="wrap legal">
<p class="sign" aria-hidden="true"><b>imperdibles</b><i>.com.ar</i></p>
<div class="rule"></div>
<div class="notes">
<p>${e(AFFILIATE_LEGEND)}</p>
<p>${e(NOT_AFFILIATED)}</p>${pricesNote}
</div>
</footer>

</body>
</html>
`;
}
