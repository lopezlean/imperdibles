# Astro Static Site, SEO History and On-Demand Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Worker-rendered home with an Astro static site built from D1 (home, day pages, month pages, sitemap, robots) and a single `pnpm run ship` command that posts validated deals to Telegram, builds the site and deploys it.

**Architecture:** Astro lives at the repo root (`srcDir: ./site`, `outDir: ./dist/site`) and reads D1 once per build through `createD1HttpClient` (or a SQLite fixture file in tests). Pure modules (`slugs`, `deals`, `seo`) hold all logic and carry the unit tests; `.astro` files only lay out data. The same Worker serves `dist/site` as static assets and keeps only the webhook, `/internal/publish-now`, `/healthz` and the missing-run cron.

**Tech Stack:** TypeScript (strict, NodeNext, `.js` import specifiers), Astro 6 (`output: "static"`), `astro-seo`, `@astrojs/sitemap`, `dotenv`, Cloudflare Workers static assets + D1, vitest, better-sqlite3 (tests), pnpm, tsx.

**Spec:** `docs/superpowers/specs/2026-11-12-astro-site-design.md` (supersedes `2026-11-12-seo-history-pages-design.md`). Read it before starting.

## Global Constraints

- Strict TDD: every task starts with a failing test and shows it failing before implementing.
- Code, identifiers, comments, commit messages, console output: English. Spanish only for site copy (titles, headings, URLs, descriptions) exactly as the spec shows.
- Conventional commits. NO `Co-Authored-By` and NO AI attribution lines in any commit message.
- Do not use `cat/grep/find/sed/ls`; use `bat/rg/fd/sd/eza`.
- Run commands: `pnpm test`, `pnpm typecheck`; a single file with `pnpm exec vitest run <path>`.
- `SITE_URL` is required at build time; the build fails if it is missing. Canonical = absolute `SITE_URL` + path, every page self-canonicalises.
- `output: "static"`, `trailingSlash: "always"`, `srcDir: "./site"`, `outDir: "./dist/site"`, `site: SITE_URL`.
- URLs: day `/ofertas/<d>-de-<mes>-de-<yyyy>/` (day without leading zero, month lowercase), month `/ofertas/<mes>-de-<yyyy>/`; only days/months with published deals are generated (`getStaticPaths`); everything else falls to the 404 page.
- Titles: day `Mejores ofertas del jueves 12 de noviembre de 2026 en Mercado Libre | imperdibles`; month `Mejores ofertas de noviembre 2026 en Mercado Libre | imperdibles`; home `Ofertas en Mercado Libre hasta X% más baratas que en otras tiendas | imperdibles`. Description under ~155 chars, generated from data.
- `og:image` is the top-discount deal's photo only when it is an `mlstatic` URL (`catalogPhotoUrl`), otherwise omitted.
- JSON-LD: `BreadcrumbList` (Inicio > Mes > Día) on all pages; `ItemList` of `ListItem` (`position`, `name`, `url` = affiliate link, `image` when mlstatic) on every page including home. No `Product`/`Offer` types: a `Product` without offers triggers Search Console warnings, and a static page cannot claim current prices.
- Sitemap: `@astrojs/sitemap`, `lastmod` = latest `posts.published_at` of the page's deals, fallback `run_date`. `robots.txt`: allow all, `Sitemap: <SITE_URL>/sitemap-index.xml`, plus `Disallow: /internal/` and `Disallow: /telegram/`.
- Home heading always names the date ("Los imperdibles del jueves 12 de noviembre"), never "de hoy".
- Month page: each model once, keeping its best discount (tie: most recent `run_date`), showing that entry's date and prices; sorted by discount desc then title. Day page: per-model dedupe and order as `pickItems` (earliest `published_at` wins per model; best discount, then title with `localeCompare(..., "es")`).
- `publishValidated` stays in the Worker, unchanged except removing `afterPublish`. The 30-minute freshness window stays; deploy does not trigger revalidation.
- `pnpm run ship` order: publish (loop `POST $WORKER_BASE_URL/internal/publish-now` until a call publishes nothing, hard stop at 10 calls; a publish failure does not stop the site deploy) then `astro build` then `wrangler deploy`. Exit non-zero if build or upload fails and say Telegram posts already went out. `--site-only` skips publish.
- CI (`.github/workflows/deploy.yml`): `workflow_dispatch` only, `concurrency: { group: deploy, cancel-in-progress: false }`, runs `pnpm run ship --site-only`.
- The `0 14 * * *` publish cron is removed; `30 10 * * *` stays. The migration dropping `pages` is NOT part of this plan (follow-up, applied by hand after the new Worker is live).
- Do not touch the old `/` Worker route, `page-store.ts` or `render.ts` before Task 8.

## Review Focus

Failure modes the spec implies but its tests do not name, most likely first; each has a pinning test in the owning task.

1. A product title or link containing `</script>`, quotes or `&` must not break the page or the JSON-LD (Task 4 `jsonLdScript` escaping; Task 6 smoke on a hostile title).
2. A published candidate whose `payload` does not parse or has `others: []` must be skipped, and a day/month left with zero valid deals must not be generated or listed (Task 3).
3. A fresh database with no published deals: the build still succeeds, home shows `EMPTY_PAGE`, carries `noindex`, and no day/month pages exist (Task 6 second smoke build).
4. A repeated deploy or a failing publish endpoint (HTTP 401/500, network error, non-JSON body): site still builds, no loop beyond the cap, exit code reflects only build/upload (Task 7).
5. A deal published with no `posts` row (null `published_at`) or the same model published on two days of one month: `lastmod` falls back to `run_date`, month page keeps one entry with the best discount, ties go to the later day (Task 3).

## File Structure

| Path | Responsibility |
|---|---|
| `astro.config.ts` | Astro config: static, srcDir/outDir, trailingSlash, `site`, sitemap with `serialize`; `import "dotenv/config"` first |
| `site/lib/env.ts` | `readSiteEnv`: required `SITE_URL`, `TELEGRAM_CHANNEL_URL` |
| `site/lib/db.ts` | `openSiteDb`: D1 HTTP client, or read-only SQLite file when `SITE_FIXTURE_DB` is set |
| `site/lib/slugs.ts` | Pure slug/date conversion, weekday, paths |
| `site/lib/deals.ts` | `loadSiteData` (one query) plus pure `listDays/listMonths/dayPage/monthPage` |
| `site/lib/site-data.ts` | Memoized `getSiteData()` for pages (build-time glue, untested directly) |
| `site/lib/seo.ts` | Pure builders: titles, description, JSON-LD, og, robots, absolute URLs |
| `site/lib/sitemap.ts` | `lastmodByPath(data)` used by the sitemap `serialize` |
| `site/layouts/Base.astro` | Head (astro-seo, fonts, `PAGE_CSS`, JSON-LD), header, footer sections |
| `site/components/*.astro` | `DealCard`, `DealList`, `HistoryNav`, `Method`, `ChannelBand` (ported from `render.ts`) |
| `site/pages/index.astro`, `site/pages/ofertas/[slug].astro`, `site/pages/404.astro`, `site/pages/robots.txt.ts` | Routes |
| `scripts/ship.ts` | Deploy orchestration, injectable fetch/exec |
| `.github/workflows/deploy.yml` | Manual site-only deploy |
| `test/site/*.test.ts`, `test/site/support/*.ts` | Tests and seed helpers |
| Modified: `src/worker/index.ts`, `src/worker/publish.ts`, `src/worker/env.ts`, `wrangler.toml`, `package.json`, `tsconfig.json`, `.gitignore`, `src/output/format.ts`, `docs/env.md` | |
| Deleted (Task 8): `src/worker/page-store.ts`, `src/output/page/render.ts`, their tests and snapshot | |

`src/output/page/styles.ts` (`PAGE_CSS`, `PAGE_FONTS`) is reused as is by the Astro layout.

---

### Task 0: Gate on uncommitted edits (owner decision, no code)

**Files:** none modified.

- [ ] **Step 1: Record the baseline**

Run: `git status --short` and `pnpm typecheck`.
Observed at planning time: modified `package.json`, `src/output/copy.ts`, `src/output/format.ts`, `src/output/page/render.ts`, `src/worker/publish.ts`, `test/output/page/render.test.ts` and its snapshot; untracked `scripts/db-pull.sh`, `src/output/page/styles.ts`, the spec. **`src/worker/publish.ts` is corrupted in the working tree**: the first character of 135 of its 151 lines was replaced by `.`, so `pnpm typecheck` fails with `TS1128` at `src/worker/publish.ts(1,1)` (HEAD's copy is fine).

- [ ] **Step 2: STOP and ask the owner one question, then wait**

Ask whether those uncommitted edits (render/styles/copy/format redesign, `db:pull` script, and the broken `publish.ts`) are kept or abandoned. Do not decide, restore, delete or commit anything before the answer. Outcomes:
- Kept: commit them as separate conventional commits first (repair `publish.ts` from `git show HEAD:src/worker/publish.ts` only with the owner's confirmation). Later tasks reuse `styles.ts`, `copy.ts` and `format.ts` (`formatDateDots`, new copy constants) as they are in the working tree.
- Abandoned: the owner approves the discard (`git restore`/delete is the owner's call). Then `PAGE_CSS` and the copy used by the site must be taken from HEAD's `render.ts`, and Task 5 gets re-scoped.

- [ ] **Step 3: Verify the clean baseline**

Run: `pnpm typecheck && pnpm test`
Expected: both pass on a clean tree.

- [ ] **Step 4: Commit the spec and this plan**

```bash
git add docs/superpowers/specs/2026-11-12-astro-site-design.md docs/superpowers/plans/2026-11-12-astro-site.md
git commit -m "docs: add astro site spec and plan"
```

---

### Task 1: Astro scaffold, env and DB access

**Files:**
- Create: `astro.config.ts`, `site/lib/env.ts`, `site/lib/db.ts`, `site/pages/index.astro` (placeholder `<h1>`), `test/site/config.test.ts`, `test/site/env.test.ts`, `test/site/db.test.ts`
- Modify: `package.json` (deps and scripts), `tsconfig.json` (`include` adds `"site/lib"`, `"astro.config.ts"`), `.gitignore` (`dist/`, `.astro/`)

**Interfaces:**
- Produces: `readSiteEnv(env: Record<string, string | undefined>): { siteUrl: string; channelUrl: string }` (trailing slash stripped; throws `MissingEnvError`-style error naming the variables, never values; rejects non-`http(s)` `SITE_URL`).
- Produces: `openSiteDb(env: Record<string, string | undefined>): Promise<SqlClient>`.
- Produces: default export of `astro.config.ts` (`defineConfig` result); `SITE_OUT_DIR` env overrides `outDir` (used by smoke tests).

Config keys confirmed against current docs (Astro 6): `output: "static"`, `srcDir: "./site"`, `outDir: "./dist/site"`, `site`, `trailingSlash: "always"`, `build: { format: "directory" }` (default; docs pair `directory` with `trailingSlash: "always"`), `integrations: [sitemap({ serialize })]`. Install with `pnpm add astro astro-seo @astrojs/sitemap`; record the resolved versions in the commit body. `astro-seo` is checked for Astro 6 compatibility by the Task 5 smoke build.

- [ ] **Step 1: Write the failing tests**

`test/site/env.test.ts`:
- `it("requires SITE_URL and TELEGRAM_CHANNEL_URL")`: `readSiteEnv({})` throws; message contains `SITE_URL` and `TELEGRAM_CHANNEL_URL`.
- `it("strips a trailing slash")`: `readSiteEnv({SITE_URL:"https://imperdibles.com.ar/",TELEGRAM_CHANNEL_URL:"https://t.me/x"})` equals `{ siteUrl: "https://imperdibles.com.ar", channelUrl: "https://t.me/x" }`.
- `it("rejects a SITE_URL that is not http(s)")`: `"imperdibles.com.ar"` throws.

`test/site/db.test.ts`:
- `it("opens a read-only SQLite fixture when SITE_FIXTURE_DB is set")`: serialize `createSqliteClient().raw.serialize()` to a temp file; `openSiteDb({SITE_FIXTURE_DB: file})` then `all("SELECT COUNT(*) AS n FROM stores")` returns `n > 0`; `run("DELETE FROM stores")` rejects.
- `it("names the missing D1 variables")`: `openSiteDb({})` rejects with a message containing `D1_ACCOUNT_ID`, `D1_API_TOKEN`, `D1_DATABASE_ID`.

`test/site/config.test.ts` (uses `vi.resetModules()` and temporary `process.env`):
- `it("fails without SITE_URL")`: `await import("../../astro.config.js")` rejects.
- `it("pins the static output settings")`: with `SITE_URL=https://imperdibles.com.ar` and `TELEGRAM_CHANNEL_URL` set, the default export has `output "static"`, `srcDir "./site"`, `outDir "./dist/site"`, `trailingSlash "always"`, `site "https://imperdibles.com.ar"`; with `SITE_OUT_DIR=/tmp/x`, `outDir` is `/tmp/x`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run test/site`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`readSiteEnv` in `site/lib/env.ts`. `openSiteDb` in `site/lib/db.ts`: when `SITE_FIXTURE_DB` is set, dynamically import `better-sqlite3` and return a `SqlClient` adapter over `new Database(file, { readonly: true })` (same shape as `test/support/sqlite-client.ts`); otherwise `loadLocalEnv(env, ["cfAccountId","cfApiToken","d1DatabaseId"])` then `createD1HttpClient`. `astro.config.ts`: first line `import "dotenv/config"`, then `readSiteEnv(process.env)` (this is what makes the build fail without `SITE_URL`), config with the keys above, `sitemap()` without `serialize` for now. Add scripts `"site:dev": "astro dev"`, `"site:build": "astro build"`. Placeholder `index.astro` renders `<h1>imperdibles</h1>` only so `astro build` can run.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run test/site && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add astro.config.ts site package.json pnpm-lock.yaml tsconfig.json .gitignore test/site
git commit -m "feat(site): scaffold the astro project with env and d1 access"
```

---

### Task 2: Slug and date module

**Files:**
- Create: `site/lib/slugs.ts`, `test/site/slugs.test.ts`
- Modify: `src/output/format.ts` (export the existing private `MONTHS` array as `MONTH_NAMES`, no other change)

**Interfaces:**
- Produces (all in `site/lib/slugs.ts`):
  - `daySlug(runDate: string): string`
  - `monthSlug(month: string): string` (`month` is `YYYY-MM`)
  - `parseDaySlug(slug: string): string | null` (returns `YYYY-MM-DD`)
  - `parseMonthSlug(slug: string): string | null` (returns `YYYY-MM`)
  - `dayPath(runDate: string): string`, `monthPath(month: string): string`
  - `weekdayName(runDate: string): string` (lowercase Spanish, UTC-based, no `Intl`)
  - `monthOf(runDate: string): string`

- [ ] **Step 1: Write the failing tests** in `test/site/slugs.test.ts`
- `daySlug("2026-11-12")` is `"12-de-noviembre-de-2026"`; `daySlug("2026-11-05")` is `"5-de-noviembre-de-2026"`.
- `monthSlug("2026-11")` is `"noviembre-de-2026"`.
- `dayPath("2026-11-12")` is `"/ofertas/12-de-noviembre-de-2026/"`; `monthPath("2026-11")` is `"/ofertas/noviembre-de-2026/"`.
- Round trip: for every date of 2026 (`it.each` over all 365), `parseDaySlug(daySlug(d)) === d`; for each `YYYY-MM` of 2026, `parseMonthSlug(monthSlug(m)) === m`.
- Invalid returns `null`: `"31-de-febrero-de-2026"`, `"29-de-febrero-de-2027"`, `"05-de-noviembre-de-2026"` (leading zero), `"12-de-Noviembre-de-2026"` (uppercase), `"12-de-nov-de-2026"`, `"noviembre-de-2026"` passed to `parseDaySlug`, `"12-de-noviembre-de-2026"` passed to `parseMonthSlug`, `""`.
- `weekdayName("2026-11-12")` is `"jueves"`; `weekdayName("2026-11-15")` is `"domingo"`.
- `monthOf("2026-11-12")` is `"2026-11"`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run test/site/slugs.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** the signatures above in `site/lib/slugs.ts`. Validate a parsed date by rebuilding it (`new Date(Date.UTC(y, m-1, d))` fields must equal the input); the day slug regex rejects a leading zero.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run test/site/slugs.test.ts test/output/format.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site/lib/slugs.ts src/output/format.ts test/site/slugs.test.ts
git commit -m "feat(site): add spanish day and month slugs"
```

---

### Task 3: Deals data layer

**Files:**
- Create: `site/lib/deals.ts`, `site/lib/site-data.ts`, `test/site/deals.test.ts`, `test/site/support/seed-deals.ts`
- Test helper reuses `test/support/sqlite-client.ts` and `test/worker/support/seed.ts`.

**Interfaces:**
- Consumes: `SqlClient` (`src/shared/db/sql-client.ts`), `loadConfig` (`src/shared/config.ts`), `pctTenths` (`src/output/format.ts`), `Candidate` type.
- Produces (in `site/lib/deals.ts`):
  ```ts
  export type Deal = { id: string; model_id: string; run_date: string; category: string;
    candidate: Candidate; affiliate_link: string; published_at: string | null };
  export type SiteData = { threshold_pct: number; deals: Deal[]; comparedByDay: Record<string, number> };
  export type DayPage = { run_date: string; items: Deal[]; models_compared: number;
    prev: string | null; next: string | null; month: string; lastmod: string };
  export type MonthPage = { month: string; items: Deal[]; days: string[];
    prev: string | null; next: string | null; lastmod: string };
  export function loadSiteData(db: SqlClient): Promise<SiteData>;   // ONE deals query + loadConfig
  export function listDays(d: SiteData): string[];                  // ascending YYYY-MM-DD
  export function listMonths(d: SiteData): string[];                // ascending YYYY-MM
  export function dayPage(d: SiteData, runDate: string): DayPage | null;
  export function monthPage(d: SiteData, month: string): MonthPage | null;
  ```
- Produces (`site/lib/site-data.ts`): `getSiteData(): Promise<SiteData>` memoized for the process (`openSiteDb(process.env)` then `loadSiteData`).
- Produces (`test/site/support/seed-deals.ts`): `seedDeal(db, o: { id: string; run_date: string; model_id: string; title?: string; ml?: number; rival?: number; category?: string; models_compared?: number; publishedAt?: string | null; link?: string | null; payload?: string; status?: string })` creating the run (reusing an existing `run-<date>-<category>` id), model, candidate and optional `posts` row (`telegram_channel`). Candidate JSON follows the shape in `test/worker/page-store.test.ts` `payloadFor`.

Query: published rows `candidates JOIN runs` with `status='published' AND affiliate_link IS NOT NULL`, `LEFT JOIN posts ... channel='telegram_channel'`, columns as in `regeneratePages` plus `r.run_date`. Rows with unparseable payload or empty `others` are dropped. `comparedByDay` reuses the `comparedOfDay` rule (largest run per category, summed) per day, from the kept rows. Sort comparator: `pctTenths(ml, min(others))` desc then `title.localeCompare(.., "es")`.

- [ ] **Step 1: Write the failing tests** in `test/site/deals.test.ts` (seed with `createSqliteClient()`)
- `listDays` returns `["2026-11-10","2026-11-12"]` ascending when those two days have published deals and `2026-11-11` has only a `validated` candidate; `listMonths` returns `["2026-10","2026-11"]` with an extra deal on `2026-10-31`.
- Excludes `status` other than `published` and `affiliate_link = NULL`.
- Day dedupe: two published rows for model `m1` (published_at `T1` earlier, `T2` later) yield one item, the `T1` row; sorted by discount desc then title: seed (ml 329999 / rival 399999 = 17,5%) vs (ml 300000 / rival 400000 = 25%): the 25% item first; equal discount sorted `"Álamo"` before `"Zeta"`.
- Mixed categories on one day: `models_compared` is the sum of each category's largest run (runs 10 and 14 in category A, 7 in B gives 21).
- Month best-per-model: model `m1` at 17,5% on `2026-11-03` and 25% on `2026-11-10` yields one item with `run_date "2026-11-10"`; equal discount on 03 and 10 yields the `2026-11-10` entry; `days` lists each day with deals ascending.
- `prev`/`next`: with days 10 and 12 and 14, `dayPage(d,"2026-11-12")` has `prev "2026-11-10"`, `next "2026-11-14"`; first day has `prev null`. Same for months.
- `lastmod`: day with `published_at "2026-11-12T11:05:00-03:00"` and `"2026-11-12T11:20:00-03:00"` gives `"2026-11-12T11:20:00-03:00"`; a day with no `posts` row gives `"2026-11-12"`. Month lastmod is the max of its days'.
- Unparseable payload (`"{not json"`) and `others: []` rows are skipped; a day whose only row is unparseable is absent from `listDays` and `dayPage` returns `null`.
- `dayPage(d, "2026-11-13")` and `monthPage(d, "2026-12")` return `null`.
- `threshold_pct` equals the seeded config value (`15`).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run test/site/deals.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `loadSiteData` and the pure functions with the signatures above; `getSiteData` in `site-data.ts`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run test/site/deals.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site/lib/deals.ts site/lib/site-data.ts test/site
git commit -m "feat(site): load published deals once and group them by day and month"
```

---

### Task 4: SEO builders and sitemap lastmod map

**Files:**
- Create: `site/lib/seo.ts`, `site/lib/sitemap.ts`, `test/site/seo.test.ts`, `test/site/sitemap.test.ts`
- Modify: `astro.config.ts` (add `serialize` using `lastmodByPath`)

**Interfaces:**
- Consumes: `Deal`, `DayPage`, `MonthPage`, `SiteData` (Task 3); `daySlug`, `dayPath`, `monthPath`, `weekdayName` (Task 2); `formatDateLong`, `formatPct`, `truncate` (`src/output/format.ts`); `catalogPhotoUrl`.
- Produces (`site/lib/seo.ts`):
  ```ts
  export const dayTitle: (runDate: string) => string;
  export const monthTitle: (month: string) => string;
  export const homeTitle: (topPct: string) => string;          // topPct like "25,0"
  export const buildDescription: (o: { count: number; topPct: string; names: string[] }) => string;
  export const topPct: (items: Deal[]) => string;               // formatPct of the best-discount deal
  export const ogImageOf: (items: Deal[]) => string | null;     // top deal's catalogPhotoUrl or null
  export const absoluteUrl: (site: string, path: string) => string;
  export const breadcrumbLd: (crumbs: { name: string; url: string }[]) => object;
  export const itemListLd: (items: Deal[]) => object;
  export const jsonLdScript: (data: object) => string;          // JSON.stringify with "<" escaped as <
  export const buildRobotsTxt: (siteUrl: string) => string;
  ```
- Produces (`site/lib/sitemap.ts`): `lastmodByPath(d: SiteData): Map<string, string>` keyed by path (`"/"`, day paths, month paths).

- [ ] **Step 1: Write the failing tests**
`test/site/seo.test.ts`:
- `dayTitle("2026-11-12")` equals `"Mejores ofertas del jueves 12 de noviembre de 2026 en Mercado Libre | imperdibles"`.
- `monthTitle("2026-11")` equals `"Mejores ofertas de noviembre 2026 en Mercado Libre | imperdibles"`.
- `homeTitle("25,0")` equals `"Ofertas en Mercado Libre hasta 25,0% más baratas que en otras tiendas | imperdibles"`.
- `buildDescription({count:3, topPct:"25,0", names:["A","B","C"]})` equals `"3 ofertas verificadas en Mercado Libre, hasta 25,0% más baratas que en otras tiendas: A, B, C."`; `count:1` uses `"1 oferta verificada"`; with 3 names of 80 characters the result length is at most 155 and ends with `"…"`.
- `ogImageOf` returns the top deal's `https://http2.mlstatic.com/x.jpg` and returns `null` for a non-mlstatic or null `image_url`.
- `absoluteUrl("https://imperdibles.com.ar","/ofertas/noviembre-de-2026/")` equals `"https://imperdibles.com.ar/ofertas/noviembre-de-2026/"`.
- `itemListLd`: `JSON.stringify` of the result does not contain `"offers"` or `"price"`; each element is `{"@type":"ListItem","position":n,"name":...,"url":...,"image":...}` and the string contains no `"Product"`; `image` key is absent when the deal has no mlstatic photo.
- `breadcrumbLd` has `@type "BreadcrumbList"` with positions 1..n.
- `jsonLdScript` of a product named `</script><b>"x" & y` contains neither `</script>` nor a raw `<`, and `JSON.parse` of the output still returns the original name.
- `buildRobotsTxt("https://imperdibles.com.ar")` equals `"User-agent: *\nAllow: /\nDisallow: /internal/\nDisallow: /telegram/\n\nSitemap: https://imperdibles.com.ar/sitemap-index.xml\n"`.

`test/site/sitemap.test.ts`: with the Task 3 seed, `lastmodByPath` maps `/ofertas/12-de-noviembre-de-2026/` to that day's lastmod, `/ofertas/noviembre-de-2026/` to the month's, and `"/"` to the latest day's; a day without a `posts` row maps to its `run_date`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run test/site/seo.test.ts test/site/sitemap.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement** the signatures above. `buildDescription` truncates with `truncate(s, 155)`. In `astro.config.ts` add `serialize(item) { item.lastmod = (await lastmods()).get(new URL(item.url).pathname) ?? item.lastmod; return item; }` where `lastmods` is a memoized `getSiteData().then(lastmodByPath)` (serialize may be async per docs; the 404 page is excluded by the integration itself).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run test/site && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site/lib astro.config.ts test/site
git commit -m "feat(site): build seo titles, descriptions, json-ld and sitemap lastmod"
```

---

### Task 5: Layout, components and home page

**Files:**
- Create: `site/layouts/Base.astro`, `site/components/{Header,DealCard,DealList,HistoryNav,Method,ChannelBand,Footer}.astro`, `test/site/build.test.ts`, `test/site/support/build-site.ts`
- Modify: `site/pages/index.astro` (replace placeholder)

**Interfaces:**
- Consumes: Tasks 1-4 modules; `PAGE_CSS`, `PAGE_FONTS` from `src/output/page/styles.ts`; copy constants from `src/output/copy.ts`; `categoryArtSvg`, `categoryArtLabel`, `catalogPhotoUrl`, `formatArs`, `formatPct`, `formatDateShort`, `formatDateLong`, `formatDateDots`, `formatThreshold`.
- Produces (`test/site/support/build-site.ts`): `buildSite(opts: { seed: (db: SqlClient & { raw: Database }) => Promise<void> }): Promise<{ dir: string; read(rel: string): string; exists(rel: string): boolean }>`: builds a SQLite file via `createSqliteClient()` + `raw.serialize()`, runs `pnpm exec astro build` with `SITE_FIXTURE_DB`, `SITE_URL=https://imperdibles.com.ar`, `TELEGRAM_CHANNEL_URL=https://t.me/x`, `SITE_OUT_DIR=<tmp>`.
- Produces (`Base.astro` props): `{ title: string; description: string; path: string; ogImage: string | null; jsonLd: object[]; noindex?: boolean; threshold_pct: number; channelUrl: string }`.

Port `render.ts` markup 1:1 (class names, structure, `article` card, chips, `why`, `method`, `channel`, footer) so the existing `PAGE_CSS` applies unchanged; Astro escaping replaces `escapeHtml`; SVG art goes through `set:html`. Head: `<SEO>` from `astro-seo` with `title`, `description`, `canonical` (absolute), `twitter`, and `openGraph` only when `ogImage` is set; astro-seo throws if `openGraph` lacks `basic.image`, so without an image pass `extend.meta` for `og:title`, `og:type`, `og:url`, `og:description`, `og:locale` instead. `<link href={PAGE_FONTS}>`, `<style set:html={PAGE_CSS}>`, `<script type="application/ld+json" set:html={jsonLdScript(...)}>`. Header nav hrefs are root-absolute (`/`, `/#como`, `/#canal`) so they work on every page. `HistoryNav` links to previous day, current month page.
Home page: latest day from `listDays`, heading `Los imperdibles del ${weekdayName} ${formatDateLong}`, `mode` equivalent to the old archive; "Historial" nav to the previous day and the month; no deals renders `EMPTY_PAGE` + `EMPTY_PAGE_LEAD` and `noindex`. Home JSON-LD: breadcrumb (Inicio only) and `itemListLd`.

- [ ] **Step 1: Write the failing test** `test/site/build.test.ts` (timeout 120 s)
`it("builds the home page from fixture data")`: seed days `2026-11-10` and `2026-11-12` (two deals on the 12th, 25% and 17,5%, titles `Robot Alfa` and `Robot Beta`), then:
- `exists("index.html")`; the HTML contains `<link rel="canonical" href="https://imperdibles.com.ar/">`, a `<meta name="description"` whose content starts with `2 ofertas verificadas en Mercado Libre, hasta 25,0%`, `<title>Ofertas en Mercado Libre hasta 25,0% más baratas que en otras tiendas | imperdibles</title>`, `Los imperdibles del jueves 12 de noviembre de 2026`, `rel="sponsored noopener"`, `"@type":"ItemList"`, and not `"offers"`; `Robot Alfa` appears before `Robot Beta`.
- The home links to `/ofertas/10-de-noviembre-de-2026/` and `/ofertas/noviembre-de-2026/`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run test/site/build.test.ts`
Expected: FAIL (placeholder page lacks the content).

- [ ] **Step 3: Implement** layout, components and the home page as described.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run test/site/build.test.ts`
Expected: PASS. Also run `pnpm site:build` once against fixtures and compare visually with the old home (`pnpm worker:dev`) for parity; note any deviation.

- [ ] **Step 5: Commit**

```bash
git add site test/site
git commit -m "feat(site): render the home page with the shared layout and seo head"
```

---

### Task 6: Day, month, 404, robots and sitemap pages

**Files:**
- Create: `site/pages/ofertas/[slug].astro`, `site/pages/404.astro`, `site/pages/robots.txt.ts`
- Modify: `test/site/build.test.ts`

**Interfaces:**
- Consumes: `getSiteData`, `listDays`, `listMonths`, `dayPage`, `monthPage`, `daySlug`, `monthSlug`, seo builders, components from Task 5.
- `[slug].astro`: `getStaticPaths` returns `{ params: { slug }, props: { kind: "day" | "month", key } }` for every day in `listDays` and month in `listMonths` (never anything else). Day page: items list, prev/next day links, link to its month, `models_compared` chip. Month page: best-per-model items showing each entry's date, days-with-deals list, prev/next month links. Both set `ogImage` via `ogImageOf`, breadcrumb Inicio > Mes > Día.
- `robots.txt.ts`: `export const GET = () => new Response(buildRobotsTxt(readSiteEnv(process.env).siteUrl))`.

- [ ] **Step 1: Write the failing tests** (extend `test/site/build.test.ts`, same seed plus one deal titled `Robot </script> "Gamma" & Co`)
- `it("generates day and month pages")`: `exists("ofertas/12-de-noviembre-de-2026/index.html")` and `exists("ofertas/noviembre-de-2026/index.html")` are true; `exists("ofertas/11-de-noviembre-de-2026/index.html")` is false; the day HTML has `<title>Mejores ofertas del jueves 12 de noviembre de 2026 en Mercado Libre | imperdibles</title>`, canonical `https://imperdibles.com.ar/ofertas/12-de-noviembre-de-2026/`, links to `/ofertas/10-de-noviembre-de-2026/` (prev) and `/ofertas/noviembre-de-2026/`; the month HTML title is `Mejores ofertas de noviembre 2026 en Mercado Libre | imperdibles`.
- `it("keeps hostile titles inert")`: no day HTML contains the raw string `</script> "Gamma"`; every `application/ld+json` block parses with `JSON.parse`.
- `it("writes robots and sitemap")`: `robots.txt` contains `Sitemap: https://imperdibles.com.ar/sitemap-index.xml` and `Disallow: /internal/`; `sitemap-index.xml` exists; `sitemap-0.xml` contains `https://imperdibles.com.ar/ofertas/12-de-noviembre-de-2026/`, a `<lastmod>` equal to the seeded latest `published_at` for it, and not `/404`.
- `it("emits 404.html")`: `exists("404.html")`.
- `it("builds an empty database")` (second build, no seed): succeeds; `index.html` contains `Todavía no hay imperdibles publicados.` and `noindex`; no `ofertas/` directory.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run test/site/build.test.ts`
Expected: FAIL (pages missing).

- [ ] **Step 3: Implement** the three files above plus `404.astro` using `Base` with `noindex` and a link home (title `Página no encontrada | imperdibles`).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run test/site && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site test/site
git commit -m "feat(site): add day, month, 404, robots and sitemap pages"
```

---

### Task 7: `ship` command

**Files:**
- Create: `scripts/ship.ts`, `test/site/ship.test.ts`
- Modify: `package.json` (`"ship": "tsx scripts/ship.ts"`)

**Interfaces:**
- Consumes: `loadLocalEnv` (`src/shared/env.ts`).
- Produces:
  ```ts
  export const MAX_PUBLISH_CALLS = 10;
  export type ShipDeps = {
    fetch: typeof fetch;
    exec: (cmd: string, args: string[]) => Promise<number>;   // exit code
    log: (line: string) => void;
    workerBaseUrl: string;
    publishNowSecret: string;
  };
  export function ship(deps: ShipDeps, opts: { siteOnly: boolean }): Promise<number>; // process exit code
  ```
- `main()` (guarded so importing the module does not run it) loads `.env` with `dotenv/config`, parses `process.argv` for `--site-only`, requires `WORKER_BASE_URL` and `PUBLISH_NOW_SECRET` only when not site-only, uses `child_process.spawn(..., { stdio: "inherit" })` for `exec`, and `process.exit(await ship(...))`.
- Commands run: `exec("pnpm", ["exec","astro","build"])` then `exec("pnpm", ["exec","wrangler","deploy"])`.
- Publish call: `POST ${workerBaseUrl without trailing slash}/internal/publish-now` with `Authorization: Bearer <secret>`; body is the `PublishReport` JSON `{published, failed, stale}`.

- [ ] **Step 1: Write the failing tests** in `test/site/ship.test.ts` (fake `fetch`, `exec` recording calls)
- `it("publishes until a call publishes nothing")`: reports `{published:["a"]}`, `{published:["b"]}`, `{published:[]}` give exactly 3 fetch calls, then build, then deploy; returns `0`.
- `it("stops at 10 publish calls")`: endless `{published:["x"]}` gives exactly `MAX_PUBLISH_CALLS` calls.
- `it("counts a failures-only call as nothing")`: `{published:[],failed:["c"],stale:[]}` ends the loop after 1 call.
- `it("--site-only makes no publish call")`: `fetch` never called, build and deploy run, returns `0`.
- `it("sends the Bearer secret to the worker")`: URL `https://w.test/internal/publish-now` (also when the base ends in `/`), method `POST`, header `Authorization: Bearer s3cret`.
- `it("still builds when publishing fails")`: HTTP 500, a thrown network error and a non-JSON body each stop the publish loop, are logged, and build plus deploy still run; return `0`.
- `it("exits non-zero when the build fails")`: build exit code `1` gives return `1`, deploy not called, a logged line contains `Telegram posts already went out`.
- `it("exits non-zero when the upload fails")`: deploy exit `1` gives return `1` with the same message.
- `it("--site-only build failure does not claim Telegram posts")`: the message is omitted.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run test/site/ship.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `ship` and `main`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run test/site/ship.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/ship.ts package.json test/site/ship.test.ts
git commit -m "feat(deploy): add the ship command that publishes, builds and uploads"
```

---

### Task 7b: The revalidation job runs ship instead of publish-now

Owner decision: after revalidating, when the publication hour has passed and something is pending, the local job runs the full `ship` (publish + build + upload) so Telegram and the website never drift apart.

**Files:**
- Modify: `src/output/local/after-revalidation.ts` (the final publish-now block), `src/local/output-hooks.ts:30-45` (wiring)
- Test: `test/output/local/after-revalidation.test.ts`, `test/output/local/send-shortlist.test.ts` (wiring cases that pass `workerBaseUrl`)

**Interfaces:**
- Consumes: `ship(deps, { siteOnly: false })` and `ShipDeps` from Task 7.
- Produces: `AfterRevalidationDeps` loses `fetch`, `workerBaseUrl`, `publishSecret` (if nothing else in the hook uses them) and gains `runShip: () => Promise<number>` (exit code). `output-hooks.ts` builds `runShip` by calling `ship` with the real `fetch`, a `spawn`-based `exec`, `console.log`, `env.workerBaseUrl` and `env.publishNowSecret`; the existing "missing WORKER_BASE_URL" guard stays.
- The `publish_time` gate and the "something pending" query are unchanged.

- [ ] **Step 1: Write the failing tests** (replace the publish-now fetch assertions)
- `it("runs ship once when the hour has passed and something is pending")`: `runShip` called exactly 1 time.
- `it("does not run ship before publish_time")` and `it("does not run ship when nothing is pending")`: 0 calls.
- `it("tells the owner when ship fails")`: `runShip` resolves `1` → owner gets `No se pudo completar el ship (publicación y web). Revisar la salida del job.`; a thrown error gives the same message and does not throw out of `afterRevalidation`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run test/output/local/after-revalidation.test.ts`
Expected: FAIL (`runShip` not called).

- [ ] **Step 3: Implement** the swap in the hook and the wiring in `output-hooks.ts`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/output/local/after-revalidation.ts src/local/output-hooks.ts test/output/local
git commit -m "feat(local): run ship after revalidation instead of only publishing"
```

---

### Task 8: Switch-over, part 1: the Worker stops rendering pages

Prerequisite: Task 0 answered. From here the old `/` stops existing in the Worker; Task 9 must land in the same deploy.

**Files:**
- Modify: `src/worker/index.ts`, `src/worker/publish.ts` (remove `afterPublish` from `Deps` and its call block), `src/worker/env.ts` (drop `TELEGRAM_CHANNEL_URL`), `test/worker/routes.test.ts`, `test/worker/cpu-budget.test.ts`, `test/worker/publish.test.ts`, `test/worker/worker-imports.test.ts`, `test/e2e/full-run.test.ts`
- Delete: `src/worker/page-store.ts`, `src/output/page/render.ts`, `test/worker/page-store.test.ts`, `test/output/page/render.test.ts`, `test/output/page/__snapshots__/render.test.ts.snap`

**Interfaces:**
- Produces: `handleFetch` answering only `/healthz`, `/telegram/webhook`, `/internal/publish-now`, else 404; `handleScheduled` accepting only `"30 10 * * *"`; `publishValidated(deps: { db; telegram; channelId; ownerChatId; now })` (no `afterPublish`).

- [ ] **Step 1: Write the failing tests**
`test/worker/routes.test.ts` (replace the 11:00 cron test and extend "other routes"):
- `it("GET / is no longer served by the Worker")`: `handleFetch(new Request(url("/")), deps())` has status `404`.
- `it("the 14:00 publish cron is gone")`: `handleScheduled("0 14 * * *", deps())` rejects with `unknown cron`.
- `it("publish-now publishes without touching pages")`: after the existing publish-now success flow, `SELECT COUNT(*) AS n FROM pages` is `0`.
`test/worker/cpu-budget.test.ts`: replace the cron and `GET /` tests with `it("publish-now: publish the capped 5 of 10 validated candidates")` calling `handleFetch(new Request("https://imperdibles.com.ar/internal/publish-now", { method: "POST", headers: { Authorization: "Bearer pub-secret" } }), deps)` and asserting 5 published rows and median CPU below `CAP_US`.
`test/worker/worker-imports.test.ts`: drop `src/output/page/render.ts` (and `src/output/html.ts` if it is no longer reached) from the "reaches" list; keep the forbidden-package assertions.
`test/e2e/full-run.test.ts`: the cron call becomes `handleScheduled` removal: publish through `POST /internal/publish-now` via `w.get`/the world's fetch helper; replace every `w.get("/")` page assertion (`expectPublishedPage`, `EMPTY_PAGE`) with a read through `loadSiteData` + `dayPage` (Task 3) asserting the published candidate title and affiliate link, and for the empty run `listDays(...)` equals `[]`. Remove the `renderHomePage` import and the test that renders the page from a fixture.
`test/worker/publish.test.ts`: remove `afterPublish` from every `deps`, delete cases that assert it.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run test/worker test/e2e`
Expected: FAIL on the new route/cron/pages assertions (old code still serves `/`).

- [ ] **Step 3: Implement**: remove `servePage`/`regeneratePages` imports, `afterPublish`, `serveHome`, the `"/"` case, `CRON_PUBLISH` and its branch from `src/worker/index.ts`; update the comment above `CRON_MISSING_RUN` (`publish_time` is still read by the local after-revalidation hook, so the config entry stays). Remove the `afterPublish` field and the "regenerate" block from `publishValidated` (keep the `pending` error flow). Delete the files listed. Find remaining references with `rg "page-store|renderHomePage|afterPublish|TELEGRAM_CHANNEL_URL" src test scripts`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src test
git commit -m "refactor(worker): drop page rendering and the publish cron"
```

---

### Task 9: Switch-over, part 2: Worker serves the static assets

**Files:**
- Modify: `wrangler.toml`, `test/worker/wrangler-config.test.ts`, `package.json` (`worker:dev` note not needed)

**Interfaces:** `wrangler.toml` final shape (keys confirmed against current Cloudflare docs):

```toml
name = "imperdibles"
main = "src/worker/index.ts"
compatibility_date = "2026-11-01"
workers_dev = false

[assets]
directory = "dist/site"
html_handling = "force-trailing-slash"
not_found_handling = "404-page"
run_worker_first = ["/telegram/*", "/internal/*", "/healthz"]

[[d1_databases]]
# unchanged

[triggers]
crons = ["30 10 * * *"]
```

`[vars]` (`TELEGRAM_CHANNEL_URL`) is removed because only the build needs it now. `workers_dev = false` is safe only after the owner attached `imperdibles.com.ar` (spec Rollout step 1).

- [ ] **Step 1: Write the failing test** (rewrite `test/worker/wrangler-config.test.ts`, same regex style, read `wrangler.toml` as text)
- `it("declares only the missing-run cron")`: crons equal `["30 10 * * *"]`.
- `it("serves the Astro output as static assets")`: contains `directory = "dist/site"`, `not_found_handling = "404-page"`, `html_handling = "force-trailing-slash"`.
- `it("runs the Worker first only for its own routes")`: the `run_worker_first` array equals `["/telegram/*", "/internal/*", "/healthz"]`.
- `it("keeps the assets directory equal to the Astro outDir")`: the TOML `directory` equals the `outDir` string in `astro.config.ts` default (`./dist/site` after normalising the leading `./`).
- `it("disables workers.dev")`: `workers_dev = false`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run test/worker/wrangler-config.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the `wrangler.toml` change above.

- [ ] **Step 4: Run to verify pass, then dry-run**

Run: `pnpm test && SITE_URL=https://imperdibles.com.ar TELEGRAM_CHANNEL_URL=https://t.me/x pnpm site:build && pnpm exec wrangler deploy --dry-run`
Expected: tests PASS; the dry run lists the assets from `dist/site` with no config error.

- [ ] **Step 5: Commit**

```bash
git add wrangler.toml test/worker/wrangler-config.test.ts
git commit -m "feat(worker): serve the static site and drop the publish cron trigger"
```

---

### Task 10: GitHub Actions workflow and docs

**Files:**
- Create: `.github/workflows/deploy.yml`, `test/site/workflow.test.ts`
- Modify: `docs/env.md`

**Interfaces:** workflow `Deploy site`: `on: workflow_dispatch`; `concurrency: { group: deploy, cancel-in-progress: false }`; steps `actions/checkout@v4`, `pnpm/action-setup@v4` (version from `packageManager`), `actions/setup-node@v4` (`node-version: 22`, `cache: pnpm`), `pnpm install --frozen-lockfile`, `pnpm run ship --site-only`; step `env` from `secrets.CLOUDFLARE_API_TOKEN`, `secrets.CLOUDFLARE_ACCOUNT_ID`, `secrets.D1_ACCOUNT_ID`, `secrets.D1_API_TOKEN`, `secrets.D1_DATABASE_ID`, `secrets.SITE_URL`, `secrets.TELEGRAM_CHANNEL_URL`.

- [ ] **Step 1: Write the failing test** `test/site/workflow.test.ts` (string/regex assertions on the file text, no YAML dependency)
- `it("is manual only")`: contains `workflow_dispatch`, and not `schedule:`, `push:` or `pull_request:`.
- `it("never cancels a running deploy")`: contains `group: deploy` and `cancel-in-progress: false`.
- `it("runs the site-only ship")`: contains `pnpm run ship --site-only`; does not contain `PUBLISH_NOW_SECRET` or `WORKER_BASE_URL`.
- `it("passes the build and deploy credentials")`: contains each secret name listed above.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run test/site/workflow.test.ts`
Expected: FAIL (file missing).

- [ ] **Step 3: Implement** the workflow and extend `docs/env.md` with: `SITE_URL=https://imperdibles.com.ar`, `TELEGRAM_CHANNEL_URL`, `SITE_FIXTURE_DB` (tests only), how `pnpm run ship` and `--site-only` behave, the CI secret list, and the rollout steps from the spec (attach domain, run ship from the Mac, add secrets and run the workflow once, Search Console sitemap).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test && pnpm typecheck`
Expected: PASS (full suite).

- [ ] **Step 5: Commit**

```bash
git add .github docs/env.md test/site/workflow.test.ts
git commit -m "ci: add the manual site-only deploy workflow and document the env"
```

---

## Self-Review

- **Spec coverage:** hosting/assets (T9), Worker trimmed (T8), publish loop/`--site-only`/idempotency (T7), CI (T10), layout `site/` with `srcDir`/`outDir` (T1), data module (T3), astro-seo + JSON-LD (T4, T5), routes/URLs/slugs (T2, T6), page content home/day/month (T3, T5, T6), SEO metadata and sitemap/robots (T4, T6), tests list (T1-T10), rollout (T9, T10 docs). Not covered by design: the `pages` drop migration (spec: follow-up), per-product pages (non-goal).
- **Type consistency:** `Deal`, `SiteData`, `DayPage`, `MonthPage` are defined in Task 3 and used unchanged in Tasks 4-6; `readSiteEnv`/`openSiteDb` from Task 1 are used by `site-data.ts`, `robots.txt.ts`, `astro.config.ts`; `ShipDeps` field names match the test list.
- **Deviations from the spec, deliberate:** one `loadSiteData` query plus pure functions instead of three query functions (one D1 HTTP round trip per build instead of one per page); a single `[slug].astro` for both day and month; `html_handling = "force-trailing-slash"` added explicitly; `TELEGRAM_CHANNEL_URL` becomes a build-time variable (the spec omits it though the page needs the channel link); `SITE_FIXTURE_DB` is the answer to "how the build obtains the test DB".
