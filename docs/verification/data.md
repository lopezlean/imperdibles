# Data side verification log

## V0 D1 REST query shape

- Date: 2026-11-10
- Checked: Cloudflare API reference for D1 "Query D1 Database" (developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/) and the D1 Worker API `batch()` docs, through the docs index. No live call.
- URL: `POST https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}/query`, header `Authorization: Bearer <token>`.
- Body: `{"sql": "<statement>", "params": [<bound values>]}`. The reference also lists a `batch` array of `{sql, params}` objects on the sibling `raw` endpoint.
- Response: `{"success": true|false, "errors": [{code, message}], "messages": [], "result": [{"success": true, "results": [rows], "meta": {"changes", "last_row_id", "rows_read", "rows_written", ...}}]}`. One `result` entry per statement.
- Atomic multi-statement over REST: not documented for this endpoint. The Worker binding's `batch()` is documented as transactional, the REST endpoint is not stated to be.
- Fallback applied (design decision regardless): every write that must be atomic is a single SQL statement; multi-row writes use `INSERT ... SELECT ... FROM json_each(?)` with one JSON parameter. `SqlClient` sends one statement per request and reads `result[0]` only.
- Fixtures: `fixtures/cloudflare/d1-query-ok.json` and `d1-query-error.json` are written from the documented shape, not recorded from a live call. The error body (`success: false`, `errors[0].message`) is the documented envelope; the exact error code is illustrative.

## V1 Previous/list price in catalog offers

- Status: DONE 2026-11-11.
- Check: `pnpm verify:ml "xiaomi s40c"` found 5 catalog products, all answering `/products/{id}/items` with 404 `No winners found` (no offers). `pnpm verify:ml "aspiradora robot"` used `MLA44716485` with 3 offers: `original_price` present, `regular_amount` and `base_price` absent.
- Fallback named by the spec: if none appears, the public legend says "precio actual" instead of "precio de lista".
- Ruling (owner, 2026-11-11): although `original_price` appears, the pipeline compares ML's selling `price` (possibly discounted) and never reads `original_price`, so calling it "precio de lista" would mislabel discounted offers. The label is "actual".
- Follow-up: some modelos have no catalog offers at all (S40C on 2026-11-11); `getOffers` now returns `[]` on that 404 so the model is skipped as having no offers instead of failing the run.
- PRICE_LABEL: actual

## V2 ML rate limits

- Status: DONE 2026-11-11. Headers containing `ratelimit` or `retry` are printed by `pnpm verify:ml "xiaomi s40c"`.
- Result: 2026-11-11, 13 calls across two `verify:ml` runs: no `ratelimit`/`retry` headers and no 429. `query_budget` stays at 150.
- If no headers appear, keep `query_budget` at 150. If any 429 appeared while recording, owner lowers it to 100: `pnpm wrangler d1 execute imperdibles --remote --command "UPDATE config SET value='100' WHERE name='query_budget'"`.

## V3 Refresh token single use

- Status: DONE 2026-11-11. `pnpm verify:ml --refresh` printed `refresh_token changed after refresh: yes`: ML rotates the refresh token on each use, so the stored one must always be replaced (it is, in one upsert). `pnpm verify:ml --refresh` prints only whether the stored `refresh_token` changed (stored atomically in one upsert either way). Do not run it concurrently with another command that refreshes.

## V4 Frávega seller

- Date: 2026-11-10
- Checked: one live listing, `https://www.fravega.com/l/?keyword=aspiradora%20robot` (HTTP 200, no session), recorded once and kept as `fixtures/fravega/listing-aspiradoras-robot.html`.
- Result: the listing has 15 `<article>` elements, each with a visible seller line inside the article: `<p>Vendido por <!-- -->NAME</p>` (some articles render `Vendido por Frávega` followed by a badge `<svg>` instead of the comment node). The recording shows Frávega itself (3 articles) and third parties (Bidcom, Electro World, Overhard, Electroluxar, TecnoB, Suono, Grupo Vitta). The embedded Next.js JSON also carries `"seller":{"id":"fravega..."}` per item, but the article text is enough.
- Other article fields seen: title in `[data-test-id="article-title"] span`, price block in `[data-test-id="product-price"]` (struck list price first, current price in the last `span`, then `Precio s/imp. nac.` with the price without taxes, which must not be used), product link `a[rel="bookmark"][href^="/p/"]`, brand only in the embedded JSON (`"brand":{"name":...}`).
- Fallback applied: none needed. Rule for Task 8: only articles whose seller text is exactly Frávega are kept; a missing or unreadable seller line is `unknown_seller`.
- Derived fixtures: `listing-third-party-derived.html` (first Frávega article changed to `Vendido por Overhard`; the embedded JSON was not edited) and `listing-broken-derived.html` (all `<article>` tags removed).

## V5 GTIN availability

- ML attributes: yes, partially (2026-11-11, `scripts/debug-match.ts` on live catalog products). Many products carry `GTIN`, sometimes as a comma-separated list or with leading zeros; others have none (e.g. MLA79828952). The matcher splits the list and drops leading zeros.
- Frávega HTML: yes, partially. The embedded Next.js JSON holds `"gtin":{"__typename":"EAN","number":"<13 digits>"}` for 10 of the 15 products in the recorded listing and `"gtin":null` for 5. It is not in the visible `<article>` markup, so using it means reading the embedded JSON, which Task 8 must decide.

## V6 Store terms

- Status: PENDING OWNER. Owner reviews Frávega's terms on automated reading. Fallback: exclude the store or reduce frequency (owner decides). Must be recorded before any scheduled job is installed (Task 14 Step 5).

## V7 Dubious pair of the 10/11 run

- Status: PENDING OWNER. Owner writes the two titles of the doubtful match from the 10/11 test (used in Task 9).

## V8 Reproduction of the 10/11 run

- Status: RECORDED 2026-11-11, kept local only (19 MB, mostly Frávega HTML): owner ruling, `fixtures/runs/` and its snapshot are in `.gitignore`, so the replay test skips on other machines. The text below predates the recording. The pipeline is tested against a replay composed from the real Frávega listing and synthetic `-derived` ML responses (fake ids); that proves behaviour, not the real counts.
- Owner runs: `pnpm fixtures:record run aspiradoras-robot`. It runs the collection with the configured budget under `createRecordingFetch` and then repeats the reads revalidation will make for each candidate (`getOffers` and the rival store searches), writing `fixtures/runs/<YYYY-MM-DD>-aspiradoras-robot/`. Then check `rg -il "bearer|access_token" fixtures/runs` prints nothing.
- Then, to record here: run `pnpm vitest run test/data/pipeline.test.ts` (the test "reproduces the recorded aspiradoras-robot run" stops being skipped and writes its snapshot under `test/data/__snapshots__/`; commit it), and note the models compared and the approved candidates next to the 4 of 9 from 10/11. Prices have moved since; the spec treats 4 of 9 as a value to confirm, not an assertion.
- Result: pending.
- Fallback: if the recording differs a lot from 4 of 9, the owner reviews the dudosa matches and their `motivo` in the run log before changing any rule.

## V9 D1 rows per run

- Status: DONE 2026-11-11 (rows measured; the same-day exit 2 check is still open).
- Owner runs: `pnpm imperdibles correr` once. Expected: exit 0, the stub hook line in stderr (or the shortlist on Telegram once output Task 6 is merged).
- Then check the run: `pnpm wrangler d1 execute imperdibles --remote --command "SELECT id, status, models_compared, queries_used FROM runs ORDER BY started_at DESC LIMIT 1"`.
- Then count the rows written by that run (`<id>` from the previous query): `pnpm wrangler d1 execute imperdibles --remote --command "SELECT (SELECT COUNT(*) FROM price_observations WHERE run_id = '<id>') AS observations, (SELECT COUNT(*) FROM candidates WHERE run_id = '<id>') AS candidates, (SELECT COUNT(*) FROM models) AS models, (SELECT COUNT(*) FROM matches) AS matches, (SELECT COUNT(*) FROM store_listings) AS listings"`. Rows written per run are about observations + candidates + 1 (runs) plus the upserts to store_listings, models and matches; record the totals and compare with 100.000.
- A second `pnpm imperdibles correr` the same day must print `Ya hay una corrida de hoy (<id>). Para repetirla: imperdibles correr --forzar` and exit 2 (also confirms `run_date` uses the ART date).
- Result (2026-11-11, run `2026-11-11-aspiradoras-robot-200859`, four stores, 6 models compared, 59 queries): 186 price observations, 5 candidates, 1 run row, plus upserts to 186 store listings, 10 models and 10 matches. About 400 rows written per run, under 1% of the 100.000 rows/day quota. The "already ran today" check (exit 2) is still unchecked.
- Fallback: if one run writes more than a fraction of 100.000 rows, reduce `presupuesto_consultas` or the categories read per day.

## V13 Listings without a model code

- Date: 2026-11-11. The run logs two `no_model_code` skips; both are Easy listings: "Aspiradora Robot 0.31 L Blanca RCV 1 Karcher" (the code is split by a space, "RCV 1") and "Aspiradora Robot 40.5 W 350 Ml Negra KL-ASPRB Klauben" (the code has no digit).
- Decision: left as skips. Joining a letter token with a following number would also turn words like "Serie 5" into codes, and both are minor brands for this category.

## V10 Jumbo (VTEX catalog API)

- Date: 2026-11-11
- Checked: `https://www.jumbo.com.ar/robots.txt` (the API path `/api/catalog_system/pub/products/search` is not listed; Jumbo only disallows `/Busca/`) and one live GET, `https://www.jumbo.com.ar/api/catalog_system/pub/products/search?ft=aspiradora%20robot&_from=0&_to=49` (HTTP 200, no session, 22 products), trimmed to `fixtures/jumbo/search-aspiradora-robot-derived.json`.
- Result: JSON array; each product has `productName`, `brand`, `link`, and `items[].ean` plus `items[].sellers[].{sellerId, sellerName, commertialOffer.{Price, ListPrice, AvailableQuantity}}`. Own offers are `sellerId` "1" ("Jumbo Argentina IO"); the rule is own seller and `AvailableQuantity > 0`. 21 of the 22 products were out of stock that day. `productReference` is an internal code, not a model code, so it is not used.
- Derived fixture edit: one product's seller was changed to a made-up third party to exercise the seller rule.
- Terms of service: PENDING OWNER.
- Note: the API is not explicitly sanctioned by the store (it is simply not disallowed), so keep the request rate low: 5 pages at most per search, usually one, under the shared query budget.

## V11 Easy (VTEX catalog API)

- Date: 2026-11-11
- Checked: `https://www.easy.com.ar/robots.txt` (the API path is not listed; Easy disallows `/*?map=category*` and `/*?initialMap=*`) and one live GET of the same search URL on `www.easy.com.ar` (HTTP 200, no session, 4 products), trimmed to `fixtures/easy/search-aspiradora-robot-derived.json`.
- Result: same VTEX shape as V10; own offers are `sellerId` "1" ("EASY"). All 4 products were in stock.
- Derived fixture edits: one product's stock set to 0 and one product's seller changed to a made-up third party.
- Terms of service: PENDING OWNER.
- Note: the API is not explicitly sanctioned by the store, so keep the request rate low.

## V12 Coppel (VTEX catalog API)

- Date: 2026-11-11
- Checked: `https://www.coppel.com.ar/robots.txt` (the API path is not listed; Coppel disallows `/busca/*`, `/buscapagina/*`, `/booster?_q` and `/?map=`) and one live GET of the same search URL on `www.coppel.com.ar` (HTTP 200, no session, 17 products), trimmed to `fixtures/coppel/search-aspiradora-robot-derived.json`.
- Result: same VTEX shape as V10; own offers are `sellerId` "1" ("Coppel S.A."). All 17 products were out of stock that day. `ean` is often empty or junk (an internal 6-digit code); such values are read as missing and matching falls back to brand and model code from the title.
- Derived fixture edits: stock set to 3 on the empty-EAN and the junk-EAN products (none were in stock) and one product's seller changed to a made-up third party.
- Terms of service: PENDING OWNER.
- Note: the API is not explicitly sanctioned by the store, so keep the request rate low.
- Owner action for V10 to V12: apply `migrations/0003_seed_vtex_stores.sql` to the remote D1 (it enables the three stores; `UPDATE stores SET enabled = 0 WHERE id = '<store>'` turns one off).
