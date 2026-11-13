# Product and Category Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every published model its own indexable page and every category an index page, both centered on the Mercado Libre affiliate click.

**Architecture:** A pure data layer (`site/lib/products.ts`) groups `SiteData.deals` by `model_id`; two new Astro static routes render products and categories; the existing sitemap `lastmod`/image maps are extended to the new paths. No new runtime or dependency.

**Tech Stack:** Astro 5 static, TypeScript, Vitest, D1 via `SqlClient` (tests use the in-memory seed helpers in `test/site/support`).

**Spec:** `docs/superpowers/specs/2026-11-13-product-pages-design.md`

## Global Constraints

- `output: "static"`, `trailingSlash: "always"`, directory format; all paths end in `/`.
- Affiliate links render with `rel="sponsored noopener"`; the button text is `CTA_ML` ("Ver en Mercado Libre").
- Copy is Spanish (Argentina) and lives in `src/output/copy.ts`; code and comments are English.
- Stale threshold: `STALE_DAYS = 7`, measured from the build date to the latest observation `run_date`.
- Category page cap: `CATEGORY_LIMIT = 48` newest products, no pagination.
- A product belongs to the category of its latest deal. Categories or products with zero published deals get no page.
- Stale pages emit no `Offer` in `Product` JSON-LD; fresh pages emit one whose price matches the printed price.
- No Google notification step in `ship`; no link checker.

## Review Focus

- Two `model_id`s that slug to the same string must get distinct, stable URLs.
- A `model_id` that slugs to an empty string must still get a valid URL (hash fallback).
- A model published on several days appears once, with its latest deal on top and every day in the history.
- A model whose latest deal is in a different category than an older one appears only on the latest category's page.
- A stale product (over 7 days) prints "precio al <date>" with the staleness notice and no `Offer` in JSON-LD.
- A category with more than 48 products renders exactly 48, newest first.

---

### Task 1: Products data layer

**Files:**
- Create: `site/lib/products.ts`
- Modify: `site/lib/slugs.ts` (add `productSlug`, `productPath`, `categoryPath`)
- Test: `test/site/products.test.ts`, `test/site/slugs.test.ts`

**Interfaces:**
- Produces:
  - `productSlug(modelId: string): string` in `slugs.ts`: lowercase, every run of non `[a-z0-9]` becomes one `-`, trimmed of `-`; empty result becomes `p-<hash6>` where hash6 is the first 6 hex chars of SHA-1 of `modelId`.
  - `productPath(slug: string): string` returns `/producto/<slug>/`; `categoryPath(id: string): string` returns `/categoria/<id>/`.
  - In `products.ts`: `export type Product = { slug: string; model_id: string; category: string; latest: Deal; history: Deal[]; lastmod: string }` where `history` has one `Deal` per `run_date`, newest first, and `lastmod` is the newest `published_at` among the model's deals (falling back to `latest.run_date`).
  - `export const STALE_DAYS = 7; export const CATEGORY_LIMIT = 48;`
  - `buildProducts(d: SiteData): Product[]` sorted by `latest.run_date` descending, then title (`localeCompare` "es"). Slug collisions get `-<hash6>` appended to the second and later products (ordered by `model_id`), so slugs are unique and stable.
  - `categoryProducts(products: Product[], categoryId: string): Product[]` filters by `category`, keeps the order, slices to `CATEGORY_LIMIT`.
  - `isStale(latestRunDate: string, today: string): boolean` is true when the difference in whole days is greater than `STALE_DAYS`.
- Consumes: `Deal`, `SiteData` from `site/lib/deals.ts`.

- [ ] **Step 1: Write failing tests**

In `test/site/slugs.test.ts`: `productSlug("HP:15FD0333LA") === "hp-15fd0333la"`; `productSlug("::") ` matches `/^p-[0-9a-f]{6}$/` and is stable across calls; `productPath("x") === "/producto/x/"`; `categoryPath("smart-tv") === "/categoria/smart-tv/"`.
In `test/site/products.test.ts` (build `SiteData` objects by hand with minimal `Deal`s): one test per Review Focus line above that concerns the data layer (collision, empty slug, multi-day model, category follows latest deal, 49 products in one category yields 48, `isStale("2026-11-05","2026-11-13") === true` and `isStale("2026-11-06","2026-11-13") === false`).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run test/site/slugs.test.ts test/site/products.test.ts`
Expected: FAIL (functions not defined).

- [ ] **Step 3: Implement** the signatures above in `slugs.ts` and `products.ts`. Use `node:crypto` `createHash("sha1")` for the hash.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run test/site/slugs.test.ts test/site/products.test.ts && pnpm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add site/lib/products.ts site/lib/slugs.ts test/site/products.test.ts test/site/slugs.test.ts
git commit -m "feat(site): group published deals into products"
```

### Task 2: SEO helpers for products and categories

**Files:**
- Modify: `site/lib/seo.ts`, `src/output/copy.ts`
- Test: `test/site/seo.test.ts`

**Interfaces:**
- Consumes: `Product` and `isStale` from `site/lib/products.ts`; `formatArs`, `formatDateLong` from `src/output/format.ts`.
- Produces in `seo.ts`:
  - `productTitle(p: Product): string` and `productDescription(p: Product): string`: product name, ML price, percentage and date.
  - `productLd(p: Product, siteUrl: string, stale: boolean): object`: schema.org `Product` with `name`, `brand`, `image` (when `image_url` exists, via `catalogPhotoUrl`), `url`; includes `offers` (`Offer`, `priceCurrency: "ARS"`, `price`, `url` of the page) only when `stale` is false.
  - `categoryTitle(name: string): string`, `categoryDescription(name: string, count: number): string`, `categoryItemListLd(products: Product[], siteUrl: string): object` (an `ItemList` pointing at product page URLs).
- Produces in `copy.ts`: `STALE_NOTICE = (fecha: string): string` returning `Este precio es del ${fecha}; puede haber cambiado.`, `PRICE_AS_OF = (fecha: string): string` returning `precio al ${fecha}`, `HISTORY_HEADING = "Cuándo fue imperdible"`, `RELATED_HEADING = "Otros imperdibles de la categoría"`, `CATEGORIES_LABEL = "Categorías"`.

- [ ] **Step 1: Write failing tests** in `test/site/seo.test.ts`: fresh `productLd` has `offers.price` equal to the ML price and `offers.priceCurrency === "ARS"`; stale `productLd` has no `offers` key; `categoryItemListLd` item URLs are absolute product URLs in list order; `productTitle` contains the product title and the percentage.
- [ ] **Step 2: Run to verify failure:** `pnpm exec vitest run test/site/seo.test.ts` → FAIL.
- [ ] **Step 3: Implement** the helpers and copy constants with the signatures above.
- [ ] **Step 4: Run to verify pass:** `pnpm exec vitest run test/site/seo.test.ts && pnpm run typecheck` → PASS.
- [ ] **Step 5: Commit**

```bash
git add site/lib/seo.ts src/output/copy.ts test/site/seo.test.ts
git commit -m "feat(site): SEO helpers for product and category pages"
```

### Task 3: Product page and card links

**Files:**
- Create: `site/pages/producto/[slug].astro`, `site/components/ProductPrices.astro` (price block shared by the page; reuse `DealCard`'s bar markup, do not duplicate its data logic)
- Modify: `site/components/DealCard.astro` (title becomes a link to `productPath(productSlug(deal.model_id))`; use the same slug function so links match built pages)
- Test: `test/site/product-build.test.ts` (uses `buildSite` and `seedDeal`)

**Interfaces:**
- Consumes: `buildProducts`, `isStale`, `STALE_DAYS` (Task 1); `productTitle`, `productDescription`, `productLd`, `breadcrumbLd` (Task 2); `Base` layout props as used by `site/pages/index.astro`.
- Produces: static route `/producto/<slug>/`, one per `buildProducts(d)` entry (`getStaticPaths` calls `getSiteData()` once). `DealCard` titles link to it.

Page order: photo or category art (same fallback as `DealCard`), title and brand, price block with `PRICE_AS_OF(date)` next to the ML price, the stale notice above the button when `isStale(latest.run_date, today)`, the `CTA_ML` button using `latest.affiliate_link`, history list (one row per `history` entry: date linking to its day page, ML price, percentage), related block (up to 6 other products of the same category, linking to their product pages). Breadcrumb JSON-LD: Inicio / category name linking to its `categoryPath` / product. `today` is `new Date().toISOString().slice(0, 10)` computed once in the page.

- [ ] **Step 1: Write failing tests** in `test/site/product-build.test.ts`: seed a model on two days (older day in another category) and one model older than 7 days; build the site and assert: `/producto/<slug>/index.html` exists for each; the button `href` equals the latest deal's `affiliate_link` with `rel="sponsored noopener"`; the history lists both dates; the fresh page's JSON-LD contains an `Offer`; the stale page contains `STALE_NOTICE` text and no `"offers"`; a day page's card title links to the product URL.
- [ ] **Step 2: Run to verify failure:** `pnpm exec vitest run test/site/product-build.test.ts` → FAIL.
- [ ] **Step 3: Implement** the page, component and `DealCard` link as described.
- [ ] **Step 4: Run to verify pass:** `pnpm exec vitest run test/site && pnpm run typecheck` → PASS (existing site tests still green).
- [ ] **Step 5: Commit**

```bash
git add site test/site/product-build.test.ts
git commit -m "feat(site): add a page per product"
```

### Task 4: Category pages and navigation

**Files:**
- Create: `site/pages/categoria/[id].astro`
- Modify: `site/components/Header.astro`, `site/components/Footer.astro` (list `SiteData.categories` as links; the data arrives through a new optional prop `categories: { id: string; name: string }[]` passed from `Base`, which reads it from `getSiteData()` once per build)
- Modify: `site/layouts/Base.astro` (pass categories to Header and Footer)
- Test: `test/site/category-build.test.ts`

**Interfaces:**
- Consumes: `buildProducts`, `categoryProducts`, `CATEGORY_LIMIT` (Task 1); `categoryTitle`, `categoryDescription`, `categoryItemListLd`, `breadcrumbLd` (Task 2); `CATEGORIES_LABEL` (copy).
- Produces: static route `/categoria/<id>/` per category in `SiteData.categories`; "Categorías" links in header and footer on every page.

Each category page card: photo, title linking to the product page, latest ML price with `PRICE_AS_OF`, percentage badge, and the `CTA_ML` button.

- [ ] **Step 1: Write failing tests** in `test/site/category-build.test.ts`: two categories seeded, one with 49 distinct models: `/categoria/<id>/index.html` exists for both and has exactly 48 product cards for the large one, newest first; a category with no published deal has no page; a model whose newer deal moved category appears only on the newer category page; the home page header contains links to both category paths.
- [ ] **Step 2: Run to verify failure:** `pnpm exec vitest run test/site/category-build.test.ts` → FAIL.
- [ ] **Step 3: Implement** the page, `Base` plumbing and header/footer links.
- [ ] **Step 4: Run to verify pass:** `pnpm exec vitest run test/site && pnpm run typecheck` → PASS.
- [ ] **Step 5: Commit**

```bash
git add site test/site/category-build.test.ts
git commit -m "feat(site): add category pages and navigation"
```

### Task 5: Sitemap, docs and full verification

**Files:**
- Modify: `site/lib/sitemap.ts` (`lastmodByPath` and `imagesByPath` also cover product and category paths), `docs/daily-flow.md` (one short section: new page types and that `pnpm run ship` rebuilds them)
- Test: `test/site/sitemap.test.ts`, `test/site/sitemap-build.test.ts`

**Interfaces:**
- Consumes: `buildProducts`, `categoryProducts` (Task 1), `productPath`, `categoryPath`.
- Produces: sitemap entries for every product (`lastmod` = `Product.lastmod`, image = its photo when present) and every category (`lastmod` = newest `lastmod` among its listed products, images = their photos, capped by `MAX_IMAGES_PER_URL`).

- [ ] **Step 1: Write failing tests**: unit test that `lastmodByPath` contains `/producto/<slug>/` and `/categoria/<id>/` with the expected values; build test that the generated sitemap XML has both URLs, with `<lastmod>` and an `<image:loc>` for a product that has a photo and none for one without.
- [ ] **Step 2: Run to verify failure:** `pnpm exec vitest run test/site/sitemap.test.ts test/site/sitemap-build.test.ts` → FAIL.
- [ ] **Step 3: Implement** the extension and the docs section.
- [ ] **Step 4: Run the whole suite:** `pnpm test && pnpm run typecheck`. Expected: all PASS.
- [ ] **Step 5: Commit**

```bash
git add site/lib/sitemap.ts docs/daily-flow.md test/site
git commit -m "feat(site): list product and category pages in the sitemap"
```

## Self-Review Notes

- Spec coverage: product page (T3), category page (T4), linking from cards and navigation (T3, T4), sitemap (T5), staleness and JSON-LD rules (T2, T3), slug rules (T1), non-goals respected (no ship change). One-time checks of `robots.txt` and Search Console are owner actions outside the code.
- Names used across tasks: `Product`, `buildProducts`, `categoryProducts`, `isStale`, `STALE_DAYS`, `CATEGORY_LIMIT`, `productSlug`, `productPath`, `categoryPath`, `productLd`, `categoryItemListLd`, `STALE_NOTICE`, `PRICE_AS_OF`.
