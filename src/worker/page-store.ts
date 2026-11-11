import type { Candidate } from "../contract/candidate-list.js";
import { pctTenths } from "../output/format.js";
import { renderHomePage, type PageInput } from "../output/page/render.js";
import { loadConfig } from "../shared/config.js";
import type { SqlClient } from "../shared/db/sql-client.js";
import { artDate, artIso } from "../shared/time.js";

type Deps = { db: SqlClient; now: () => Date; channelUrl: string };

type Row = {
  id: string;
  model_id: string;
  payload: string;
  affiliate_link: string;
  category: string;
  models_compared: number;
  published_at: string | null;
};

const ARCHIVE = "archive";
const HEADERS = { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" };

const tenthsOf = (c: Candidate) => pctTenths(c.ml.price_ars, Math.min(...c.others.map((o) => o.price_ars)));

/** One item per model (earliest published wins), best percentage first, then title. */
function pickItems(rows: Row[]): PageInput["items"] {
  const byModel = new Map<string, Row>();
  for (const r of rows) {
    const kept = byModel.get(r.model_id);
    if (!kept || (r.published_at ?? "￿") < (kept.published_at ?? "￿")) byModel.set(r.model_id, r);
  }
  const items: PageInput["items"] = [];
  for (const r of byModel.values()) {
    try {
      items.push({ candidate: JSON.parse(r.payload) as Candidate, affiliate_link: r.affiliate_link });
    } catch {
      // A payload that does not parse cannot be shown.
    }
  }
  return items.sort(
    (a, b) => tenthsOf(b.candidate) - tenthsOf(a.candidate) || a.candidate.title.localeCompare(b.candidate.title, "es"),
  );
}

/** Renders both pages first and writes afterwards, so a render failure leaves the stored pages untouched. */
export async function regeneratePages(deps: Deps): Promise<void> {
  const { db } = deps;
  const config = await loadConfig(db);
  const latest = await db.all<{ run_date: string }>(
    `SELECT r.run_date FROM candidates c JOIN runs r ON r.id = c.run_id
     WHERE c.status = 'published' AND c.affiliate_link IS NOT NULL
     ORDER BY r.run_date DESC LIMIT 1`,
  );
  const run_date = latest[0]?.run_date ?? null;
  const rows =
    run_date === null
      ? []
      : await db.all<Row>(
          `SELECT c.id, c.model_id, c.payload, c.affiliate_link, r.category, r.models_compared, s.published_at
           FROM candidates c JOIN runs r ON r.id = c.run_id
           LEFT JOIN posts s ON s.candidate_id = c.id AND s.channel = 'telegram_channel'
           WHERE r.run_date = ? AND c.status = 'published' AND c.affiliate_link IS NOT NULL
           ORDER BY c.id`,
          [run_date],
        );
  const base = { threshold_pct: config.threshold_pct, channelUrl: deps.channelUrl };
  const generatedAt = artIso(deps.now());

  if (run_date === null || rows.length === 0) {
    const html = renderHomePage({ ...base, mode: "none", run_date: null, categoryName: null, models_compared: 0, items: [] });
    await db.run("INSERT OR REPLACE INTO pages (page_key, html, generated_at) VALUES (?, ?, ?)", [ARCHIVE, html, generatedAt]);
    return;
  }

  const categoryName = config.categories.find((c) => c.id === rows[0]!.category)?.name ?? null;
  const data = {
    ...base,
    run_date,
    categoryName,
    models_compared: Math.max(...rows.map((r) => r.models_compared)),
    items: pickItems(rows),
  };
  const today = renderHomePage({ ...data, mode: "today" });
  const archive = renderHomePage({ ...data, mode: "archive" });
  await db.run("INSERT OR REPLACE INTO pages (page_key, html, generated_at) VALUES (?, ?, ?)", [`today:${run_date}`, today, generatedAt]);
  await db.run("INSERT OR REPLACE INTO pages (page_key, html, generated_at) VALUES (?, ?, ?)", [ARCHIVE, archive, generatedAt]);
}

const page = (html: string) => new Response(html, { status: 200, headers: HEADERS });

/** Serves today's page, else the archive, else the empty page. One query on the normal path. */
export async function servePage(deps: Deps): Promise<Response> {
  const todayKey = `today:${artDate(deps.now())}`;
  const rows = await deps.db.all<{ page_key: string; html: string }>(
    "SELECT page_key, html FROM pages WHERE page_key IN (?, 'archive')",
    [todayKey],
  );
  const hit = rows.find((r) => r.page_key === todayKey) ?? rows.find((r) => r.page_key === ARCHIVE);
  if (hit) return page(hit.html);
  const config = await loadConfig(deps.db);
  return page(
    renderHomePage({
      mode: "none",
      run_date: null,
      categoryName: null,
      threshold_pct: config.threshold_pct,
      models_compared: 0,
      items: [],
      channelUrl: deps.channelUrl,
    }),
  );
}
