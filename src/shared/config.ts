import type { SqlClient } from "./db/sql-client.js";

export type Category = { id: string; name: string; terms: string[] };
export type AppConfig = {
  threshold_pct: number;
  query_budget: number;
  collect_time: string;
  notify_time: string;
  revalidate_time: string;
  publish_time: string;
  categories: Category[];
};

export async function loadConfig(db: SqlClient): Promise<AppConfig> {
  const rows = await db.all<{ name: string; value: string }>("SELECT name, value FROM config");
  const m = new Map(rows.map((r) => [r.name, r.value]));
  const text = (k: string): string => {
    const v = m.get(k);
    if (v === undefined) throw new Error(`config key missing: ${k}`);
    return v;
  };
  const num = (k: string): number => {
    const n = Number(text(k));
    if (!Number.isFinite(n)) throw new Error(`config key not numeric: ${k}`);
    return n;
  };
  return {
    threshold_pct: num("threshold_pct"),
    query_budget: num("query_budget"),
    collect_time: text("collect_time"),
    notify_time: text("notify_time"),
    revalidate_time: text("revalidate_time"),
    publish_time: text("publish_time"),
    categories: JSON.parse(text("categories")) as Category[],
  };
}
