# Share card and share button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each product page unfolds into a price card when shared (WhatsApp first) and has a "Compartir" control.

**Architecture:** A static Astro endpoint renders the existing Telegram card (`renderCardPng`) per product at build time, with a disk cache. `og:image` of product pages points to it. A small share component uses `navigator.share` with a `wa.me` + copy-link fallback.

**Tech Stack:** Astro 5 static, satori + resvg (Node, build only), Vitest with the real-build helper `buildSite`.

**Spec:** `docs/superpowers/specs/2026-11-13-share-card-design.md`

## Global Constraints

- Shared URL is the product page URL, never the `meli.la` affiliate link.
- A failed photo fetch never fails the build or the card (`renderCardPng` already degrades).
- satori/resvg/node:fs stay out of the Worker import closure: only `site/` build code imports them.
- Spanish UI copy lives in `src/output/copy.ts`; code and comments in English.
- Build tests need the `240_000` `beforeAll` timeout.

## Review Focus

- Product with no photo (`image_url: null`): card still renders, PNG valid.
- Price change on the same candidate id: cache key includes the price, so the card is not stale.
- Title with `<`, quotes, `&` or emoji: share text is URL-encoded in the `wa.me` link; page HTML stays escaped.
- Two products with colliding slugs: each gets its own `/og/<slug>.png`.
- No `navigator.share` (desktop): fallback links render and work without JS-only paths.

---

### Task 1: Card PNG with disk cache

**Files:**
- Create: `site/lib/share-card.ts`
- Test: `test/site/share-card.test.ts`
- Modify: `.gitignore` (add `.cache/`)

**Interfaces:**
- Consumes: `renderCardPng(c: Candidate, opts: { run_date: string; category?: string | null; fetch?: FetchLike }): Promise<Uint8Array>` from `src/output/card/render.js`; `Product` from `site/lib/products.js`.
- Produces: `cardCachePath(dir: string, candidateId: string, priceArs: number): string` and `productCardPng(p: Product, opts?: { cacheDir?: string; fetch?: FetchLike }): Promise<Uint8Array>` (default cacheDir `.cache/og`).

- [ ] **Step 1: Write failing tests** in `test/site/share-card.test.ts` using a temp dir and a `fetch` stub returning a 404: (a) `productCardPng` returns bytes starting with the PNG signature `89 50 4E 47`; (b) a second call reads the cache (assert the file exists at `cardCachePath(...)` and `fetch` stub is called once across both calls); (c) a product with the same candidate id but a different `ml.price_ars` writes a different cache file; (d) a product with `image_url: null` still yields a PNG. Build products with `buildProducts` over a seeded in-memory D1 as `test/site/products.test.ts` does.
- [ ] **Step 2: Run** `pnpm vitest run test/site/share-card.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `cardCachePath` (`<dir>/<candidateId>-<price>.png`, id sanitized to `[a-z0-9-]`) and `productCardPng` (read cache if present; else `renderCardPng(p.latest.candidate, { run_date: p.latest.run_date, category: p.latest.category, fetch })`, `mkdir -p`, write, return). Add `.cache/` to `.gitignore`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(site): render and cache the share card per product`.

### Task 2: Static endpoint and og:image wiring

**Files:**
- Create: `site/pages/og/[slug].png.ts`
- Modify: `site/lib/slugs.ts` (add `ogPath(slug: string): string` → `/og/<slug>.png`), `site/lib/seo.ts` (add `ogCardUrl(siteUrl: string, slug: string): string` using `absoluteUrl`), `site/pages/producto/[slug].astro` (pass `ogImage={ogCardUrl(siteUrl, product.slug)}`)
- Test: `test/site/slugs.test.ts`, `test/site/seo.test.ts`, `test/site/product-build.test.ts`

**Interfaces:**
- Consumes: `productCardPng` (Task 1), `buildProducts(d)`, `getSiteData()`.
- Produces: file `og/<slug>.png` in the build output; product pages with `og:image` = absolute card URL.

- [ ] **Step 1: Write failing tests**: `ogPath("hp-i3") === "/og/hp-i3.png"`; `ogCardUrl("https://imperdibles.com.ar", "hp-i3") === "https://imperdibles.com.ar/og/hp-i3.png"`; in `product-build.test.ts`: `site.exists("og/hp-i3.png")` is true, its first 4 bytes are the PNG signature (extend `BuiltSite` with a binary read only if `read` is text-only), and the product HTML contains `property="og:image" content="https://imperdibles.com.ar/og/hp-i3.png"`.
- [ ] **Step 2: Run** the three test files. Expected: FAIL.
- [ ] **Step 3: Implement** `ogPath`, `ogCardUrl`, the endpoint (`getStaticPaths` from `buildProducts`; `GET` returns `new Response(png, { headers: { "Content-Type": "image/png" } })`), and the `ogImage` prop. In build tests use a temp `cacheDir` via env `SITE_OG_CACHE` read by `share-card.ts` default, so tests never write into the repo.
- [ ] **Step 4: Run** the three files. Expected: PASS.
- [ ] **Step 5: Commit** `feat(site): serve a share card per product as og:image`.

### Task 3: Share control

**Files:**
- Create: `site/lib/share.ts`, `site/components/ShareButtons.astro`
- Modify: `src/output/copy.ts` (add `SHARE_LABEL = "Compartir"`, `COPY_LINK_LABEL = "Copiar link"`, `LINK_COPIED = "Link copiado"`, `shareText(title: string, priceArs: number, pct: string): string`), `site/pages/producto/[slug].astro`
- Test: `test/site/share.test.ts`, `test/site/product-build.test.ts`

**Interfaces:**
- Consumes: `formatArs`, `formatPct` from `src/output/format.js`; `absoluteUrl`, `productPath`.
- Produces: `whatsappUrl(text: string, url: string): string` returning `https://wa.me/?text=` + `encodeURIComponent(`${text} ${url}`)`; `<ShareButtons title text url />` rendering a `<button data-share>` plus `<a href={whatsappUrl}>` and `<button data-copy-link>`, with a tiny `is:inline` script that, when `navigator.share` exists, uses it on `[data-share]` click (and hides the wa.me link), else leaves the fallbacks; copy button uses `navigator.clipboard.writeText(url)` then swaps its label to `LINK_COPIED` for 2s.

- [ ] **Step 1: Write failing tests**: `whatsappUrl("Robot & Co", "https://x.test/p/")` encodes `&` and the URL; `shareText` includes title, `$` price and the percentage; product build HTML contains the product URL inside the wa.me href, contains `Compartir`, and does NOT contain the affiliate `meli.la` inside any wa.me href.
- [ ] **Step 2: Run** `pnpm vitest run test/site/share.test.ts test/site/product-build.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `whatsappUrl`, `shareText`, the component and place it under the card on the product page, before the reviews link.
- [ ] **Step 4: Run** the same files, then the full suite `pnpm vitest run`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat(site): share control on product pages`.

### Task 4: Docs and deploy check

**Files:**
- Modify: `docs/daily-flow.md` (Site pages: mention `/og/<slug>.png` cards and the `.cache/og` cache, safe to delete)

- [ ] **Step 1: Edit the doc**, then run `pnpm run ship --site-only` only after the owner confirms.
- [ ] **Step 2: Commit** `docs: describe the share cards`.
