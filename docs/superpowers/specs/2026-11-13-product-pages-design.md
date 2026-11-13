# Product and category pages

Date: 2026-11-13. Status: draft for owner approval.

## Intent and why

Visitors arrive from Google and the owner wants each of them to click through to Mercado Libre through an
affiliate link (the sale is the goal). Today only the latest day is reachable on the site (`/`). Older deals
live inside day pages (`/ofertas/<day>/`) and month pages, and a product has no URL of its own. Everything
published before today is effectively invisible to search except as a line inside a day page.

Goal: give every product that was ever an imperdible a durable, indexable page whose main job is the click
to Mercado Libre, and give every category an index page that ranks for "mejores <category>" queries and
feeds those product pages.

## Goals

- One page per model, `/producto/<slug>/`, built from every published deal of that `model_id`.
- One page per category, `/categoria/<id>/`, listing its products, newest first.
- The Mercado Libre button is the primary, above-the-fold action on every product page.
- Every product and category page is in the sitemap, with `lastmod`, and links to related pages.
- Prices are always shown with the date they were observed.

## Non-goals

- Live prices. Pages are static and rebuilt by `pnpm run ship`; no client-side price fetching.
- Search box, filters, user accounts, comments, price alerts.
- Notifying Google on each `ship`. The sitemap ping endpoint is deprecated and does nothing; Google relies
  on accurate `lastmod`, which the sitemap already provides. Owner decision: no Search Console API
  resubmission for now. One-time checks outside the code: `robots.txt` points at the sitemap, and the sitemap
  is registered in Search Console.
- A page for deals that were never published (status other than `published`).
- Redesigning the existing home, day or month pages beyond adding links to the new pages.

## Anti-goals (failures even if it "works")

- A page that shows an old price as if it were current. The date must be next to every price.
- Two URLs competing for the same product (the reason a per-deal page was rejected).
- Thin category pages: a category with no published deal gets no page.

## Constraints

- Static Astro site (`output: "static"`, `trailingSlash: "always"`, directory format), data from D1 through
  `site/lib/site-data.ts`. No new runtime.
- Affiliate rules already in force: links are `https://meli.la/...` supplied by the owner per candidate;
  `rel="sponsored noopener"`; no built links. Catalog photos are allowed (owner ruling).
- Data available per deal (`src/contract/candidate-list.ts`): `model_id`, `brand`, `title`, `image_url`,
  the ML offer, the other stores' offers sorted by price, `difference_ars`, `difference_pct`, plus
  `run_date`, `category` and `affiliate_link` on the stored deal. Price history per model is derivable
  from the deals; there is no other price source.
- Copy is Spanish (Argentina), per existing `src/output/copy.ts`; code and comments in English.

## Approaches considered

1. **Page per model** (chosen). One URL per `model_id`; consolidates every appearance of the product,
   stable link, best match for "precio <modelo>" searches. Cost: price can be old, so the page must state the
   observation date.
2. **Page per deal (day + model).** Simplest, since each existing card gets a URL, but the same product
   repeated across days competes with itself in search and links freeze on a price that no longer exists.
   Rejected.
3. **Category hubs only.** Captures category queries but gives no product to land on. Chosen as a second
   piece, built on top of 1.

The owner picked 1 then 3.

## Design

### Product page `/producto/<slug>/`

- `slug`: lowercase, ASCII, from brand and model code (`HP:15FD0333LA` becomes `hp-15fd0333la`). It is derived
  from `model_id` only, so it never changes between builds. Collisions after slugging are resolved by
  appending a short suffix of the `model_id` and must be covered by a test.
- Content, in order: product photo or the category art fallback already used by `DealCard`; title and brand;
  the most recent deal's price block (ML price, rivals, percentage and amount cheaper) with
  "precio al <date>"; the primary button `Ver en Mercado Libre` using the most recent deal's
  `affiliate_link`; a "Cuándo fue imperdible" list with one row per appearance (date, ML price, percentage,
  link to that day page); a related block with other products of the same category.
- Staleness: if the most recent observation is older than 7 days, show a visible line "Este precio es del
  <date>; puede haber cambiado" above the button. The button stays. The 7-day threshold is a build-time
  constant.
- SEO: `<title>` and meta description built from product, percentage and date; breadcrumb
  (Inicio / Categoría / Producto) as JSON-LD; `Product` JSON-LD with brand, image and an `Offer` whose price
  and `priceValidUntil` match what the page prints (no `priceValidUntil` when the price is stale).
- Product photo goes into the sitemap image list like the existing pages.

### Category page `/categoria/<id>/`

- Lists the category's products, one compact card per product (photo, title, latest ML price with date,
  percentage, link to the product page and the Mercado Libre button), newest first.
- Only categories with at least one published deal get a page (`SiteData.categories` already works that way).
- Breadcrumb JSON-LD and an `ItemList` of the products.

### Linking into the new pages

- `DealCard` title links to the product page; the Mercado Libre button stays as is.
- Header gets a "Categorías" menu built from `SiteData.categories`; the footer lists them too.
- Day and month pages are unchanged otherwise.
- Sitemap: product and category paths with `lastmod` equal to the newest deal they contain.

### Data layer

- `site/lib/products.ts`: group `SiteData.deals` by `model_id` into a `Product` view (latest deal, history,
  category, slug). Pure functions, covered by unit tests with fixtures (same style as `deals.ts` tests).
- `site/lib/slugs.ts`: add `productSlug` and `categoryPath`/`productPath`.
- `site/lib/sitemap.ts`: extend `lastmodByPath` and `imagesByPath` to the new paths.

## Decided by the owner

- Google is the traffic source; the goal is a click to Mercado Libre.
- Approach: per-model product pages first, then category pages.

- `meli.la` affiliate links keep working long after they are created, as far as the owner knows. This is an
  unverified assumption: the design adds no link checker. A dead link or an unavailable listing is accepted
  for now and is revisited if clicks drop.

## My calls (owner can override)

- Slug scheme, collision rule and the 7-day staleness threshold.
- The button always points at the latest deal's affiliate link, even when the page is stale.
- `Product` JSON-LD with `Offer`; dropped to no `priceValidUntil` when stale.
- No page for categories or products with zero published deals.

- Staleness is measured from the build date against the latest observation date. A stale page (over 7 days)
  emits no `Offer` in its `Product` JSON-LD and keeps the visible "precio al <date>" line.
- A product belongs to one category: the one of its latest deal. It appears on that category page only.
- Category pages show the 48 newest products with no pagination; older ones stay reachable through their own
  product pages and the day pages.
- The product page is the canonical URL for itself. Day pages keep their own canonical and link to it.
- Category ids are ASCII kebab-case already. A product slug that comes out empty falls back to a hash of
  the `model_id`.

## Left to the builder

- Visual design of both pages within the existing design system (`site/components`, Figma redesign).
- Component split, CSS, exact copy strings (kept in `src/output/copy.ts`).
- How to keep `getSiteData()` from being queried once per page at build time.
- Test layout, following the existing `test/` conventions.
