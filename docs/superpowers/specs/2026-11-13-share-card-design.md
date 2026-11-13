# Share card and share button — design

## Intent
Make every product page easy to share (WhatsApp first) so the link unfolds into a card showing the price, with the text below. Goal: more people reach the Mercado Libre affiliate click.

## Goals
- Each product page has an `og:image` that is the same card we already send to Telegram (photo, ML price, discount), 1200x675 PNG.
- A "Compartir" control on the product page.

## Non-goals / anti-goals
- No share counts, no social SDKs, no tracking beyond the existing PostHog setup.
- Never share the `meli.la` link: the shared URL is our product page (so the card unfolds and the buy button is one tap away).
- A photo failure must never break the build or the card (same behavior as Telegram).

## Approaches considered
- **A (chosen): build-time PNG per product.** `renderCardPng` runs in the Astro build (Node) and is served as a static asset. A disk cache keyed by candidate id + price keeps `ship` fast as products grow.
- B: render in the Worker. Rejected: satori/resvg are Node-only.
- C: render at publish time and store in R2. Rejected: more infrastructure, no benefit over A.

## Design
- Static endpoint `site/pages/og/[slug].png.ts`: one PNG per product slug, built from `product.latest.candidate` via `renderCardPng`. Cache in `.cache/og/<candidate_id>-<price>.png` (git-ignored).
- `Base.astro` receives the absolute card URL as `ogImage` for product pages (replacing the raw ML photo there); twitter card stays `summary_large_image`.
- Share control (progressive enhancement, tiny inline script): `navigator.share({title, text, url})` when available (mobile sheet incl. WhatsApp); otherwise a `https://wa.me/?text=<text + url>` link and a "Copiar link" button. Text: title, ML price, discount. Spanish copy lives in `src/output/copy.ts`.
- Tests: build test asserts `og/<slug>.png` exists with the PNG signature, `og:image` points to it, and the share control renders the product URL (not the affiliate link).

## Left to the builder
Exact share text wording, button styling consistent with `DealCard`, cache invalidation details, whether photo fetch uses the shared `fetchCardPhoto` timeout.
