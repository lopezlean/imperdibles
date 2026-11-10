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

- Status: PENDING OWNER. Needs `pnpm verify:ml "xiaomi s40c"` (prints whether `original_price`, `regular_amount` or `base_price` appear in the offers).
- Fallback named by the spec: if none appears, the public legend says "precio actual" instead of "precio de lista".
- PRICE_LABEL: PENDING OWNER (write `PRICE_LABEL: actual` or `PRICE_LABEL: lista` as the last line of this section once known; the output plan reads it).

## V2 ML rate limits

- Status: PENDING OWNER. Headers containing `ratelimit` or `retry` are printed by `pnpm verify:ml "xiaomi s40c"`.
- If no headers appear, keep `presupuesto_consultas` at 150. If any 429 appeared while recording, owner lowers it to 100: `pnpm wrangler d1 execute imperdibles --remote --command "UPDATE config SET valor='100' WHERE clave='presupuesto_consultas'"`.

## V3 Refresh token single use

- Status: PENDING OWNER. `pnpm verify:ml --refresh` prints only whether the stored `refresh_token` changed (stored atomically in one upsert either way). Do not run it concurrently with another command that refreshes.

## V4 Frávega seller

- Date: 2026-11-10
- Checked: one live listing, `https://www.fravega.com/l/?keyword=aspiradora%20robot` (HTTP 200, no session), recorded once and kept as `fixtures/fravega/listing-aspiradoras-robot.html`.
- Result: the listing has 15 `<article>` elements, each with a visible seller line inside the article: `<p>Vendido por <!-- -->NAME</p>` (some articles render `Vendido por Frávega` followed by a badge `<svg>` instead of the comment node). The recording shows Frávega itself (3 articles) and third parties (Bidcom, Electro World, Overhard, Electroluxar, TecnoB, Suono, Grupo Vitta). The embedded Next.js JSON also carries `"seller":{"id":"fravega..."}` per item, but the article text is enough.
- Other article fields seen: title in `[data-test-id="article-title"] span`, price block in `[data-test-id="product-price"]` (struck list price first, current price in the last `span`, then `Precio s/imp. nac.` with the price without taxes, which must not be used), product link `a[rel="bookmark"][href^="/p/"]`, brand only in the embedded JSON (`"brand":{"name":...}`).
- Fallback applied: none needed. Rule for Task 8: only articles whose seller text is exactly Frávega are kept; a missing or unreadable seller line is `unknown_seller`.
- Derived fixtures: `listing-third-party-derived.html` (first Frávega article changed to `Vendido por Overhard`; the embedded JSON was not edited) and `listing-broken-derived.html` (all `<article>` tags removed).

## V5 GTIN availability

- ML attributes: PENDING OWNER (visible only in the real `/products/{id}` recording; the synthetic fixtures carry a fake GTIN attribute purely as a shape assumption).
- Frávega HTML: yes, partially. The embedded Next.js JSON holds `"gtin":{"__typename":"EAN","number":"<13 digits>"}` for 10 of the 15 products in the recorded listing and `"gtin":null` for 5. It is not in the visible `<article>` markup, so using it means reading the embedded JSON, which Task 8 must decide.

## V6 Store terms

- Status: PENDING OWNER. Owner reviews Frávega's terms on automated reading. Fallback: exclude the store or reduce frequency (owner decides). Must be recorded before any scheduled job is installed (Task 14 Step 5).

## V7 Dubious pair of the 10/11 run

- Status: PENDING OWNER. Owner writes the two titles of the doubtful match from the 10/11 test (used in Task 9).
