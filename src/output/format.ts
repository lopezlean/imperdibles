import type { Candidate } from "../contract/candidate-list.js";

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** "$1.199.999". Locale-independent (no Intl) so Node and the Worker agree. */
export function formatArs(n: number): string {
  return `$${String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

/** Percentage difference in tenths: floor((other - ml) * 1000 / other). Integer math only; truncates. */
export function pctTenths(mlPrice: number, otherPrice: number): number {
  return Math.floor(((otherPrice - mlPrice) * 1000) / otherPrice);
}

/** "19,7": difference against the cheapest rival, truncated to one decimal, comma separator. */
export function formatPct(c: Pick<Candidate, "ml" | "others">): string {
  const cheapest = Math.min(...c.others.map((o) => o.price_ars));
  const tenths = pctTenths(c.ml.price_ars, cheapest);
  return `${Math.trunc(tenths / 10)},${tenths % 10}`;
}

/** 15 -> "15", 12.5 -> "12,5". */
export function formatThreshold(threshold: number): string {
  return String(threshold).replace(".", ",");
}

function parseDate(run_date: string): [string, number, string] {
  const [y = "", m = "", d = ""] = run_date.split("-");
  return [y, Number(m), d];
}

/** "2026-11-10" -> "10 de noviembre de 2026". */
export function formatDateLong(run_date: string): string {
  const [y, m, d] = parseDate(run_date);
  return `${Number(d)} de ${MONTHS[m - 1]} de ${y}`;
}

/** "2026-11-10" -> "10/11/2026". */
export function formatDateShort(run_date: string): string {
  const [y, m, d] = parseDate(run_date);
  return `${d}/${String(m).padStart(2, "0")}/${y}`;
}

/** Shortens to at most `max` characters, ending with "…" when cut. */
export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
