# Astro static site, SEO history and on-demand deploy — design

Date: 2026-11-12
Status: draft, pending owner approval
Supersedes: `2026-11-12-seo-history-pages-design.md` (Worker-rendered pages). The page set, URLs and SEO content carry over; how pages are produced and shipped changes.

## Intent

The site must be found on Google through an indexable history of published deals ("mejores ofertas de octubre", "ofertas del jueves"), with proper SEO metadata. Rendering pages inside the Worker fights the free plan's 10 ms CPU cap (guarded by `test/worker/cpu-budget.test.ts`) and needs the `pages` table. The owner decided to move the website to a static Astro build and to replace the timed publish cron with a single **deploy** command that the owner runs whenever they want, from their Mac or from GitHub Actions.

Success: running the deploy command (`pnpm run ship`) posts whatever is validated to Telegram, rebuilds the whole site from D1, and ships it; every day and month with published deals has a crawlable page listed in `sitemap.xml`.

## Goals

- Astro static site (home, day pages, month pages, sitemap, robots) built from D1 data, with `astro-seo` for head metadata.
- One idempotent `deploy` command: publish validated candidates to Telegram, build the site, upload it.
- Same data path locally and in CI: the build reads D1 over HTTP (`createD1HttpClient`), so `astro dev` shows real data.
- Remove the 11:00 publish cron, the `pages` table, `page-store.ts` and `src/output/page/render.ts`.

## Non-goals

- Per-product pages (deferred; nothing here should block them).
- Rewriting the Telegram publish logic: it stays in the Worker, already tested.
- Editorial content, search, client-side JavaScript frameworks.
- Scheduling deploys automatically (the owner triggers them; a schedule can be added later).

## Anti-goals (failure even if it works)

- A repeated or concurrent deploy posting the same deal twice to Telegram.
- Publishing a deal whose price validation is stale.
- Indexable empty pages (days or months with no published deals).
- Structured data claiming a current price for a deal that ended.
- A failed site build or upload undoing or blocking what was already posted to Telegram.

## Current state (facts from the code)

- `publishValidated` (`src/worker/publish.ts`) posts today's (ART) validated candidates with an affiliate link and a Telegram file id, at most 5 per call (`PUBLISH_CAP_PER_CALL`), one per model per day, skipping candidates validated more than 30 min ago (`WINDOW_MS`). It **claims** each candidate with a conditional `UPDATE ... SET status='published' WHERE status='validated'` before sending, so concurrent calls cannot double-post. It is reachable via the cron `0 14 * * *` and via `POST /internal/publish-now` (Bearer `PUBLISH_NOW_SECRET`).
- After a publish, `afterPublish` → `regeneratePages` renders the home into D1 table `pages`; `/` serves it. That whole path goes away.
- Cron `30 10 * * *` runs `checkMissingRun` (alerts the owner if the local run did not happen). It stays.
- Local jobs run via launchd (`ops/launchd/ar.imperdibles.correr.plist`, `ar.imperdibles.revalidar.plist`).
- A day's published deals are reconstructable from D1 (`candidates JOIN runs` on `run_date`, `status='published'`, `affiliate_link IS NOT NULL`); title, photo, prices and discount live in `candidates.payload` JSON. `run_date` is the publication day because publish only takes today's `run_date`.
- The Worker answers on `imperdibles.lopezlean.workers.dev`; the custom domain `imperdibles.com.ar` is not attached yet.
- At the time of writing there are uncommitted edits in `src/output/page/render.ts`, `copy.ts`, `format.ts`, `package.json`, render tests and a new `src/output/page/styles.ts` not made in this design session. The builder must find out whether they are committed or abandoned before deleting `render.ts`, and port any visual change into the Astro components.

## Decisions

### Hosting: one Worker with static assets

- The Astro output is served by the **same Worker** through Workers static assets (`[assets] directory = "dist/site"` in `wrangler.toml`). Static asset requests do not run Worker code, so they cost no CPU. *My call:* one deploy unit, one domain, no separate Pages project.
- The Worker keeps only: `/telegram/webhook`, `/internal/publish-now`, `/healthz`, and the `30 10 * * *` missing-run cron. Its `/` route, `page-store.ts` and `afterPublish` page regeneration are removed; a migration drops the `pages` table. *My call:* that migration ships in a follow-up change and is applied by hand (`pnpm db:migrate:remote`) only after the new Worker is live, so the old `/` never breaks mid-rollout.
- Asset routing must let the Worker handle those paths (e.g. `run_worker_first` for `/telegram/*`, `/internal/*`, `/healthz`); everything else is static. A path with no asset returns Astro's 404 page.

### The deploy command

`pnpm run ship` runs `scripts/ship.ts` (*my call:* `pnpm deploy` is a built-in pnpm command and would shadow a script of that name) (Node, `tsx`), in this order:

1. **Publish:** call `POST $WORKER_BASE_URL/internal/publish-now` repeatedly until a call publishes nothing (each call caps at 5; a call with only failures counts as nothing, so a broken file id is retried once per deploy, not ten times), with a hard stop of 10 calls. Print each report. A publish failure is reported but does not stop the site deploy.
2. **Build:** `astro build`. Data comes from D1 over HTTP using the existing `D1_*` credentials.
3. **Upload:** `wrangler deploy` (Worker code + static assets together).

- The script exits non-zero if build or upload fails, and says clearly that Telegram posts already went out.
- Idempotency comes from the existing claim in `publishValidated` plus a static build that is a pure function of D1 state. Running deploy twice in a row posts nothing new and produces the same site.
- The `0 14 * * *` publish cron is removed from `wrangler.toml` and `src/worker/index.ts`. The `publish_time` config entry and the cron-sync comment are updated accordingly.
- **Freshness:** the 30-minute window stays. Candidates validated too long ago are reported as `stale` and not posted; the owner re-runs the revalidation job before deploying if they want them out. *My call:* deploy does not trigger revalidation.

### GitHub Actions

- Workflow `.github/workflows/deploy.yml`, trigger `workflow_dispatch` only, `concurrency: { group: deploy, cancel-in-progress: false }`.
- **The local revalidation job runs ship** (owner's decision): `after-revalidation.ts` used to call `publish-now` when the publication hour had passed and something was pending; it now runs the full `ship` instead, so Telegram and the site never drift apart.
- **CI deploys the website only** (owner's decision): revalidation is a local launchd job, so CI would rarely find fresh candidates. The workflow runs `pnpm run ship --site-only`, which skips step 1 (publish) and does build + upload. Telegram publishing happens only from the Mac, chained after revalidation. `WORKER_BASE_URL` and `PUBLISH_NOW_SECRET` are therefore not CI secrets.
- Runs `pnpm install` and `pnpm run ship --site-only` with repository secrets: `CLOUDFLARE_API_TOKEN` (*my call:* a dedicated token scoped to Workers deploy + D1 for this account, not the personal one), `CLOUDFLARE_ACCOUNT_ID`, the `D1_*` credentials, `SITE_URL`.
- The Mac runs the same `pnpm run ship` with `.env`. Concurrent Mac + CI runs are safe for Telegram (the claim) and last-write-wins for the site, which is acceptable because both build from the same D1.

### Astro project layout

- Astro at the repo root with `srcDir: "./site"` and `outDir: "./dist/site"`, `output: "static"`, `site: SITE_URL`. *My call:* keeps `src/` for the Worker and the data pipeline, and lets site code import shared modules (`src/output/format.ts`, `copy.ts`, design tokens, `category-art.ts`, `photo-url.ts`).
- Build-time data access lives in one module (e.g. `site/lib/deals.ts`) with three functions: deals for a day, deals for a month, and the list of days and months that have deals. All other components receive plain data.
- `astro-seo` renders title, description, canonical, Open Graph and Twitter tags in a shared layout. JSON-LD is a separate `<script type="application/ld+json">` in the layout (astro-seo does not cover it).
- Fonts and styles reuse the current design (`design-tokens.ts`, `@fontsource`). Visual parity with the current home is required.
- `SITE_URL` is required at build time; the build fails if it is missing.

### Routes and URLs (Spanish, human-readable)

| Page | Path | Example |
|---|---|---|
| Home (latest day) | `/` | |
| Day | `/ofertas/<d>-de-<mes>-de-<yyyy>/` | `/ofertas/12-de-noviembre-de-2026/` |
| Month | `/ofertas/<mes>-de-<yyyy>/` | `/ofertas/noviembre-de-2026/` |
| Sitemap | `/sitemap-index.xml` (via `@astrojs/sitemap`) | |
| Robots | `/robots.txt` | |

- Month names lowercase, day without leading zero. The weekday goes in titles and H1, not the URL.
- Trailing-slash style follows Astro's static directory output (`trailingSlash: "always"`). *My call:* avoids redirects on a static host.
- Only days and months with published deals are generated (`getStaticPaths`); anything else falls to the 404 page.
- Slug ⇄ date conversion lives in one pure module with round-trip tests.

### Page content

- Day and month pages show all categories in one list; titles and descriptions are category-neutral.
- **Home:** the latest day with published deals. Because the page is static and may be served days later, the heading always names the date ("Los imperdibles del jueves 12 de noviembre") instead of "de hoy". *My call.* Adds a "Historial" nav to the previous day with deals and the current month.
- **Day page:** that day's cards (same per-model dedupe and order as `pickItems` in `src/worker/page-store.ts`: best discount, then title). Links to previous and next day with deals and to its month.
- **Month page:** each model once, keeping its best `difference_pct` (tie: most recent `run_date`), showing that entry's date and prices, sorted by discount desc then title. Then a list of the month's days with deals, and links to previous and next month with deals.
- Past cards keep the affiliate CTA; prices are labelled with their date (existing `PRICES_NOTE`).

### SEO metadata

- Titles:
  - Day: `Mejores ofertas del jueves 12 de noviembre de 2026 en Mercado Libre | imperdibles`
  - Month: `Mejores ofertas de noviembre 2026 en Mercado Libre | imperdibles`
  - Home: `Ofertas en Mercado Libre hasta X% más baratas que en otras tiendas | imperdibles`
- Description generated from the data (count, top discount, 2–3 product names), under ~155 characters.
- `og:image`: photo of the top-discount deal when it is an mlstatic URL, otherwise omitted.
- Canonical: absolute `SITE_URL` + path; every page self-canonicalises.
- JSON-LD: `BreadcrumbList` (Inicio › Mes › Día) on all pages; `ItemList` of `ListItem` (name, url, image) on every page including home. No `Product`/`Offer`: a static page cannot guarantee current prices, and `Product` without offers raises Search Console warnings. *My call*, replacing the earlier "Offer on home" idea.
- Sitemap: `@astrojs/sitemap` with `lastmod` per page = latest `posts.published_at` of its deals, falling back to `run_date` when there is no post row.
- `robots.txt`: allow all, `Sitemap: <SITE_URL>/sitemap-index.xml`. The Worker's private paths are not linked anywhere and need no disallow, but add `Disallow: /internal/` and `/telegram/` anyway.
- The `workers.dev` host: set `workers_dev = false` once the custom domain is attached so the site is served only on `imperdibles.com.ar`. Canonicals cover the gap before that.

## Testing

Strict TDD (vitest):

- slug ⇄ date round trip, invalid dates.
- `site/lib/deals.ts` against a seeded test DB: day/month queries, per-model dedupe and tie-break, empty results, days/months listing.
- title/description/JSON-LD builders as pure functions (no `Offer`, description length).
- `scripts/ship.ts` with injected fetch/exec: publish loop stops on an empty report and at 10 calls; `--site-only` makes no publish call; a publish error still builds; a build failure exits non-zero.
- Worker: removed routes now fall through, remaining routes unchanged, the CPU budget test still passes, the publish cron is gone.
- One `astro build` smoke test against fixture data that checks the generated files exist (home, one day, one month, sitemap, robots) and that the home `<head>` has canonical and description.

## Rollout

1. Owner: attach `imperdibles.com.ar` to the current Worker in Cloudflare first, so canonicals never point at a dead host. *My call*, reordered from the first draft.
2. Merge with `SITE_URL=https://imperdibles.com.ar` and `workers_dev = false`, then run `pnpm run ship` from the Mac.
3. Owner: add repository secrets and run the workflow once from GitHub to confirm CI works.
4. Owner: add the property in Google Search Console and submit the sitemap.

## Left to the builder

- Component breakdown and file names under `site/`.
- How the build obtains the test DB for the smoke test.
- Exact copy polish within the shapes above.
