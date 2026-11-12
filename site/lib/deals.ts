import type { Candidate } from "../../src/contract/candidate-list.js";
import { pctTenths } from "../../src/output/format.js";
import { loadConfig, type Category } from "../../src/shared/config.js";
import type { SqlClient } from "../../src/shared/db/sql-client.js";

export type Deal = {
  id: string;
  model_id: string;
  run_date: string;
  category: string;
  candidate: Candidate;
  affiliate_link: string;
  published_at: string | null;
};

export type SiteData = {
  threshold_pct: number;
  deals: Deal[];
  comparedByDay: Record<string, number>;
  /** Categories that have at least one published deal, in configuration order. */
  categories: Category[];
};

export type DayPage = {
  run_date: string;
  items: Deal[];
  models_compared: number;
  prev: string | null;
  next: string | null;
  month: string;
  lastmod: string;
  /** The single category of the day, or null when the day mixes several. */
  categoryId: string | null;
};

export type MonthPage = {
  month: string;
  items: Deal[];
  days: string[];
  prev: string | null;
  next: string | null;
  lastmod: string;
};

type Row = {
  id: string;
  model_id: string;
  payload: string;
  affiliate_link: string;
  category: string;
  models_compared: number;
  run_date: string;
  published_at: string | null;
};

const LAST = "￿";

const tenthsOf = (c: Candidate) => pctTenths(c.ml.price_ars, Math.min(...c.others.map((o) => o.price_ars)));

const byDiscountThenTitle = (a: Deal, b: Deal) =>
  tenthsOf(b.candidate) - tenthsOf(a.candidate) || a.candidate.title.localeCompare(b.candidate.title, "es");

function parse(r: Row): Deal | null {
  try {
    const candidate = JSON.parse(r.payload) as Candidate;
    if (!Array.isArray(candidate?.others) || candidate.others.length === 0) return null;
    return {
      id: r.id,
      model_id: r.model_id,
      run_date: r.run_date,
      category: r.category,
      candidate,
      affiliate_link: r.affiliate_link,
      published_at: r.published_at,
    };
  } catch {
    return null;
  }
}

/** Loads every published deal with a single query, plus the config. Rows that cannot be shown are dropped. */
export async function loadSiteData(db: SqlClient): Promise<SiteData> {
  const config = await loadConfig(db);
  const rows = await db.all<Row>(
    `SELECT c.id, c.model_id, c.payload, c.affiliate_link, r.category, r.models_compared, r.run_date, s.published_at
     FROM candidates c JOIN runs r ON r.id = c.run_id
     LEFT JOIN posts s ON s.candidate_id = c.id AND s.channel = 'telegram_channel'
     WHERE c.status = 'published' AND c.affiliate_link IS NOT NULL
     ORDER BY r.run_date, c.id`,
  );
  const deals: Deal[] = [];
  const largestRun = new Map<string, Map<string, number>>(); // day -> category -> largest run
  for (const r of rows) {
    const deal = parse(r);
    if (!deal) continue;
    deals.push(deal);
    const perCategory = largestRun.get(r.run_date) ?? new Map<string, number>();
    perCategory.set(r.category, Math.max(perCategory.get(r.category) ?? 0, r.models_compared));
    largestRun.set(r.run_date, perCategory);
  }
  const comparedByDay: Record<string, number> = {};
  for (const [day, perCategory] of largestRun) comparedByDay[day] = [...perCategory.values()].reduce((a, b) => a + b, 0);
  const present = new Set(deals.map((d) => d.category));
  return {
    threshold_pct: config.threshold_pct,
    deals,
    comparedByDay,
    categories: config.categories.filter((c) => present.has(c.id)),
  };
}

const unique = (values: string[]) => [...new Set(values)].sort();

export const listDays = (d: SiteData): string[] => unique(d.deals.map((x) => x.run_date));
export const listMonths = (d: SiteData): string[] => unique(d.deals.map((x) => x.run_date.slice(0, 7)));

const neighbours = (all: string[], key: string) => {
  const i = all.indexOf(key);
  return { prev: all[i - 1] ?? null, next: all[i + 1] ?? null };
};

const maxOf = (values: string[]) => values.reduce((a, b) => (b > a ? b : a));

function dayLastmod(runDate: string, deals: Deal[]): string {
  const posted = deals.map((x) => x.published_at).filter((p): p is string => p !== null);
  return posted.length === 0 ? runDate : maxOf(posted);
}

/** One item per model (earliest published wins), best percentage first, then title. */
function pickDayItems(deals: Deal[]): Deal[] {
  const byModel = new Map<string, Deal>();
  for (const x of deals) {
    const kept = byModel.get(x.model_id);
    if (!kept || (x.published_at ?? LAST) < (kept.published_at ?? LAST)) byModel.set(x.model_id, x);
  }
  return [...byModel.values()].sort(byDiscountThenTitle);
}

/** One item per model: its best discount, ties going to the most recent day. */
function pickMonthItems(deals: Deal[]): Deal[] {
  const byModel = new Map<string, Deal>();
  for (const x of deals) {
    const kept = byModel.get(x.model_id);
    if (!kept) {
      byModel.set(x.model_id, x);
      continue;
    }
    const diff = tenthsOf(x.candidate) - tenthsOf(kept.candidate);
    if (diff > 0 || (diff === 0 && x.run_date > kept.run_date)) byModel.set(x.model_id, x);
  }
  return [...byModel.values()].sort(byDiscountThenTitle);
}

export function dayPage(d: SiteData, runDate: string): DayPage | null {
  const deals = d.deals.filter((x) => x.run_date === runDate);
  if (deals.length === 0) return null;
  const categoryIds = new Set(deals.map((x) => x.category));
  const items = pickDayItems(deals);
  return {
    run_date: runDate,
    items,
    models_compared: d.comparedByDay[runDate] ?? 0,
    ...neighbours(listDays(d), runDate),
    month: runDate.slice(0, 7),
    lastmod: dayLastmod(runDate, items),
    categoryId: categoryIds.size === 1 ? deals[0]!.category : null,
  };
}

export function monthPage(d: SiteData, month: string): MonthPage | null {
  const deals = d.deals.filter((x) => x.run_date.startsWith(`${month}-`));
  if (deals.length === 0) return null;
  const days = unique(deals.map((x) => x.run_date));
  return {
    month,
    items: pickMonthItems(deals),
    days,
    ...neighbours(listMonths(d), month),
    lastmod: maxOf(days.map((day) => dayLastmod(day, pickDayItems(deals.filter((x) => x.run_date === day))))),
  };
}
