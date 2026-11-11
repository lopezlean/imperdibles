import type { Candidate } from "../../contract/candidate-list.js";
import {
  AFFILIATE_LEGEND,
  CHANNEL_CTA,
  CHANNEL_HEADING,
  CHANNEL_LEAD,
  COMPARED_CHIP,
  CTA_ML,
  DIFFERENCE,
  EMPTY_PAGE,
  HERO_LEAD,
  HOW_HEADING,
  HOW_STEPS,
  IN_ML,
  NAV,
  NOT_AFFILIATED,
  PAGE_TITLE_HERO,
  PCT_BADGE,
  PHOTO_PLACEHOLDER,
  PHOTO_PLACEHOLDER_LABEL,
  PRICES_NOTE,
  PUBLISHED_CHIP,
  TODAY_HEADING,
  storeName,
} from "../copy.js";
import { TOKENS } from "../design-tokens.js";
import { formatArs, formatDateLong, formatPct, formatThreshold } from "../format.js";
import { escapeHtml as e } from "../html.js";

export type PageInput = {
  mode: "today" | "archive" | "none";
  run_date: string | null;
  categoryName: string | null;
  threshold_pct: number;
  models_compared: number;
  items: { candidate: Candidate; affiliate_link: string }[];
  channelUrl: string;
};

const T = TOKENS;
const FONTS =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;700&display=swap";
const GROTESK = "font-family: 'Space Grotesk', sans-serif; font-weight: 700";
const H2 = `margin: 0; ${GROTESK}; font-size: 28px; letter-spacing: -0.02em`;

function article(item: PageInput["items"][number]): string {
  const c = item.candidate;
  const rivals = [...c.others].sort((a, b) => a.price_ars - b.price_ars);
  const rows = rivals
    .map(
      (o) =>
        `<div style="display: flex; justify-content: space-between; gap: 12px; color: ${T.ink2}"><span>${e(storeName(o.store))}</span><span>${e(formatArs(o.price_ars))}</span></div>`,
    )
    .join("\n");
  return `<article style="flex: 1 1 460px; min-width: 0; box-sizing: border-box; background: ${T.surface}; border: 1px solid ${T.line}; border-radius: 16px; padding: 20px; display: flex; flex-wrap: wrap; gap: 20px">
<div role="img" aria-label="${e(PHOTO_PLACEHOLDER_LABEL)}" style="flex: 0 0 140px; height: 140px; border-radius: 12px; background: ${T.photoPage}; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 12px; color: ${T.muted}">${e(PHOTO_PLACEHOLDER)}</div>
<div style="flex: 1 1 240px; min-width: 0; display: flex; flex-direction: column; gap: 12px">
<div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px">
<h3 style="margin: 0; font-size: 18px; font-weight: 600; line-height: 1.3">${e(c.title)}</h3>
<span style="flex: none; padding: 4px 10px; background: ${T.accent}; color: #FFFFFF; border-radius: 999px; font-size: 14px; font-weight: 600; white-space: nowrap">${e(PCT_BADGE(formatPct(c)))}</span>
</div>
<div style="display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px">
<span style="${GROTESK}; font-size: 34px; letter-spacing: -0.02em; font-variant-numeric: tabular-nums">${e(formatArs(c.ml.price_ars))}</span>
<span style="font-size: 14px; color: ${T.muted}">${e(IN_ML)}</span>
</div>
<div style="border-top: 1px solid ${T.line}; padding-top: 12px; display: flex; flex-direction: column; gap: 6px; font-size: 15px; font-variant-numeric: tabular-nums">
${rows}
<div style="display: flex; justify-content: space-between; gap: 12px; font-weight: 600"><span>${e(DIFFERENCE)}</span><span>${e(formatArs(c.difference_ars))}</span></div>
</div>
<a href="${e(item.affiliate_link)}" rel="sponsored noopener" style="margin-top: 4px; min-height: 44px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; padding: 10px 16px; background: ${T.ink}; color: #FFFFFF; border-radius: 10px; font-weight: 600; text-decoration: none">${e(CTA_ML)}</a>
</div>
</article>`;
}

function hero(input: PageInput, threshold: string): string {
  const parts: string[] = [];
  if (input.mode !== "none") {
    const eyebrow = [input.categoryName, input.run_date ? formatDateLong(input.run_date) : null].filter(
      (p): p is string => !!p,
    );
    if (eyebrow.length > 0) {
      parts.push(
        `<p style="margin: 0; font-size: 14px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: ${T.accent}">${e(eyebrow.join(" · "))}</p>`,
      );
    }
  }
  parts.push(
    `<h1 style="margin: 0; max-width: 880px; ${GROTESK}; font-size: clamp(2.25rem, 5vw, 4rem); line-height: 1.05; letter-spacing: -0.03em">${e(PAGE_TITLE_HERO(threshold))}</h1>`,
    `<p style="margin: 0; max-width: 640px; font-size: 19px; color: ${T.ink2}">${e(HERO_LEAD)}</p>`,
  );
  if (input.mode !== "none") {
    parts.push(`<div style="display: flex; flex-wrap: wrap; gap: 12px; font-size: 15px; font-weight: 500">
<span style="padding: 8px 14px; background: ${T.surface}; border: 1px solid ${T.line}; border-radius: 999px">${e(COMPARED_CHIP(input.models_compared))}</span>
<span style="padding: 8px 14px; background: ${T.ink}; color: #FFFFFF; border-radius: 999px">${e(PUBLISHED_CHIP(input.items.length))}</span>
</div>`);
  }
  return `<section style="max-width: 1120px; margin: 0 auto; padding: 72px 24px 56px; display: flex; flex-direction: column; gap: 24px">
${parts.join("\n")}
</section>`;
}

function todaySection(input: PageInput): string {
  if (input.mode === "none" || input.items.length === 0 || !input.run_date) {
    return `<section id="hoy" style="max-width: 1120px; margin: 0 auto; padding: 0 24px 72px; display: flex; flex-direction: column; gap: 24px">
<h2 style="${H2}">${e(TODAY_HEADING)}</h2>
<p style="margin: 0; color: ${T.ink2}">${e(EMPTY_PAGE)}</p>
</section>`;
  }
  const heading = input.mode === "archive" ? `Los imperdibles del ${formatDateLong(input.run_date)}` : TODAY_HEADING;
  return `<section id="hoy" style="max-width: 1120px; margin: 0 auto; padding: 0 24px 72px; display: flex; flex-direction: column; gap: 24px">
<h2 style="${H2}">${e(heading)}</h2>
<div style="display: flex; flex-wrap: wrap; gap: 20px">
${input.items.map(article).join("\n")}
</div>
<p style="margin: 0; font-size: 14px; color: ${T.muted}">${e(PRICES_NOTE(formatDateLong(input.run_date)))}</p>
</section>`;
}

export function renderHomePage(input: PageInput): string {
  const threshold = formatThreshold(input.threshold_pct);
  const steps = HOW_STEPS(threshold)
    .map(
      (s, i) => `<div style="flex: 1 1 260px; min-width: 0; display: flex; flex-direction: column; gap: 8px">
<span style="${GROTESK}; font-size: 20px; color: ${T.accent}">${i + 1}</span>
<h3 style="margin: 0; font-size: 18px; font-weight: 600">${e(s.title)}</h3>
<p style="margin: 0; color: ${T.ink2}">${e(s.body)}</p>
</div>`,
    )
    .join("\n");
  const channel = e(input.channelUrl);
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>imperdibles.com.ar</title>
<link href="${FONTS}" rel="stylesheet">
<style>
body{margin:0}
a{color:${T.ink}}a:hover{color:${T.ink2}}
</style>
</head>
<body>
<div style="background: ${T.bg}; color: ${T.ink}; font-family: Inter, system-ui, sans-serif; font-size: 16px; line-height: 1.5">

<header style="background: ${T.surface}; border-bottom: 1px solid ${T.line}">
<div style="max-width: 1120px; margin: 0 auto; padding: 16px 24px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px">
<a href="/" style="${GROTESK}; font-size: 24px; letter-spacing: -0.02em; text-decoration: none; color: ${T.ink}">imperdibles<span style="color: ${T.accent}">.com.ar</span></a>
<nav aria-label="Principal" style="display: flex; flex-wrap: wrap; align-items: center; gap: 24px; font-size: 15px; font-weight: 500">
<a href="#hoy" style="text-decoration: none; padding: 12px 0">${e(NAV.hoy)}</a>
<a href="#como" style="text-decoration: none; padding: 12px 0">${e(NAV.como)}</a>
<a href="#canal" style="text-decoration: none; padding: 10px 16px; border: 1px solid ${T.ink}; border-radius: 999px">${e(NAV.canal)}</a>
</nav>
</div>
</header>

${hero(input, threshold)}

${todaySection(input)}

<section id="como" style="background: ${T.surface}; border-top: 1px solid ${T.line}; border-bottom: 1px solid ${T.line}">
<div style="max-width: 1120px; margin: 0 auto; padding: 64px 24px; display: flex; flex-direction: column; gap: 32px">
<h2 style="${H2}">${e(HOW_HEADING)}</h2>
<div style="display: flex; flex-wrap: wrap; gap: 32px">
${steps}
</div>
</div>
</section>

<section id="canal" style="max-width: 1120px; margin: 0 auto; padding: 64px 24px">
<div style="background: ${T.ink}; color: #FFFFFF; border-radius: 20px; padding: 40px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 24px">
<div style="flex: 1 1 360px; min-width: 0; display: flex; flex-direction: column; gap: 8px">
<h2 style="${H2}">${e(CHANNEL_HEADING)}</h2>
<p style="margin: 0; color: ${T.onDark2}">${e(CHANNEL_LEAD)}</p>
</div>
<a href="${channel}" style="min-height: 48px; box-sizing: border-box; display: flex; align-items: center; gap: 10px; padding: 12px 22px; background: #FFFFFF; color: ${T.ink}; border-radius: 999px; font-weight: 600; text-decoration: none">
<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"></path><path d="M22 2 15 22l-4-9-9-4 20-7z"></path></svg>
${e(CHANNEL_CTA)}</a>
</div>
</section>

<footer style="max-width: 1120px; margin: 0 auto; padding: 0 24px 56px; display: flex; flex-direction: column; gap: 8px; font-size: 14px; color: ${T.muted}">
<p style="margin: 0">${e(AFFILIATE_LEGEND)}</p>
<p style="margin: 0">${e(NOT_AFFILIATED)}</p>
</footer>

</div>
</body>
</html>
`;
}
