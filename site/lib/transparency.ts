import type { SiteData } from "./deals.js";

export type TransparencyDay = { run_date: string; compared: number; published: number };

export type TransparencyStats = {
  compared: number;
  published: number;
  /** Published as a percentage of compared, one decimal; null when nothing was compared. */
  passPct: number | null;
  /** Newest first, capped at the requested number of days. */
  days: TransparencyDay[];
};

/** How many models were compared against how many passed the filter, overall and per day. */
export function transparencyStats(d: SiteData, limitDays = 30): TransparencyStats {
  const published = new Map<string, number>();
  for (const deal of d.deals) published.set(deal.run_date, (published.get(deal.run_date) ?? 0) + 1);
  const dates = [...new Set([...Object.keys(d.comparedByDay), ...published.keys()])].sort().reverse();
  const all = dates.map((run_date) => ({ run_date, compared: d.comparedByDay[run_date] ?? 0, published: published.get(run_date) ?? 0 }));
  const compared = all.reduce((a, x) => a + x.compared, 0);
  const total = all.reduce((a, x) => a + x.published, 0);
  return {
    compared,
    published: total,
    passPct: compared === 0 ? null : Math.round((total / compared) * 1000) / 10,
    days: all.slice(0, limitDays),
  };
}
