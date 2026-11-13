# Daily flow

What to run each day, in order. All commands run from the repo root.

## 1. Collect candidates

```bash
bin/imperdibles correr                      # today's rotating category
bin/imperdibles correr --categoria <id>     # a specific category (several per day are fine)
bin/imperdibles correr --categoria <id> --forzar   # repeat a category that already ran today
```

- One run per category per day; `--forzar` overrides that.
- A run can end with `0 candidatos` (nothing 15% cheaper) or `(parcial)` (some stores failed). Just run another category.
- Category ids: `aspiradoras-robot`, `smart-tv`, `celulares`, `freidoras-de-aire`, `aires-acondicionados`, `lavarropas`, `heladeras`, `notebooks`, `auriculares`, `microondas`, `cafeteras`, `monitores`, `tablets`, `parlantes`, `smartwatches`.
- The CLI reads D1 over HTTP (remote), so it needs the `D1_*` variables from [env.md](env.md).

## 2. Pick candidates (Telegram, owner chat)

Each candidate arrives as a message in the owner chat. Reply to it with:

- a single `https://meli.la/...` affiliate link to **choose** it;
- `rechazar` to **discard** it (it is never proposed again).

Only candidates from today can be answered.

## 3. Revalidate prices

```bash
bin/imperdibles revalidar
```

Re-reads the price of every chosen candidate. Only candidates that are still `validated` get published.

## 4. Publish and deploy

```bash
pnpm run ship               # publish pending deals to the channel, build the site, deploy the Worker
pnpm run ship --site-only   # skip publishing; only rebuild and deploy the site
```

Exit codes: `0` ok, `1` build or upload failed, `2` site deployed but a publish call failed.

## Coupons

One fixed `meli.la` link is used on every coupon in the channel:

```bash
bin/imperdibles cupones-link https://meli.la/...
```

To drop a coupon, reply `rechazar` to its notice in the owner chat.

## Adding a category

Categories live in the D1 `config` table (key `categories`), not in code. Add a migration in `migrations/` that appends to the JSON array (see `0007_even_more_categories.sql`), then:

```bash
pnpm run db:migrate:remote
```

Keep existing entries first so the daily rotation order does not shift.

## Site pages

`pnpm run ship` rebuilds the whole static site, so besides the home, day and month pages it generates:

- `/producto/<slug>/`: one page per model ever published, with its latest price (dated), the Mercado Libre button and its history. Prices older than 7 days carry a staleness notice.
- `/categoria/<id>/`: the 48 newest products of each category.
- `/og/<slug>.png`: the share card (same design as the Telegram card) used as `og:image` of each product page. Cards are cached in `.cache/og/` by candidate and price; the folder is safe to delete.

All of them are in the sitemap with `lastmod`. Google no longer supports sitemap pings, so there is no notify step.
