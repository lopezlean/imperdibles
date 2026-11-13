import { createHash } from "node:crypto";
import { MONTH_NAMES } from "../../src/output/format.js";

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const DAY_SLUG = /^([1-9]|[12]\d|3[01])-de-([a-z]+)-de-(\d{4})$/;
const MONTH_SLUG = /^([a-z]+)-de-(\d{4})$/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function monthIndex(name: string): number {
  return MONTH_NAMES.indexOf(name);
}

function splitDate(runDate: string): [number, number, number] {
  const [y = "", m = "", d = ""] = runDate.split("-");
  return [Number(y), Number(m), Number(d)];
}

/** "2026-11-12" -> "12-de-noviembre-de-2026". */
export function daySlug(runDate: string): string {
  const [y, m, d] = splitDate(runDate);
  return `${d}-de-${MONTH_NAMES[m - 1]}-de-${y}`;
}

/** "2026-11" -> "noviembre-de-2026". */
export function monthSlug(month: string): string {
  const [y, m] = splitDate(month);
  return `${MONTH_NAMES[m - 1]}-de-${y}`;
}

/** Inverse of daySlug; null when malformed or not a real calendar date. */
export function parseDaySlug(slug: string): string | null {
  const match = DAY_SLUG.exec(slug);
  if (!match) return null;
  const d = Number(match[1]);
  const m = monthIndex(match[2] ?? "") + 1;
  const y = Number(match[3]);
  if (m === 0) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** Inverse of monthSlug; null when malformed. */
export function parseMonthSlug(slug: string): string | null {
  const match = MONTH_SLUG.exec(slug);
  if (!match) return null;
  const m = monthIndex(match[1] ?? "") + 1;
  if (m === 0) return null;
  return `${match[2]}-${pad2(m)}`;
}

export function dayPath(runDate: string): string {
  return `/ofertas/${daySlug(runDate)}/`;
}

export function monthPath(month: string): string {
  return `/ofertas/${monthSlug(month)}/`;
}

/** Lowercase Spanish weekday, UTC-based, no Intl. */
export function weekdayName(runDate: string): string {
  const [y, m, d] = splitDate(runDate);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
}

/** "2026-11-12" -> "2026-11". */
export function monthOf(runDate: string): string {
  return runDate.slice(0, 7);
}

const hash6 = (value: string): string => createHash("sha1").update(value).digest("hex").slice(0, 6);

/** "HP:15FD0333LA" -> "hp-15fd0333la". Nothing usable left (or an empty id) falls back to "p-<hash6>". */
export function productSlug(modelId: string): string {
  const slug = modelId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? `p-${hash6(modelId)}` : slug;
}

/** Suffix used to keep two product slugs apart; stable because it only depends on the model id. */
export const slugSuffix = hash6;

export function productPath(slug: string): string {
  return `/producto/${slug}/`;
}

export function categoryPath(id: string): string {
  return `/categoria/${id}/`;
}
