# Daily Mercado Libre Coupons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read the coupon posts of Mercado Libre's official affiliates Telegram channel during `revalidar`, publish each new coupon once to the owner's channel, and show the valid ones on a static `/cupones` page that sends every visitor through the owner's fixed affiliate link.

**Architecture:** A new `src/local/coupons/` module runs inside the `revalidar` process after the deal work. Two ports (`ChannelReader` over GramJS, `CouponExtractor` over the Anthropic SDK) feed a pure guard, a D1 repository and an ingestion use case that publishes straight to the Bot API with claim-before-send. A config fingerprint of the valid published coupons decides whether `ship --site-only` runs. The Worker webhook gains `rechazar` for coupons; the Astro site gains `/cupones`.

**Tech Stack:** TypeScript ESM, pnpm, vitest, zod 4, `@anthropic-ai/sdk` (model `claude-haiku-5-5`), `telegram` (GramJS, StringSession), Astro 7 static site, Cloudflare D1 (HTTP locally, binding in the Worker).

**Spec:** `docs/superpowers/specs/2026-11-12-daily-coupons-design.md` (read it with this plan, including "Settled after the builder review").

## Global Constraints

- A code that does not appear literally in the source post (case-sensitive, whole token) is never published. The discount, minimum and cap must also each appear as a number in the post (with or without thousands separators). A coupon failing any check is not published; the owner gets "no publicado" plus the source text.
- Every coupon link is the one `meli.la` link stored verbatim in D1 `config` key `coupons_affiliate_link`. The system never builds or alters it. Until it is set, coupons are stored (`pending`) but neither posted nor shown, and the owner is told why.
- Every channel message and the `/cupones` page carry `AFFILIATE_LEGEND` (`src/output/copy.ts`).
- Expiry defaults in ART (`src/shared/time.ts`): no validity means 23:59 ART of the post's day; "hasta las 00h" means 23:59 of that day; a time window sets `valid_from` and `valid_until`; no start means the post time.
- Dedupe key is the code: a code arriving while a row with that code is valid at the post time posts nothing; a later `valid_until` extends the row; a code returning after its row expired is a new coupon.
- Extraction failures: the cursor does not move past the failed post; up to 3 attempts counted in D1; then skipped and the owner is notified; later posts are still processed in the same run.
- Coupon errors are logged and reported to the owner, never thrown into the `revalidar` -> `ship` deal flow. First run reads only today's messages in ART.
- The Telegram session string, `api_id`, `api_hash` and `ANTHROPIC_API_KEY` live only in the local `.env`: never in the Worker, CI, git, logs or error messages.
- No test touches the network: the Anthropic client, the GramJS client, `TelegramClient`, `fetch` and `exec` are fakes. Tests mirror `src/` under `test/`; run files with `pnpm vitest run <path>`.
- UI copy is Spanish; times are ART; messages stay under Telegram's 4096 characters; Worker code (`src/worker/**`) must not import zod, node modules or anything under `src/local/`.
- Conventional commits, no attribution lines.

## Review Focus

Failure modes the spec implies that no requirement test names directly (each has a test in the owning task):

1. A code that appears only inside a longer token or URL (`CHEEKY` inside `CHEEKYS`, `.../ABC1` for `ABC`) must be rejected (Task 2).
2. A post at 23:50 ART with no validity must default to that ART day, not the UTC day (Task 2).
3. The model returns the same code twice in one post (header and body): one row, one channel message (Task 6).
4. A very long source post must not push the owner notice over 4096 characters, and the channel message keeps the legend and link intact (Task 5).
5. `rechazar` sent twice, or `deleteMessage` failing because the channel message is gone: the coupon ends `removed`, no crash, the owner learns what to do by hand (Task 9).

## File Structure

- `migrations/0006_coupons.sql`: `coupons` and `coupon_posts` tables.
- `src/contract/coupon.ts`: plain types shared by local code, output text and site (no runtime code).
- `src/local/coupons/repo.ts`: D1 access (config keys, coupons, processed posts).
- `src/local/coupons/guard.ts`: pure validation, validity resolution (ART), UTC ISO output.
- `src/local/coupons/extractor.ts` + `anthropic-extractor.ts`: port, zod schema, Haiku adapter.
- `src/local/coupons/reader.ts` + `gramjs-reader.ts`: port and GramJS adapter; `scripts/telegram-login.ts`.
- `src/output/coupon-format.ts`, `src/output/publish/coupon-messages.ts`: Worker-safe text builders.
- `src/local/coupons/ingest.ts`: the ingestion use case.
- `src/local/coupons/link.ts`: `cupones-link` command.
- `src/local/coupons/site-sync.ts`, `round.ts`, `factory.ts`: fingerprint, conditional site-only ship, the `revalidar` hook.
- `site/lib/coupons.ts`, `site/lib/coupon-script.ts`, `site/components/CouponCard.astro`, `site/pages/cupones.astro`.

### Task 1: Migration, shared types and coupon repository

**Files:**
- Create: `migrations/0006_coupons.sql`, `src/contract/coupon.ts`, `src/local/coupons/repo.ts`
- Test: `test/data/migrations.test.ts` (add a describe), `test/local/coupons/repo.test.ts`

**Interfaces:**
- Produces (`src/contract/coupon.ts`):
  ```ts
  export type DiscountType = "amount" | "percent";
  export type CouponStatus = "pending" | "published" | "removed";
  /** What the extractor returns. valid_* are ART wall clock: "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM", or null. */
  export type ExtractedCoupon = { code: string; discount_type: DiscountType; discount_value: number; min_purchase: number | null; cap: number | null; scope: string; valid_from: string | null; valid_until: string | null };
  /** Validated coupon. valid_from / valid_until are UTC ISO strings from Date.toISOString() (lexicographically comparable). */
  export type Coupon = { code: string; discount_type: DiscountType; discount_value: number; min_purchase: number | null; cap: number | null; scope: string; valid_from: string; valid_until: string };
  export type StoredCoupon = Coupon & { id: number; status: CouponStatus; source_message_id: number; source_text: string; channel_message_id: number | null; owner_message_id: number | null };
  ```
- Produces (`repo.ts`): config keys `CONFIG_LINK = "coupons_affiliate_link"`, `CONFIG_CURSOR = "coupons_last_message_id"`, `CONFIG_FINGERPRINT = "coupons_site_fingerprint"`, `CONFIG_LINK_NOTICE = "coupons_link_notified_on"`, and:
  ```ts
  getConfig(db: SqlClient, name: string): Promise<string | null>
  setConfig(db: SqlClient, name: string, value: string): Promise<void>          // upsert
  insertPending(db: SqlClient, c: Coupon, src: { message_id: number; text: string }, now: Date): Promise<number | null> // null when (source_message_id, code) exists
  findByCodeValidAt(db: SqlClient, code: string, at: Date): Promise<StoredCoupon | null>  // any status, valid_until > at
  extendValidity(db: SqlClient, id: number, validUntil: string, now: Date): Promise<void> // only if later
  listPendingToPublish(db: SqlClient, now: Date): Promise<StoredCoupon[]>        // pending, valid_until > now, by id
  claimForPublish(db: SqlClient, id: number): Promise<boolean>                    // UPDATE ... WHERE status='pending'
  releaseClaim(db: SqlClient, id: number): Promise<void>                          // published -> pending
  recordChannelMessage(db: SqlClient, id: number, messageId: number): Promise<void>
  recordOwnerMessage(db: SqlClient, id: number, messageId: number): Promise<void>
  getPost(db: SqlClient, sourceMessageId: number): Promise<{ status: "failed" | "done" | "skipped"; attempts: number } | null>
  recordPost(db: SqlClient, sourceMessageId: number, status: "failed" | "done" | "skipped", attempts: number, error: string | null, now: Date): Promise<void>
  ```
  Timestamps `created_at`/`updated_at` use `artIso(now)`.

- [ ] **Step 1: Write the failing tests**

`migrations.test.ts`, `describe("0006_coupons")`: `creates coupons and coupon_posts` (both tables exist in `sqlite_master`); `rejects an unknown status and a non-positive discount` (inserting `status='x'` and `discount_value=0` each throws); `unique on (source_message_id, code)` (second identical insert throws).

`repo.test.ts` (in-memory `createSqliteClient()`): `setConfig upserts and getConfig returns null when absent`; `insertPending stores a pending row and returns its id, then null for the same (message, code)`; `findByCodeValidAt matches only rows whose valid_until is after the instant, in any status`; `extendValidity only moves valid_until forward`; `claimForPublish is true once, then false; releaseClaim makes it claimable again`; `listPendingToPublish skips expired, published and removed, ordered by id`; `recordPost upserts attempts and status`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run test/data/migrations.test.ts test/local/coupons/repo.test.ts`
Expected: FAIL (no such table `coupons`, module not found).

- [ ] **Step 3: Implement the migration, types and repository**

`0006_coupons.sql`: table `coupons(id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, discount_type TEXT NOT NULL CHECK (discount_type IN ('amount','percent')), discount_value INTEGER NOT NULL CHECK (discount_value > 0), min_purchase INTEGER, cap INTEGER, scope TEXT NOT NULL DEFAULT '', valid_from TEXT NOT NULL, valid_until TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending','published','removed')), source_message_id INTEGER NOT NULL, source_text TEXT NOT NULL, channel_message_id INTEGER, owner_message_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (source_message_id, code))`; indexes `idx_coupons_code_valid_until (code, valid_until)`, `idx_coupons_status_valid_until (status, valid_until)`, `idx_coupons_owner_message (owner_message_id)`; table `coupon_posts(source_message_id INTEGER PRIMARY KEY, status TEXT NOT NULL CHECK (status IN ('failed','done','skipped')), attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, updated_at TEXT NOT NULL)`. Header comment: apply by hand with `pnpm db:migrate:remote`. `insertPending` uses `INSERT OR IGNORE` and reads the id back.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run test/data/migrations.test.ts test/local/coupons/repo.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add migrations/0006_coupons.sql src/contract/coupon.ts src/local/coupons/repo.ts test/data/migrations.test.ts test/local/coupons/repo.test.ts
git commit -m "feat(db): add the coupons tables and a coupon repository"
```

### Task 2: Guard, normalization and the real-post fixtures

**Files:**
- Create: `src/local/coupons/guard.ts`, `fixtures/coupon-posts/{cyberalmax,flash25,gldy9a,47extra10,siguen-vigentes,sin-codigo}.txt`, `fixtures/coupon-posts/posts.json`, `test/support/coupon-fixtures.ts`
- Test: `test/local/coupons/guard.test.ts`

**Interfaces:**
- Consumes: `ExtractedCoupon`, `Coupon` (Task 1); `artDate` from `src/shared/time.ts`.
- Produces:
  ```ts
  export type GuardReason = "code_not_in_text" | "number_not_in_text" | "invalid_value" | "invalid_validity" | "already_expired";
  export type GuardResult = { ok: true; coupon: Coupon } | { ok: false; reason: GuardReason };
  export function guardCoupon(extracted: ExtractedCoupon, post: { text: string; postedAt: Date }, now: Date): GuardResult;
  export function containsToken(text: string, token: string): boolean;   // case-sensitive, not adjacent to [A-Za-z0-9]
  export function containsNumber(text: string, n: number): boolean;      // numeric tokens with "." / "," thousands separators stripped, compared whole
  ```
- Produces (`test/support/coupon-fixtures.ts`): `loadCouponPosts(): { id: number; text: string; postedAt: Date; coupons: ExtractedCoupon[] }[]` reading `fixtures/coupon-posts/posts.json` (+ the `.txt` named in `file`, via `process.cwd()` like the existing fixtures), and `postById(id)`.

Fixtures are verbatim posts from the owner's export (times are the export's ART). Create each `.txt` with exactly this text (no trailing newline needed):

`cyberalmax.txt` (id 2874, 2026-11-04 10:15:13):
```
¡Seguimos sumando descuentos imperdibles para que compartas con tu comunidad y potencies tus ventas! 🛒

🎟️ Cupón: CYBERALMAX
💰 $20.000 OFF
🛍️ Compra mínima de $250.000

🎟️ Cupón: MELIROMPETODO
💰 $45.000 OFF
🛍️ Compra mínima de $500.000

🎟️ Cupón: CYBERENCENDIDO
💰 $80.000 OFF
🛍️ Compra mínima de $1.000.000

⏰ ¡Vigentes de 10:00 a 23:59 hs!

🔥 ¡Entrá YA a buscar las mejores oportunidades de Cyber Monday!
👉 https://tinyurl.com/ycyjx44k

💛 ¡Compartí tus links de afiliado, recomendá las mejores ofertas y potenciá tus ganancias!

💡 Tip de afiliado: Sumar el aviso de urgencia destacando que los códigos vencen hoy a las 23:59 hs acelera la decisión de compra inmediata y dispara los clics directos a tu link.
```
`flash25.txt` (id 136, 2025-09-25 10:00:11):
```
⚡ ¡CUPÓN RELÁMPAGO! ⚡

¿Quién más ama un buen cupón? 🙌 Hoy tenés este código exclusivo para compartir con tu comunidad y hacerlos felices. ¡Pero apurate, que es solo hasta la medianoche! 

🎟️ FLASH25
10% OFF en compras desde $45.000 (tope de reintegro $10.000).

¡Aprovechá para sumar más ventas, más ganancias y más impacto!
```
`gldy9a.txt` (id 149, 2025-09-29 12:00:37):
```
⚡ ¡CUPÓN ESPECIAL GLAM DAYS! ⚡

De 12 a 15hs tus seguidores pueden ahorrar más con este cupón. ¡Compartilo ya y generá más ventas!

🎟️ GLDY9A
10% OFF en compras desde $50.000, con TOPE DE REINTEGRO $5.250.
Válido para productos de la campaña Glam Days.

🔗 Descubrí las ofertas de Glam Days:
https://www.mercadolibre.com.ar/c/ropa-y-accesorios
```
`47extra10.txt` (id 2853, 2026-11-02 15:04:17):
```
🔥 Sumamos nuevos cupones exclusivos en indumentaria para que compartan con su comunidad y sigan potenciando sus ventas durante este Cyber Monday:

👗 47 Street | 10% OFF sin mínimo ni tope
🎟️ Cupón: 47EXTRA10
📅 Del 2 al 9 de noviembre (productos seleccionados)
👉 https://tinyurl.com/mr3ckmdy

✨ Como Quieres | $5.000 OFF
🎟️ Cupón: CQCYBER
🛒 Compra mínima: $80.000
📅 Del 2 al 12 de noviembre
👉 https://tinyurl.com/yvd486ww

🧸 CHEEKY | $5.000 OFF
🎟️ Cupón: CHEEKY
💰 $5.000 OFF
🛒 Compra mínima: $50.000
📅 Del 2 al 12 de noviembre
👉 https://tinyurl.com/5t3y34rp

Generen sus links personalizados en el panel y aprovechen a recomendar estas marcas en sus redes.

💡 Tip de afiliado: Dar el ejemplo exacto del carrito armado acelera el clic a tus enlaces.
```
`siguen-vigentes.txt` (id 2863, 2026-11-03 13:52:57):
```
*Siguen vigentes estos cupones:*

🎟️ *CUPÓN 47 street: 47EXTRA10*
🔥 10% OFF SIN MÍNIMO DE COMPRA Y SIN TOPE
📅 Del 2 al 9 de noviembre.
🛍️ Productos seleccionados.
🔗 https://listado.mercadolibre.com.ar/_Container_mkt-cpn-cupon-afiliados-47st

🎟️ *CUPÓN Como Quieres: CQCYBER*
💰 $5.000 OFF
🛒 Compra mínima de $80.000.
📅 Del 2 al 12 de noviembre.
🔗 https://listado.mercadolibre.com.ar/_Container_cpn-mkt-como-quieres-afiliados

🎟️ *CUPÓN Cheeky: CHEEKY*
💰 $5.000 OFF
🛒 Compra mínima de $50.000.
📅 Del 2 al 12 de noviembre.
🔗 https://listado.mercadolibre.com.ar/_Container_mkt-cpn-cheeky

A ROMPER ESTAS RECOMENDACIONES!!!!
```
`sin-codigo.txt` (id 1801, 2026-03-31 10:00:14):
```
🚪 MÁS ESPACIO, MENOS DESORDEN: promo activa en FECHA DOBLE.

Una opción clara para organizar el dormitorio 👇

🪵 Placard Mosconi 3 puertas corredizas | 15% OFF

👉 https://tinyurl.com/mr44da4u

💡 Tip de afiliado: mostrar capacidad real (ropa, cajas, valijas) y cómo ahorra espacio con puertas corredizas.
```
`posts.json`: array of `{ "id", "file", "postedAt" (ISO with -03:00), "coupons": ExtractedCoupon[] }`, the golden extraction a correct model returns:
- 2874, `2026-11-04T10:15:13-03:00`: `CYBERALMAX` amount 20000 min 250000; `MELIROMPETODO` amount 45000 min 500000; `CYBERENCENDIDO` amount 80000 min 1000000; all `cap:null, scope:"", valid_from:"2026-11-04T10:00", valid_until:"2026-11-04T23:59"`.
- 136, `2025-09-25T10:00:11-03:00`: `FLASH25` percent 10 min 45000 cap 10000 scope "" valid_from null valid_until null.
- 149, `2025-09-29T12:00:37-03:00`: `GLDY9A` percent 10 min 50000 cap 5250 scope "Productos de la campaña Glam Days" valid_from `2025-09-29T12:00` valid_until `2025-09-29T15:00`.
- 2853, `2026-11-02T15:04:17-03:00`: `47EXTRA10` percent 10 min null cap null scope "Productos seleccionados" `2026-11-02`..`2026-11-09`; `CQCYBER` amount 5000 min 80000 scope "Como Quieres" `2026-11-02`..`2026-11-12`; `CHEEKY` amount 5000 min 50000 scope "Cheeky" `2026-11-02`..`2026-11-12`.
- 2863, `2026-11-03T13:52:57-03:00`: the same three as 2853 (scope of `47EXTRA10`: "Productos seleccionados"; the other two scope "").
- 1801, `2026-03-31T10:00:14-03:00`: `[]`.

- [ ] **Step 1: Write the failing tests** (`guard.test.ts`; `now` = post time + 5 min unless stated)

- `accepts every golden coupon of every fixture post` (loop over `loadCouponPosts()`; each coupon `ok: true`).
- `CYBERALMAX window 10:00-23:59 ART`: `valid_from === "2026-11-04T13:00:00.000Z"`, `valid_until === "2026-11-05T02:59:59.000Z"`.
- `FLASH25 without validity defaults from the post time to 23:59:59 ART of the post day`: `valid_from === "2025-09-25T13:00:11.000Z"`, `valid_until === "2025-09-26T02:59:59.000Z"`.
- `GLDY9A window`: `2025-09-29T15:00:00.000Z` to `2025-09-29T18:00:00.000Z`.
- `47EXTRA10 date-only range`: from `2026-11-02T03:00:00.000Z` (00:00 ART), until `2026-11-10T02:59:59.000Z` (23:59:59 ART on the 9th).
- `valid_until at 00:00 is the end of the previous day`: `"2026-11-05T00:00"` -> `2026-11-05T02:59:59.000Z`.
- `a post at 23:50 ART with no validity ends that ART day, not the UTC day` (post `2026-11-12T23:50:00-03:00`): `valid_until === "2026-11-13T02:59:59.000Z"`. (Review Focus 2)
- `rejects a code that is not in the text` (`CYBERALMAX2` -> `code_not_in_text`); `rejects a code only inside a longer token` (`CHEEKY` against text containing `CHEEKYS`, and `ABC` against `https://x.test/ABC1` -> `code_not_in_text`); `is case-sensitive` (`cheeky`). (Review Focus 1)
- `containsNumber`: `20000` in `"$20.000 OFF"` true; `1000000` in `"$1.000.000"` true; `5000` in `"$15.000"` false; `250000` in `"250,000"` true; `10` in `"10% OFF"` true.
- `rejects when the discount, minimum or cap number is not in the text` (`discount_value:45001`, `min_purchase:25000` against `$250.000`, `cap:999`) -> `number_not_in_text`; null min/cap are not checked.
- `rejects invalid values`: negative amount, `discount_value:0`, percent above 100, non-integer, code `"AB C"` or 2 characters or lowercase-only symbols outside `[A-Za-z0-9]{3,30}` -> `invalid_value`.
- `rejects valid_until not after valid_from` and unparsable dates -> `invalid_validity`.
- `rejects a coupon whose valid_until is already past` -> `already_expired`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run test/local/coupons/guard.test.ts`
Expected: FAIL ("Cannot find module .../guard.js").

- [ ] **Step 3: Implement `guardCoupon`, `containsToken`, `containsNumber` in `src/local/coupons/guard.ts`**

Order of checks: value ranges and code shape (`/^[A-Za-z0-9]{3,30}$/`), then literal code, then numbers, then validity, then expiry. ART wall clock to UTC via `new Date(\`${date}T${time}:00-03:00\`)`; date-only `valid_from` is `00:00`, date-only `valid_until` is `23:59:59`; a `valid_until` at exactly `00:00` becomes `23:59:59` of the previous ART day. Defaults use `artDate(post.postedAt)`. Output with `Date.toISOString()`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run test/local/coupons/guard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fixtures/coupon-posts test/support/coupon-fixtures.ts src/local/coupons/guard.ts test/local/coupons/guard.test.ts
git commit -m "feat(coupons): guard extracted coupons against the post text and resolve validity in ART"
```

### Task 3: Extraction port and Anthropic adapter

**Files:**
- Create: `src/local/coupons/extractor.ts`, `src/local/coupons/anthropic-extractor.ts`
- Modify: `package.json` (dependency), `src/shared/env.ts` (`anthropicApiKey` <- `ANTHROPIC_API_KEY`, `anthropicModel` <- `ANTHROPIC_MODEL`, both optional like the other non-data keys), `test/shared/env.test.ts`
- Test: `test/local/coupons/anthropic-extractor.test.ts`

**Interfaces:**
- Consumes: `ExtractedCoupon` (Task 1); `artDate`/`artTime`.
- Produces:
  ```ts
  // extractor.ts
  export const extractedCouponSchema: z.ZodType<ExtractedCoupon>;   // code string, discount_type enum, discount_value int>0, min_purchase/cap int>0|null, scope string, valid_* /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/ | null
  export const extractionResultSchema: z.ZodType<{ coupons: ExtractedCoupon[] }>;
  export interface CouponExtractor { extract(post: { text: string; postedAt: Date }): Promise<ExtractedCoupon[]> }
  export class ExtractionError extends Error {}
  // anthropic-extractor.ts
  export const DEFAULT_MODEL = "claude-haiku-5-5";
  export type AnthropicLike = { messages: { create(params: Record<string, unknown>): Promise<{ content: { type: string; input?: unknown }[] }> } };
  export function createAnthropicExtractor(cfg: { client: AnthropicLike; model: string }): CouponExtractor;
  ```

- [ ] **Step 1: Write the failing tests** (fake `AnthropicLike`, records the request)

- `sends the model, a forced report_coupons tool and the post with its ART date`: `params.model === "claude-haiku-5-5"`, `tool_choice` equals `{ type: "tool", name: "report_coupons" }`, the user content contains the post text and `2026-11-04 10:15`, the system prompt contains "nunca inventes un código" and states that validity fields are ART wall clock.
- `returns the coupons of a tool_use block` (cyberalmax golden from `loadCouponPosts()` round-trips unchanged).
- `returns [] for a post without coupons` (sin-codigo golden).
- `throws ExtractionError without a tool_use block`, `on schema-invalid input` (`discount_value: -1`, `valid_until: "mañana"`), and `when the client throws` (message does not contain the API key).
- `env`: `loadLocalEnv` exposes `anthropicApiKey`/`anthropicModel` as `""` when unset without throwing (existing default-required list unchanged).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run test/local/coupons/anthropic-extractor.test.ts test/shared/env.test.ts`
Expected: FAIL (module not found / property undefined).

- [ ] **Step 3: Implement**

Run `pnpm add @anthropic-ai/sdk`. `createAnthropicExtractor` calls `client.messages.create` with `tools: [{ name: "report_coupons", description, input_schema: z.toJSONSchema(extractionResultSchema) }]`, forced `tool_choice`, `max_tokens` 2000, a Spanish system prompt (rules: only codes literally in the text; amounts as integers in pesos; percent as the number; `null` for min/cap not stated; `scope` is how the post limits the coupon, empty when it says nothing; validity as ART wall clock, resolving "Del 2 al 9 de noviembre" with the message date's year; no start means null; reminders ("Siguen vigentes") return their codes too; no coupons means an empty list). Wrap every failure in `ExtractionError` with a message that never includes request headers or the key. Env: add the two fields to `LocalEnv`/`VAR_NAMES` and keep the default `required` list equal to today's.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run test/local/coupons/anthropic-extractor.test.ts test/shared/env.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/shared/env.ts src/local/coupons/extractor.ts src/local/coupons/anthropic-extractor.ts test/shared/env.test.ts test/local/coupons/anthropic-extractor.test.ts
git commit -m "feat(coupons): extract coupons from posts with Claude Haiku behind a port"
```

### Task 4: Channel reader port, GramJS adapter, login script and env docs

**Files:**
- Create: `src/local/coupons/reader.ts`, `src/local/coupons/gramjs-reader.ts`, `scripts/telegram-login.ts`
- Modify: `package.json` (dependency + script `"telegram:login": "tsx scripts/telegram-login.ts"`), `src/shared/env.ts`, `test/shared/env.test.ts`, `docs/env.md`
- Test: `test/local/coupons/gramjs-reader.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // reader.ts
  export type ChannelPost = { id: number; text: string; date: Date };
  /** afterId set: posts with id > afterId. afterId null: posts dated at or after `since`. Ascending by id, text-only. */
  export interface ChannelReader { fetchPosts(opts: { afterId: number | null; since: Date }): Promise<ChannelPost[]> }
  // gramjs-reader.ts
  export type RawMessage = { id: number; date: number /* unix seconds */; message?: string | null };
  export function toChannelPosts(raw: RawMessage[], opts: { afterId: number | null; since: Date }): ChannelPost[];
  export function createGramjsReader(cfg: { apiId: number; apiHash: string; session: string; channelId: string }): ChannelReader; // connects per call, always disconnects
  // env.ts
  export const COUPON_ENV_KEYS: readonly (keyof LocalEnv)[]; // telegramBotToken, telegramOwnerChatId, telegramChannelId, tgApiId, tgApiHash, tgSession, tgSourceChannelId, anthropicApiKey
  ```
  New `LocalEnv` fields: `tgApiId` <- `TELEGRAM_API_ID`, `tgApiHash` <- `TELEGRAM_API_HASH`, `tgSession` <- `TELEGRAM_SESSION`, `tgSourceChannelId` <- `TELEGRAM_SOURCE_CHANNEL_ID`. The default `required` list of `loadLocalEnv` must stay exactly today's keys, so the new keys never break existing callers.

- [ ] **Step 1: Write the failing tests**

`toChannelPosts`: `drops messages without text and returns ascending ids`; `afterId keeps only ids greater than the cursor`; `first run (afterId null) keeps only messages dated at or after since`; `maps unix seconds to Date`. `env`: `loadLocalEnv(full, COUPON_ENV_KEYS)` throws `MissingEnvError` listing only the coupon names that are absent (names, never values); the default call still passes with the old variable set.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run test/local/coupons/gramjs-reader.test.ts test/shared/env.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

Run `pnpm add telegram`. `createGramjsReader`: `new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 3 })`, `connect()`, `getMessages(channelId, { limit: 200, ...(afterId !== null ? { minId: afterId } : {}) })`, map through `toChannelPosts`, `disconnect()` and `destroy()` in `finally`; any error rethrown as a plain `Error` that never contains the session, hash or phone number. `scripts/telegram-login.ts`: reads `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` from `.env`, prompts phone, login code and optional 2FA password with `node:readline/promises`, prints only the line `TELEGRAM_SESSION=<string>` to the terminal, then lists the account's channels (title and id) so the owner can pick `TELEGRAM_SOURCE_CHANNEL_ID`; it writes no files. `docs/env.md`: add the six new variables to the list and a section "Owner step: coupon reading" with: where to create `api_id`/`api_hash` (my.telegram.org), `pnpm telegram:login`, copy the printed values into the local `.env` only, a warning that the session gives full access to the Telegram account (never in Wrangler secrets, CI or git; revoke from Telegram Settings > Devices), `ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL` (default `claude-haiku-5-5`), and that without any of them the coupon step is skipped.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run test/local/coupons/gramjs-reader.test.ts test/shared/env.test.ts && pnpm typecheck`
Expected: PASS. Manual (owner, once, not automated): `pnpm telegram:login` prints a session and the channel list.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/shared/env.ts src/local/coupons/reader.ts src/local/coupons/gramjs-reader.ts scripts/telegram-login.ts docs/env.md test/shared/env.test.ts test/local/coupons/gramjs-reader.test.ts
git commit -m "feat(coupons): read the affiliates channel with GramJS and document the one-time login"
```

### Task 5: Coupon text builders

**Files:**
- Create: `src/output/coupon-format.ts`, `src/output/publish/coupon-messages.ts`
- Test: `test/output/coupon-format.test.ts`, `test/output/publish/coupon-messages.test.ts`

**Interfaces:**
- Consumes: `Coupon`/`StoredCoupon` types, `formatArs`/`truncate` (`src/output/format.ts`), `AFFILIATE_LEGEND`, `GuardReason` (type import from Task 2).
- Produces:
  ```ts
  formatDiscount(c: Pick<Coupon, "discount_type" | "discount_value">): string   // "$20.000 OFF" | "10% OFF"
  formatValidity(validFrom: string, validUntil: string): string                    // ART; see below
  buildCouponChannelMessage(c: Coupon, link: string): string
  buildCouponOwnerNotice(c: Coupon, sourceText: string): string
  buildCouponRejectedNotice(input: { reason: GuardReason | "extraction_failed"; code: string | null; sourceText: string }): string
  ```

- [ ] **Step 1: Write the failing tests**

`formatValidity` (inputs are UTC ISO): window on one ART day with start not 00:00 -> `Válido el 04/11 de 10:00 a 23:59 hs`; otherwise `Vence el 09/11 a las 23:59 hs`.
`buildCouponChannelMessage` for CYBERALMAX returns exactly:
```
🎟️ Cupón de Mercado Libre: CYBERALMAX
$20.000 OFF
Compra mínima: $250.000
Válido el 04/11 de 10:00 a 23:59 hs
https://meli.la/2AbC_xY?r=1/

Los enlaces a Mercado Libre son de afiliado: recibimos una comisión por cada compra, sin costo adicional.
```
Further tests: `adds "Tope de reintegro: $10.000" after the minimum and "Aplica a: <scope>" after it when present` (FLASH25 / GLDY9A goldens); `omits minimum, cap and scope lines when null or empty`; `keeps the link byte for byte and the legend last under a 5000-character scope` (result `<= 4096`, scope truncated, link and legend intact; Review Focus 4). `buildCouponOwnerNotice`: starts with `Cupón publicado: CYBERALMAX ($20.000 OFF)`, contains `Mensaje original:` and the source, ends with `Para bajarlo, responder "rechazar".`, and stays `<= 4096` with a 10000-character source (Review Focus 4). `buildCouponRejectedNotice`: starts `No publicado: el código no aparece en el mensaje.` for `code_not_in_text`; the other reasons read `un monto o porcentaje no aparece en el mensaje`, `algún valor no es válido`, `la vigencia no es válida`, and `extraction_failed` reads `no se pudo leer el mensaje tras 3 intentos`; includes `Código: X` only when a code exists; includes the source, `<= 4096`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run test/output/coupon-format.test.ts test/output/publish/coupon-messages.test.ts`
Expected: FAIL (modules not found)

- [ ] **Step 3: Implement the five functions**

Dates through `artDate`/`artTime`; `DD/MM` built from the `YYYY-MM-DD` string. The source text is truncated (with `…`) so the whole message fits 4096; the scope is truncated to 300 characters in the channel message.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run test/output/coupon-format.test.ts test/output/publish/coupon-messages.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/output/coupon-format.ts src/output/publish/coupon-messages.ts test/output/coupon-format.test.ts test/output/publish/coupon-messages.test.ts
git commit -m "feat(coupons): build the channel message and the owner notices"
```

### Task 6: Ingestion use case

**Files:**
- Create: `src/local/coupons/ingest.ts`
- Test: `test/local/coupons/ingest.test.ts`

**Interfaces:**
- Consumes: `ChannelReader` (T4), `CouponExtractor`/`ExtractionError` (T3), `guardCoupon` (T2), repo functions (T1), builders (T5), `TelegramClient.sendMessage`.
- Produces:
  ```ts
  export const MAX_EXTRACTION_ATTEMPTS = 3;
  export type IngestDeps = { db: SqlClient; reader: ChannelReader; extractor: CouponExtractor; telegram: Pick<TelegramClient, "sendMessage">; channelId: string; ownerChatId: string; now: () => Date };
  export type IngestReport = { posts: number; stored: number; extended: number; duplicates: number; rejected: number; published: number; failedPosts: number };
  export async function ingestCoupons(deps: IngestDeps): Promise<IngestReport>;
  ```
  Per run: read cursor (`CONFIG_CURSOR`); `reader.fetchPosts({ afterId, since: start of today ART })`; per post skip when `getPost` is `done`/`skipped`; extract (an `ExtractionError` or any throw -> `recordPost(failed, attempts+1)`; at `MAX_EXTRACTION_ATTEMPTS` -> `skipped` and a rejected notice with `extraction_failed`); each extracted coupon is guarded (`already_expired` is dropped silently, any other failure sends the rejected notice), then deduped by code (`findByCodeValidAt` at the post time: removed or valid row -> no-op, later `valid_until` -> `extendValidity`, else `insertPending`); post recorded `done`. The cursor becomes the lowest still-`failed` post id minus 1, else the highest id read. Then publish: link from `CONFIG_LINK`; if missing and pending rows exist, one owner notice per ART day (`CONFIG_LINK_NOTICE`); else for each `listPendingToPublish`: `claimForPublish`, send to `channelId`, `recordChannelMessage`, send the owner notice, `recordOwnerMessage`; a failed channel send releases the claim, alerts the owner and moves on.

- [ ] **Step 1: Write the failing tests** (fakes: reader over an array, extractor keyed by post id from `posts.json` goldens, recording `sendMessage`, sqlite client; `now` fixed per test; `CONFIG_LINK` set to `https://meli.la/2AbC_xY?r=1/` unless stated)

- `first run asks the reader for today's messages only`: `afterId === null`, `since.toISOString() === "2026-11-04T03:00:00.000Z"` for `now` 2026-11-04 10:20 ART.
- `later runs use the cursor and advance it to the highest id read`.
- `publishes the three CYBERALMAX coupons once`: 3 messages to the channel id, 3 owner notices each containing the source text, rows `published` with `channel_message_id` and `owner_message_id`, report `{ stored: 3, published: 3 }`.
- `a "siguen vigentes" reminder posts nothing`: after post 2853, post 2863 -> no new `sendMessage`, `duplicates: 3`.
- `a reminder with a later valid_until extends the row without reposting` (`extended: 1`, `valid_until` moved).
- `a code returning after its row expired is posted again` (second post dated after the first row's `valid_until`).
- `a removed coupon is not resurrected by a reminder`.
- `the same code twice in one post makes one row and one channel message` (extractor returns CHEEKY twice; Review Focus 3).
- `a guard failure sends "No publicado" with the source and stores nothing` (extractor invents `ZZZZ99`).
- `a post with no coupons and a post without text are marked done with no messages`.
- `an already expired coupon is dropped silently` (no notice, no row).
- `extraction failure: the failed post is retried while later posts are processed`: post B throws, post C stored and published; cursor equals B's id minus 1; `coupon_posts` attempts 1; the next run retries B; after the third failure status `skipped`, exactly one owner notice with `no se pudo leer el mensaje tras 3 intentos`, cursor passes B.
- `without a configured link coupons stay pending, nothing is sent to the channel, and the owner is told once per day`; after `setConfig(CONFIG_LINK, ...)` the next run publishes them.
- `a pending coupon that expired before publishing is not posted`.
- `claim-before-send`: a db wrapper makes the first `claimForPublish` UPDATE report 0 changes -> no `sendMessage` for that row.
- `a failed channel send releases the claim, alerts the owner and the next run sends it`; other coupons in the same run are still published.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run test/local/coupons/ingest.test.ts`
Expected: FAIL ("Cannot find module .../ingest.js")

- [ ] **Step 3: Implement `ingestCoupons`** as specified in Interfaces.

Owner-notice and alert sends are each isolated (a failed owner message never aborts the loop, same as `publishValidated`). Alert texts for a failed channel send: `No se pudo publicar el cupón <CODE> en el canal. Se reintenta en la próxima revalidación.`; missing link: `Hay cupones nuevos pero falta el enlace de afiliado. Ejecutar: imperdibles cupones-link <enlace meli.la>.`

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run test/local/coupons/ingest.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/local/coupons/ingest.ts test/local/coupons/ingest.test.ts
git commit -m "feat(coupons): ingest, dedupe and publish coupons with claim-before-send"
```

### Task 7: `cupones-link` command

**Files:**
- Create: `src/local/coupons/link.ts`
- Modify: `src/data/run-daily.ts` (`Command`, `parseCommand`, `USAGE`), `src/output/affiliate-link.ts` (export `AFFILIATE_REASON_ES`, the table now local to `src/worker/webhook.ts`), `src/worker/webhook.ts` (import it), `src/local/cli.ts`
- Test: `test/local/coupons/link.test.ts`, `test/local/correr.test.ts` (parse cases)

**Interfaces:**
- Consumes: `parseAffiliateLink`, `setConfig`/`CONFIG_LINK` (T1).
- Produces:
  ```ts
  // Command gains: | { name: "cupones-link"; url: string }
  export async function runCouponsLinkCommand(deps: { db: SqlClient; stdout: (s: string) => void; stderr: (s: string) => void }, url: string): Promise<number>;
  ```

- [ ] **Step 1: Write the failing tests**

`parseCommand(["cupones-link", "https://meli.la/x"])` -> `{ name: "cupones-link", url: "https://meli.la/x" }`; with no argument or two arguments -> `null`; `USAGE` mentions `imperdibles cupones-link <enlace>`. `runCouponsLinkCommand`: `stores a valid link byte for byte and exits 0` (`https://meli.la/2AbC_xY?r=1/`, stdout `Enlace de cupones guardado.\n`); `a second call replaces it`; `rejects http, another host and extra text, stores nothing and exits 2` (stderr `Enlace no válido: el enlace no es de meli.la. Debe ser un único enlace https://meli.la/...\n`, using `AFFILIATE_REASON_ES`).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run test/local/coupons/link.test.ts test/local/correr.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

`runCouponsLinkCommand` uses `parseAffiliateLink` and `setConfig`. In `cli.ts`, after `parseCommand`, a `cupones-link` command loads env with `["cfAccountId","cfApiToken","d1DatabaseId"]`, builds only the D1 client (no Telegram or ML requirement) and returns `runCouponsLinkCommand`; `main` needs no branch for it. Webhook behavior is unchanged by the table move.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run test/local test/worker/webhook.test.ts && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/local/coupons/link.ts src/data/run-daily.ts src/output/affiliate-link.ts src/worker/webhook.ts src/local/cli.ts test/local/coupons/link.test.ts test/local/correr.test.ts
git commit -m "feat(coupons): add the cupones-link command to store the fixed affiliate link"
```

### Task 8: Site fingerprint, conditional ship and the `revalidar` hook

**Files:**
- Create: `src/local/coupons/site-sync.ts`, `src/local/coupons/round.ts`, `src/local/coupons/factory.ts`
- Modify: `src/local/output-hooks.ts` (wrap the full ship), `src/data/run-daily.ts` (`RunDeps.afterRevalidar?`, call it in `main`), `src/local/cli.ts`
- Test: `test/local/coupons/site-sync.test.ts`, `test/local/coupons/round.test.ts`, `test/local/correr.test.ts` (hook cases)

**Interfaces:**
- Consumes: `ship`/`spawnExec`, repo config keys (T1), `ingestCoupons` (T6), `createAnthropicExtractor` (T3), `createGramjsReader` (T4), `COUPON_ENV_KEYS`.
- Produces:
  ```ts
  // site-sync.ts
  /** "" when the link is unset or nothing is valid; else `${link}\n` + sorted `${id}@${valid_until}` of published rows with valid_until > now. */
  export async function couponFingerprint(db: SqlClient, now: Date): Promise<string>;
  /** Stores the fingerprint computed BEFORE the ship when it exits 0 or 2 (site deployed). Never blocks the ship if D1 fails. */
  export function shipWithFingerprint(deps: { db: SqlClient; now: () => Date }, runShip: () => Promise<number>): () => Promise<number>;
  export async function syncSiteIfChanged(deps: { db: SqlClient; now: () => Date; runShipSiteOnly: () => Promise<number>; notifyOwner: (text: string) => Promise<void> }): Promise<"unchanged" | "shipped" | "failed">;
  // round.ts
  export type RoundDeps = { ingest: () => Promise<IngestReport>; sync: () => Promise<"unchanged" | "shipped" | "failed">; notifyOwner: (text: string) => Promise<void>; log: (line: string) => void };
  export async function runCouponRound(deps: RoundDeps): Promise<void>;   // never rejects
  // factory.ts
  export function createCouponRound(deps: { db: SqlClient; env: LocalEnv; now: () => Date; fetch: typeof fetch; exec?: (cmd: string, args: string[]) => Promise<number> }, log: (line: string) => void): (() => Promise<void>) | null; // null (and a log naming the missing variables) when COUPON_ENV_KEYS are not all set
  // run-daily.ts: RunDeps gains `afterRevalidar?: () => Promise<void>`
  ```
  Stored fingerprint key is `CONFIG_FINGERPRINT`; a missing key counts as `""`.

- [ ] **Step 1: Write the failing tests**

`couponFingerprint`: `is "" without a link or without valid published coupons`; `ignores pending, removed and expired rows`; `changes when a coupon expires (now moves), is removed, is extended, or the link changes`; `is stable under insertion order`.
`shipWithFingerprint`: `stores the pre-ship fingerprint on exit 0 and on exit 2, not on exit 1`; `does not store when runShip throws (error propagates)`; `still ships when computing the fingerprint fails`.
`syncSiteIfChanged`: `does nothing when the fingerprint matches (including first run with no coupons)`; `ships --site-only exactly once when it differs and stores it`; `exit 1 returns "failed", tells the owner "No se pudo actualizar la web con los cupones. Se reintenta en la próxima revalidación." and keeps the old fingerprint`; `no double ship`: after a wrapped deal ship, a sync with no coupon change in between is `"unchanged"` and `exec` ran once; coupons that changed after the deal ship cause exactly one more `--site-only` ship.
`runCouponRound`: `ingest throws -> owner told "Falló la lectura de cupones: <message>", sync still runs`; `sync throws -> logged, resolves`; `the round never rejects`; `summary line logged`.
`createCouponRound`: `returns null and logs only variable names when a coupon variable is missing`.
`main` hook: `revalidar` calls `afterRevalidar` after `runRevalidate` and keeps its exit code even when the hook throws; `correr` never calls it.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run test/local/coupons/site-sync.test.ts test/local/coupons/round.test.ts test/local/correr.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

`createOutputHooks` wraps its `runShip` with `shipWithFingerprint({ db, now: deps.now }, ...)`. `syncSiteIfChanged` runs `ship({ ...same deps as the hooks, workerBaseUrl, publishNowSecret }, { siteOnly: true })` and compares the current fingerprint with `CONFIG_FINGERPRINT`; non-zero exit is `"failed"`. `createCouponRound` builds `createAnthropicExtractor({ client: new Anthropic({ apiKey }), model: env.anthropicModel || DEFAULT_MODEL })`, `createGramjsReader`, a bot `createTelegramClient`, and passes owner messages through `telegram.sendMessage`. `cli.ts` passes `afterRevalidar: createCouponRound(...) ?? undefined` for `revalidar`. Deliberate rule: the deal ship runs before ingestion, so "skip when the deal flow already shipped" is implemented as "skip unless coupons changed after that ship", which is what the stored fingerprint expresses.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run test/local test/output/local && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/local src/data/run-daily.ts test/local
git commit -m "feat(coupons): run the coupon round in revalidar and rebuild the site only when coupons change"
```

### Task 9: `rechazar` for coupons and `deleteMessage`

**Files:**
- Modify: `src/output/telegram/client.ts` (`deleteMessage`, result type may be `true`), `src/worker/webhook.ts`, `src/worker/index.ts`, every test fake typed `TelegramClient` (find with `rg -l "TelegramClient" test`), `test/worker/webhook.test.ts` deps helper
- Test: `test/output/telegram/client.test.ts`, `test/worker/webhook.test.ts`, `test/worker/worker-imports.test.ts` (must stay green)

**Interfaces:**
- Produces:
  ```ts
  // TelegramClient gains
  deleteMessage(p: { chat_id: string; message_id: number }): Promise<void>;
  // webhook.ts Deps becomes
  type Deps = { db: SqlClient; ownerChatId: string; channelId: string; telegram: Pick<TelegramClient, "deleteMessage">; now: () => Date };
  ```
  `index.ts` passes `channelId: deps.env.TELEGRAM_CHANNEL_ID` and `telegram: telegramFor(deps)`.

- [ ] **Step 1: Write the failing tests**

Client: `deleteMessage posts to /deleteMessage with chat_id and message_id and resolves on {ok:true,result:true}`; `throws TelegramError(400, ...)` on `{ok:false,error_code:400,description:"Bad Request: message to delete not found"}`.
Webhook, `describe("coupons")` (rows seeded in `coupons` with `owner_message_id: 700`, `channel_message_id: 900`, `status:'published'`; the update replies to message 700):
- `rechazar marks the coupon removed and deletes the channel message`: `deleteMessage` called once with `{ chat_id: CHANNEL, message_id: 900 }`; reply text `Cupón retirado: CYBERALMAX. Se quita de la web en la próxima actualización (hasta una hora).`
- `ignores case and surrounding spaces` (`"  Rechazar "`).
- `a second rechazar changes nothing`: reply `Ese cupón ya está retirado; no se cambió nada.`, `deleteMessage` not called again. (Review Focus 5)
- `deleteMessage failing still leaves the coupon removed`: reply `Cupón retirado de la web, pero no se pudo borrar el mensaje del canal. Borrarlo a mano.` (Review Focus 5)
- `a pending coupon without a channel message is removed with no delete call`.
- `any other reply text` -> `Para bajar este cupón, responder "rechazar".`
- `a reply to a message that is neither a candidate nor a coupon notice` -> the existing HELP text; `a candidate wins when both tables hold the same message id`.
- `the removal is a guarded UPDATE: a coupon that is already removed between SELECT and UPDATE reports unchanged` (racing db wrapper, same pattern as `racingDeps`).
- `non-owner chats are still ignored`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run test/output/telegram/client.test.ts test/worker/webhook.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

Order in `handleTelegramUpdate`: candidate lookup first (unchanged); when none, `SELECT id, code, status, channel_message_id FROM coupons WHERE owner_message_id = ?`; none -> HELP. Removal claim: `UPDATE coupons SET status = 'removed', updated_at = ? WHERE id = ? AND status IN ('pending','published')`; `changes !== 1` -> the "ya está retirado" reply; then `deleteMessage` in try/catch. `deleteMessage` in the client goes through the existing `call` (widen `ApiResponse.result` to allow `true`). Update every test fake with a `deleteMessage` stub.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run test/worker test/output && pnpm typecheck`
Expected: PASS (including the Worker import-closure and CPU-budget tests)

- [ ] **Step 5: Commit**

```bash
git add src/output/telegram/client.ts src/worker test/worker test/output test/e2e
git commit -m "feat(worker): take a coupon down by replying rechazar and delete its channel message"
```

### Task 10: `/cupones` page, card, inline script, home link and sitemap

**Files:**
- Create: `site/lib/coupons.ts`, `site/lib/coupon-script.ts`, `site/components/CouponCard.astro`, `site/pages/cupones.astro`, `test/site/support/seed-coupons.ts`
- Modify: `site/lib/site-data.ts` (`getCouponSiteData`), `site/components/Header.astro`, `site/pages/index.astro`, `src/output/copy.ts`, `test/site/build.test.ts`
- Test: `test/site/coupons.test.ts`, `test/site/coupon-script.test.ts`, `test/site/coupons-build.test.ts`

**Interfaces:**
- Consumes: `StoredCoupon` (T1), `formatDiscount`/`formatValidity` (T5), `CONFIG_LINK` (T1), `openSiteDb`, `Base.astro`.
- Produces:
  ```ts
  // site/lib/coupons.ts
  export type CouponView = Pick<StoredCoupon, "id" | "code" | "discount_type" | "discount_value" | "min_purchase" | "cap" | "scope" | "valid_from" | "valid_until">;
  export type CouponSiteData = { link: string; coupons: CouponView[] } | { link: null; coupons: [] };
  export async function loadCouponSiteData(db: SqlClient, now: Date): Promise<CouponSiteData>;
  // site/lib/coupon-script.ts
  export const COUPON_PAGE_SCRIPT: string;   // IIFE source for an inline <script>
  ```
  New copy in `src/output/copy.ts`: `NAV.cupones = "Cupones"`, `COUPONS_TITLE = "Cupones de Mercado Libre vigentes hoy | imperdibles"`, `COUPONS_H1 = "Cupones de Mercado Libre vigentes hoy"`, `COUPONS_LEAD = "Códigos exclusivos que Mercado Libre publica para afiliados. Copiá el código y usalo en tu compra."`, `COUPONS_USE = "Usar"`, `COUPONS_COPIED = "Código copiado"`, `COUPONS_EMPTY = "No hay cupones vigentes ahora."`, `COUPONS_EMPTY_LEAD = "Volvé más tarde: se actualizan cada vez que Mercado Libre publica uno nuevo."`, `COUPONS_HOW_HEADING = "Cómo usar un cupón"`, `COUPONS_HOW = ["Tocá Usar: se copia el código y se abre Mercado Libre.", "Elegí tus productos y pegá el código al pagar.", "Revisá el mínimo de compra y el tope antes de confirmar."]`.

- [ ] **Step 1: Write the failing tests**

`coupons.test.ts` (sqlite, `seed-coupons.ts` inserts rows): `returns published coupons whose valid_until is after now, soonest expiry first then id`; `excludes pending, removed and expired rows`; `keeps a coupon whose window has not started yet`; `returns link null and no coupons when coupons_affiliate_link is unset`.
`coupon-script.test.ts` (run `COUPON_PAGE_SCRIPT` with `new Function("document", "navigator", "Date", src)` against a hand-written fake document of cards with `dataset.from/until`, a `hidden` flag, an `#cupones-empty` element and a click-delegating `addEventListener`): `hides cards before valid_from and from valid_until on`; `shows the empty state when every card is hidden and hides it when one is visible`; `clicking a [data-copy] element calls navigator.clipboard.writeText(code) and does not preventDefault`; `a missing or rejecting clipboard does not throw and the link still opens` (no preventDefault).
`coupons-build.test.ts` (real `buildSite`; seeds relative to `new Date()`: valid +1 day `VIGENTE1`, expired -1 day `VENCIDO1`, removed `RETIRADO1`, pending `PENDIENTE1`, link set): `/cupones/` contains `VIGENTE1`, the discount, a `Usar` button whose `href` is the stored link with `rel="sponsored noopener"`, `data-copy="VIGENTE1"`, `data-from` and `data-until`, `AFFILIATE_LEGEND`, the `Cómo usar un cupón` section; it contains none of the other three codes; the canonical is `https://imperdibles.com.ar/cupones/`; `sitemap-0.xml` lists `https://imperdibles.com.ar/cupones/`; the home contains `href="/cupones/"` (also add that assertion to `build.test.ts`). A second build with no link: the page shows `No hay cupones vigentes ahora.` and still shows `Cómo usar un cupón`, with no coupon code.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run test/site/coupons.test.ts test/site/coupon-script.test.ts`
Expected: FAIL (modules not found). The build test fails the same way once its imports exist.

- [ ] **Step 3: Implement**

`loadCouponSiteData`: `SELECT ... FROM coupons WHERE status='published' AND valid_until > ? ORDER BY valid_until, id` with `now.toISOString()`, link from `config` (`null` -> empty result). `getCouponSiteData` caches like `getSiteData`. `CouponCard.astro` follows `DealCard.astro` (same `.card` tokens, CSS in a page-level `<style is:inline>` using the existing custom properties): code in `.mono`, `formatDiscount`, "Compra mínima" / "Tope de reintegro" / "Aplica a" lines only when present, `formatValidity`, and `<a class="cta" href={link} target="_blank" rel="sponsored noopener" data-copy={code}>Usar</a>` (a real link, so it works without JavaScript); the article carries `data-coupon`, `data-from`, `data-until`. `cupones.astro` renders the list or the empty state (`id="cupones-empty"`, `hidden` when there are cards), always the "Cómo usar un cupón" steps, a `BreadcrumbList` JSON-LD, and `<script is:inline set:html={COUPON_PAGE_SCRIPT}>`. Add `Cupones` to `Header.astro` nav and an `a.chip` link in the home chips row. The sitemap integration already lists every static page, so no config change is needed; the build test pins it.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test && pnpm typecheck`
Expected: PASS (full suite, including both site builds)

- [ ] **Step 5: Commit**

```bash
git add site src/output/copy.ts test/site
git commit -m "feat(site): add the /cupones page with a copy-and-go button and client-side expiry"
```
