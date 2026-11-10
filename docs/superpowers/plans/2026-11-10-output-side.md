# imperdibles.ar Phase 1, Output Side: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn each day's `ListaDeCandidatos` into a Telegram shortlist with a 1200x675 card, accept the owner's affiliate links, publish revalidated candidates to the Telegram channel, hand the owner ready material for X, and serve the single page of imperdibles.ar.

**Architecture:** Local part (owner's Mac, called by the data side through `LocalOutputHooks`): renders cards with Satori and resvg, sends the shortlist, re-uploads cards whose `file_id` was cleared, and triggers late publication. Cloudflare Worker (free plan): Telegram webhook, 11:00 publication cron, 07:30 missing-run cron, protected publish-now endpoint, and `GET /` serving prebuilt HTML from the `paginas` table. Both parts share D1 through `SqlClient`; the Worker never rasterizes, parses store HTML or runs the matcher.

**Tech Stack:** Node 22, TypeScript 5 (strict, ESM), pnpm, Vitest, Cloudflare Workers + D1 + wrangler, Satori, @resvg/resvg-js, @fontsource/inter, @fontsource/space-grotesk, Telegram Bot API over `fetch`.

**Spec:** `docs/superpowers/specs/2026-11-10-fase-1-design.md` (context: `ROADMAP.md`; visual design: `docs/design/Main.dc.html`, `docs/design/Tarjeta.dc.html` and the Design reference appendix below). Companion plan: `docs/superpowers/plans/2026-11-10-data-side.md`.

**Prerequisite:** Tasks 1 to 3 of the data-side plan (the foundation) are merged: tooling and dependencies, `src/shared/time.ts`, the contract in `src/contract/candidate-list.ts`, `OwnerAlert`/`RevalidationReport`/`LocalOutputHooks` in `src/contract/local-hooks.ts`, the D1 migrations, `SqlClient` and its three implementations, `loadConfig`, `loadLocalEnv`, the stub `src/local/output-hooks.ts`, and the fixtures in `fixtures/lista-candidatos/`. Task 15 also needs data-side Tasks 12 to 14.

## Global Constraints

- The repository is initialized by data-side Task 1. Conventional commits only; never add `Co-Authored-By` or any AI attribution to a commit.
- Strict TDD: every task writes the failing test first. Tests use recorded or documented fixtures (`fixtures/telegram/`, `fixtures/lista-candidatos/`) and fakes; no test calls Telegram, Mercado Libre, a store or Cloudflare.
- Secrets live in `.env` (local) and Wrangler secrets, created by the owner. Agents never create, read or print them. Worker secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_CHAT_ID`, `TELEGRAM_CHANNEL_ID`, `TELEGRAM_WEBHOOK_SECRET`, `PUBLISH_NOW_SECRET`. Local `.env` also uses `WORKER_BASE_URL` and the names listed in the data plan. Non-secret Worker var in `wrangler.toml`: `TELEGRAM_CHANNEL_URL`. Steps needing a secret are marked **Owner runs**.
- Code, identifiers, comments, commit messages and plans in English. User-facing copy (page, card, bot messages, channel posts, X material) in neutral Spanish (no voseo), verbatim from the spec and the design where they fix it; the Design reference appendix is the source for design strings.
- Contract keys and D1 table, column and enum names stay verbatim Spanish as the spec fixes them.
- Affiliate links are stored and published byte for byte as received: never resolved, shortened, normalized (no `new URL(x).href`) or rewritten. Only host `meli.la` over `https` is accepted. Every public message and the page carry the affiliate legend. Page links use `rel="sponsored noopener"`.
- Cloudflare free plan: 10 ms CPU per invocation and per Cron Trigger, 50 subrequests per invocation, 5 Cron Triggers per account (this project uses 2: `30 10 * * *` and `0 14 * * *`, i.e. 07:30 and 11:00 ART). Worker code (`src/worker/**` and everything it imports) must not import `cheerio`, `satori`, `@resvg/resvg-js`, `better-sqlite3`, `dotenv` or `node:` modules.
- The Worker publishes only candidates with `estado = 'validado'` and `validado_en` within the last 30 minutes, with `enlace_afiliado` and `telegram_file_id` set. "Ante la duda, no se publica."
- Phase 1 shows the "Foto del producto" placeholder on page and card; `imagen_url` is ignored unless the owner records in V-O4 that the affiliate terms allow catalog photos.
- `spike/` is throwaway: never import or extend it.
- Shell commands in this plan use `bat`, `rg`, `fd`, `sd`, `eza` instead of `cat`, `grep`, `find`, `sed`, `ls`.
- `package.json`, the lockfile, `tsconfig.json` and `vitest.config.ts` belong to the foundation; this plan never edits them. If a new dependency is needed, stop and ask the owner.
- Unverified items get an early verification task; outcomes go to `docs/verification/output.md` as `## V-On <title>` with date, check, result and fallback applied.
- Deadline 27/11/2026, ROADMAP calendar: Tasks 1 to 11 (shortlist, card, Telegram publication, dry runs without real publication) by 20/11; Tasks 12 to 15 (page, CPU budget, end-to-end) by 24/11; 25 to 27/11 fixes only.
- Commands: `pnpm test`, `pnpm vitest run <path>`, `pnpm typecheck`.

## File Ownership

This plan owns: `src/output/**`, `src/worker/**`, `src/local/output-hooks.ts` (replaces the foundation stub), `wrangler.toml` (after the foundation), `scripts/verify-telegram-file-id.ts`, `scripts/card-preview.ts`, `scripts/set-webhook.ts`, `migrations/02xx_*.sql`, `fixtures/telegram/**`, `test/output/**`, `test/worker/**`, `test/e2e/**`, `docs/verification/output.md`.

Read only (foundation or data plan): `src/contract/**`, `src/shared/**`, `migrations/0001_initial.sql`, `migrations/0002_seed.sql`, `test/support/sqlite-client.ts`, `fixtures/lista-candidatos/**`, `docs/design/**`, `docs/verification/data.md` (line `PRICE_LABEL:` of V1), and for Task 15 only `src/data/**` and `fixtures/runs/**`.

The data plan owns `src/data/**`, `src/local/cli.ts`, `src/local/run-log.ts`, `bin/`, `ops/`, `scripts/ml-authorize.ts`, `scripts/record-fixtures.ts`, `scripts/verify-ml.ts`, `scripts/healthcheck-stores.ts`, `migrations/01xx_*.sql`, `fixtures/{ml,fravega,cetrogar,musimundo,runs}/**`, `test/data/**`, `test/local/**`, `docs/verification/data.md`.

## Review Focus

1. The owner pastes something that is not exactly one `meli.la` link: text around it ("Acá está: https://meli.la/x"), `http://`, `www.meli.la`, `meli.la.evil.com`, a `mercadolibre.com.ar` URL, two links. Expected: rejected with a reason, nothing stored; a valid link is stored byte for byte, trailing slash and case included. Test in Task 7.
2. The owner replies to yesterday's shortlist, to a non-candidate message, or not as a reply. Expected: no state change and an explanatory reply. Test in Task 7.
3. Three rivals with long titles push the shortlist caption over Telegram's 1024-character limit or the X text over 280. Expected: titles shortened with "…", URLs and the affiliate link never cut. Tests in Tasks 6 and 8.
4. The 11:00 cron and a publish-now call overlap, or the cron is retried. Expected: each candidate is posted to the channel at most once. Test in Task 8.
5. A store title containing `<`, `&` or `"` (e.g. `Robot "S8+" <Negro> & base`) reaches the page. Expected: HTML-escaped text, no markup injection. Test in Task 12.

---

### Task 1: Output verifications and minimal Worker

**Files:**
- Create: `src/worker/index.ts` (minimal), `src/worker/env.ts`, `scripts/verify-telegram-file-id.ts`, `docs/verification/output.md`
- Modify: `wrangler.toml` (add `[vars] TELEGRAM_CHANNEL_URL`)
- Test: `test/worker/healthz.test.ts`

**Interfaces:**
- Produces: `type Env = { DB: D1Database; TELEGRAM_BOT_TOKEN: string; TELEGRAM_OWNER_CHAT_ID: string; TELEGRAM_CHANNEL_ID: string; TELEGRAM_WEBHOOK_SECRET: string; PUBLISH_NOW_SECRET: string; TELEGRAM_CHANNEL_URL: string }`; `handleFetch(req: Request, deps: { db: SqlClient; env: Env; now: () => Date }): Promise<Response>` with `GET /healthz` → 200 `ok` after `SELECT 1`; anything else 404 (extended by Tasks 9 and 13). `export default { fetch(req, env) }` wraps it with `createD1BindingClient(env.DB)`.

- [ ] **Step 1: Write the failing test:** `handleFetch(new Request("https://imperdibles.ar/healthz"), { db: createSqliteClient(), ... })` → status 200, body `ok`; `/nada` → 404.
- [ ] **Step 2: Run it.** `pnpm vitest run test/worker/healthz.test.ts` → FAIL.
- [ ] **Step 3: Implement** the minimal Worker and `scripts/verify-telegram-file-id.ts` (sends a 1200x675 solid PNG built in the script to `TELEGRAM_OWNER_CHAT_ID` with `sendPhoto`, takes the largest `photo[].file_id`, then `sendPhoto` to `TELEGRAM_CHANNEL_ID` with that `file_id`; prints `file_id reuse: ok` or the Telegram `description`; never prints tokens).
- [ ] **Step 4: Run it.** → PASS.
- [ ] **Step 5: Owner runs** the checks and the agent records them in `docs/verification/output.md`:
  - `V-O1 Telegram file_id reuse`: **owner** creates a private test channel, adds the bot as admin, puts its id in `.env` as `TELEGRAM_CHANNEL_ID`, runs `pnpm verify:telegram`. Fallback named by the spec: on a rejected `file_id` the local job re-uploads the PNG (Task 10). If reuse never works, stop and ask the owner.
  - `V-O2 Worker CPU and D1 subrequests`: **owner** runs `pnpm wrangler secret put <NAME>` for the five secrets, `pnpm worker:deploy`, opens `/healthz` 20 times, and reads CPU time per invocation in the Cloudflare dashboard (Workers, imperdibles, Metrics). The agent looks up in Cloudflare docs whether D1 queries count toward the 50 subrequests. Fallback named by the spec: move the step that does not fit to the local job (page generation first).
  - `V-O3 X API`: **owner** checks the free tier's posting limits, cost and image upload. Phase 1 always sends the X material to the owner; automatic posting is out of this plan unless this check passes and the owner asks for it.
  - `V-O4 Catalog photos`: **owner** confirms whether the affiliate program terms allow catalog photos. Default: placeholder only.
- [ ] **Step 6: Commit** `git add src/worker scripts/verify-telegram-file-id.ts wrangler.toml test/worker docs/verification/output.md && git commit -m "feat: add minimal Worker and output verification scripts"`

---

### Task 2: Formatting, copy and design tokens

**Files:**
- Create: `src/output/format.ts`, `src/output/copy.ts`, `src/output/design-tokens.ts`
- Test: `test/output/format.test.ts`

**Interfaces:**
- Produces:

```ts
export function formatArs(n: number): string;                                   // "$1.199.999"
export function pctTenths(mlPrice: number, otherPrice: number): number;          // floor((other - ml) * 1000 / other), integers only
export function formatPct(c: Pick<Candidate, "ml" | "otras">): string;           // "19,7" (truncated, never rounded up)
export function formatThreshold(umbral: number): string;                         // 15 → "15", 12.5 → "12,5"
export function formatDateLong(fecha: string): string;                           // "10 de noviembre de 2026"
export function formatDateShort(fecha: string): string;                          // "10/11/2026"
export function truncate(s: string, max: number): string;                        // adds "…" within max characters
export const STORE_NAMES: Record<string, string>;                                // ml "Mercado Libre", fravega "Frávega", cetrogar "Cetrogar", musimundo "Musimundo"
export const PRICE_LABEL: "lista" | "actual";                                     // from docs/verification/data.md V1
export const AFFILIATE_LEGEND = "Los enlaces a Mercado Libre son de afiliado: recibimos una comisión por cada compra, sin costo adicional.";
export const NOT_AFFILIATED = "imperdibles.ar no pertenece a Mercado Libre ni a las tiendas comparadas.";
export const TOKENS: { accent: "#C2410C"; ink: "#0E1116"; ink2: "#3A4350"; muted: "#5B6472"; line: "#DDE1E7"; bg: "#F4F5F7"; surface: "#FFFFFF"; photoPage: "#EEF0F3"; photoCard: "#E3E6EB"; rivalBar: "#B4BBC6"; onDark2: "#C9CED6" };
```

- [ ] **Step 1: Read** the last line of V1 in `docs/verification/data.md` (`PRICE_LABEL: lista` or `actual`). If V1 is not recorded yet, use `lista` (the design's wording) and add a TODO line in `docs/verification/output.md`.
- [ ] **Step 2: Write the failing test**

```ts
expect(formatArs(264699)).toBe("$264.699");
expect(formatArs(1199999)).toBe("$1.199.999");
expect(formatPct(c(264699, 329999))).toBe("19,7");   // the design mock shows 19,8; the spec truncates
expect(formatPct(c(329999, 399999))).toBe("17,5");
expect(formatPct(c(994899, 1199999))).toBe("17,0");
expect(formatPct(c(569000, 669899))).toBe("15,0");
expect(formatPct(c(85000, 100000))).toBe("15,0");
expect(formatThreshold(15)).toBe("15");
expect(formatDateLong("2026-11-10")).toBe("10 de noviembre de 2026");
expect(formatDateShort("2026-11-01")).toBe("01/11/2026");
expect(truncate("a".repeat(70), 60)).toHaveLength(60);
expect(truncate("a".repeat(70), 60).endsWith("…")).toBe(true);
```

- [ ] **Step 3: Run it.** → FAIL. **Step 4: Implement.** **Step 5: Run it.** → PASS.
- [ ] **Step 6: Commit** `git add src/output/format.ts src/output/copy.ts src/output/design-tokens.ts test/output/format.test.ts && git commit -m "feat: add Spanish formatting, copy and design tokens"`

---

### Task 3: Card layout tree

**Files:**
- Create: `src/output/card/tree.ts`
- Test: `test/output/card/tree.test.ts`

**Interfaces:**
- Consumes: `Candidate`, Task 2 exports.
- Produces: `type CardNode = { type: string; props: { style?: Record<string, string | number>; children?: CardNode | CardNode[] | string; [k: string]: unknown } }`; `buildCardTree(c: Candidate, opts: { fecha: string }): CardNode`; `barWidthPct(price: number, max: number): number` (`Math.round(price / max * 1000) / 10`).

Layout from the Design reference "Card" section: header (logo, badge `"<formatPct>% menos"`), body (260x260 placeholder, title `truncate(titulo, 60)`, ML row and up to 3 rivals from `otras` in ascending order, bars `width = barWidthPct(price, max shown price)%`), footer (`"Mismo modelo, precio de lista al <formatDateShort>"` or `"precio actual"` per `PRICE_LABEL`, and `"Diferencia: <formatArs(diferencia_ars)>"`). With 2 or 3 rivals, rival price 26px and gaps 10px so the card stays 675px tall.

- [ ] **Step 1: Write the failing test**

```ts
const one = candidate("Xiaomi Robot Vacuum S40C", 329999, [["fravega", 399999]]);
expect(buildCardTree(one, { fecha: "2026-11-10" })).toMatchSnapshot();
expect(textOf(tree)).toContain("17,5% menos");
expect(textOf(tree)).toContain("Mismo modelo, precio de lista al 10/11/2026");
expect(textOf(tree)).toContain("Diferencia: $70.000");
expect(barWidths(tree)).toEqual([82.5, 100]);
const three = load("valid-three-rivals.json").candidatos[0];
expect(buildCardTree(three, opts)).toMatchSnapshot();
expect(rivalNames(tree3)).toEqual(["Frávega", "Cetrogar", "Musimundo"]);   // ascending price
expect(titleOf(tree3).length).toBeLessThanOrEqual(60);
expect(rootStyle(tree)).toMatchObject({ width: 1200, height: 675 });
// five rivals in input → only the three cheapest shown
```

- [ ] **Step 2: Run it.** → FAIL. **Step 3: Implement.** **Step 4: Run it.** → PASS.
- [ ] **Step 5: Commit** `git add src/output/card/tree.ts test/output/card && git commit -m "feat: add card layout tree"`

---

### Task 4: Card PNG rendering

**Files:**
- Create: `src/output/card/render.ts`, `scripts/card-preview.ts`
- Test: `test/output/card/render.test.ts`

**Interfaces:**
- Consumes: `buildCardTree`.
- Produces: `renderCardPng(c: Candidate, opts: { fecha: string }): Promise<Uint8Array>` (Satori at 1200x675 with Inter 400/500/600 and Space Grotesk 500/700 loaded from `@fontsource/*/files/*-latin-<weight>-normal.woff`, then resvg to PNG).

- [ ] **Step 1: Write the failing test**

```ts
const png = await renderCardPng(fixtureCandidate, { fecha: "2026-11-10" });
expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);  // PNG signature
const view = new DataView(png.buffer, png.byteOffset);
expect(view.getUint32(16)).toBe(1200);
expect(view.getUint32(20)).toBe(675);
// renders the three-rival fixture without throwing
```

- [ ] **Step 2: Run it.** → FAIL. **Step 3: Implement** `render.ts` and `scripts/card-preview.ts` (writes `var/card-preview-<n>.png` for every candidate of `fixtures/lista-candidatos/valid-2026-11-10.json` and `valid-three-rivals.json`). **Step 4: Run it.** → PASS.
- [ ] **Step 5: Owner reviews** `pnpm card:preview` output against `docs/design/Tarjeta.dc.html`.
- [ ] **Step 6: Commit** `git add src/output/card/render.ts scripts/card-preview.ts test/output/card/render.test.ts && git commit -m "feat: render 1200x675 card PNG with Satori"`

---

### Task 5: Telegram Bot API client

**Files:**
- Create: `src/output/telegram/client.ts`, `fixtures/telegram/send-photo-ok.json`, `send-photo-bad-file-id.json`, `send-message-ok.json`, `too-many-requests.json`
- Test: `test/output/telegram/client.test.ts`

**Interfaces:**
- Produces:

```ts
export type PhotoInput = { fileId: string } | { png: Uint8Array };
export interface TelegramClient {
  sendPhoto(p: { chat_id: string; photo: PhotoInput; caption: string; reply_to_message_id?: number }): Promise<{ message_id: number; file_id: string }>;
  sendMessage(p: { chat_id: string; text: string; reply_to_message_id?: number }): Promise<{ message_id: number }>;
}
export function createTelegramClient(cfg: { token: string; fetch: typeof fetch }): TelegramClient; // runs in Node and in the Worker
export class TelegramError extends Error { constructor(public status: number, public description: string) }
export function isInvalidFileId(e: unknown): boolean; // TelegramError whose description matches /file identifier/i
```

Fixtures follow the Bot API documented shapes (`{"ok":true,"result":{...}}`, `{"ok":false,"error_code":400,"description":"Bad Request: wrong file identifier/HTTP URL specified"}`), fake ids only. Plain text messages, no `parse_mode`.

- [ ] **Step 1: Write the failing test:** `sendPhoto` with `{fileId}` posts JSON to `https://api.telegram.org/bot<token>/sendPhoto` with `photo` = the id; with `{png}` posts multipart with a `photo` file part named `tarjeta.png`; returns the largest size's `file_id`; bad file id → `TelegramError` and `isInvalidFileId` true; 429 → `TelegramError` status 429; the token never appears in error messages.
- [ ] **Step 2: Run it.** → FAIL. **Step 3: Implement.** **Step 4: Run it.** → PASS.
- [ ] **Step 5: Commit** `git add src/output/telegram fixtures/telegram test/output/telegram && git commit -m "feat: add Telegram Bot API client"`

---

### Task 6: Shortlist messages, local sender and owner alerts

**Files:**
- Create: `src/output/shortlist/messages.ts`, `src/output/local/send-shortlist.ts`, `src/output/alerts.ts`
- Modify: `src/local/output-hooks.ts` (replace the stub's `onCandidatesReady` and `notifyOwner`)
- Test: `test/output/shortlist/messages.test.ts`, `test/output/local/send-shortlist.test.ts`, `test/output/alerts.test.ts`

**Interfaces:**
- Consumes: `CandidateList`, `TelegramClient`, `renderCardPng`, `SqlClient`, `OwnerAlert`, `createOutputHooks` signature from the foundation.
- Produces: `buildShortlistCaption(c: Candidate): string` (≤ 1024), `buildNoCandidatesText(list: CandidateList): string`, `sendShortlist(deps: { db: SqlClient; telegram: TelegramClient; ownerChatId: string; render: typeof renderCardPng }, list: CandidateList): Promise<void>`, `renderOwnerAlert(a: OwnerAlert): string`.

Caption (plain text):

```
<titulo>
Mercado Libre: <formatArs(ml)>
<Tienda>: <formatArs(precio)>        (one line per rival)
Diferencia: <formatArs(diferencia_ars)> (<formatPct>% menos)

Mercado Libre: <ml.titulo_listado>
<ml.url>
<Tienda>: <titulo_listado>
<url>                                 (per rival)

Para elegirlo, responder a este mensaje con el enlace de afiliado. Para descartarlo, responder "rechazar".
```

Over 1024 characters: shorten every `titulo_listado` with `truncate` (80, then 40) until it fits; URLs are never shortened. `buildNoCandidatesText`: `Hoy no hay candidatos: se compararon <n> modelos y ninguno llegó al <umbral>%.` Alerts, one short sentence each: `run_failed` → `La corrida de hoy falló: <reason>. No se publicó nada.`; `run_partial` → `La corrida de hoy quedó incompleta: <skipped_models> modelos sin leer.`; `store_format_error` → `Cambió el formato de <Tienda>; no se usaron sus datos hoy.`; `ml_auth_required` → `Hay que volver a autorizar Mercado Libre: pnpm ml:authorize url.`; `ml_permission_denied` → `Mercado Libre respondió 403 en <path>. La corrida se detuvo.`

`sendShortlist`: first 10 candidates in list order; per candidate render, `sendPhoto` to the owner with `{png}`, then `UPDATE candidatos SET telegram_file_id = ?, telegram_mensaje_id = ? WHERE id = ?`. Zero candidates → one `sendMessage` with `buildNoCandidatesText`. One candidate's failure is logged and the rest continue.

- [ ] **Step 1: Write the failing tests**

```ts
const cap = buildShortlistCaption(load("valid-2026-11-10.json").candidatos[1]);
expect(cap).toContain("Mercado Libre: $329.999");
expect(cap).toContain("Frávega: $399.999");
expect(cap).toContain("Diferencia: $70.000 (17,5% menos)");
expect(cap).toContain(c.ml.url);  // and each rival url, verbatim
const long = buildShortlistCaption(load("valid-three-rivals.json").candidatos[0]);
expect(long.length).toBeLessThanOrEqual(1024);                       // Review Focus 3
for (const o of [c3.ml, ...c3.otras]) expect(long).toContain(o.url);
// sendShortlist with 12 candidates → 10 sendPhoto calls, rows 1-10 get file_id and mensaje_id, rows 11-12 untouched
// sendShortlist with valid-empty.json → 1 sendMessage "Hoy no hay candidatos: se compararon 9 modelos y ninguno llegó al 15%."
// one sendPhoto rejecting → the other candidates are still sent
// renderOwnerAlert covers each OwnerAlert kind with the strings above
```

- [ ] **Step 2: Run them.** → FAIL. **Step 3: Implement**, wiring `createOutputHooks` to `createTelegramClient({ token: env.telegramBotToken, fetch })`. **Step 4: Run them.** → PASS.
- [ ] **Step 5: Commit** `git add src/output/shortlist src/output/local src/output/alerts.ts src/local/output-hooks.ts test/output && git commit -m "feat: send daily shortlist with cards and owner alerts"`

---

### Task 7: Affiliate link parser and Telegram webhook

**Files:**
- Create: `src/output/affiliate-link.ts`, `src/worker/webhook.ts`, `fixtures/telegram/update-*.json`
- Test: `test/output/affiliate-link.test.ts`, `test/worker/webhook.test.ts`

**Interfaces:**
- Produces:

```ts
export function parseAffiliateLink(text: string): { ok: true; link: string } | { ok: false; reason: "empty" | "not_single_url" | "not_https" | "wrong_host" };
export type WebhookReply = { method: "sendMessage"; chat_id: number; text: string; reply_to_message_id: number };
export function handleTelegramUpdate(deps: { db: SqlClient; ownerChatId: string; now: () => Date }, update: unknown): Promise<WebhookReply | null>;
```

`parseAffiliateLink`: trim surrounding whitespace; the rest must contain no whitespace, start with `https://`, and its hostname (lower case) must equal `meli.la`; `link` is that exact substring. `handleTelegramUpdate`: `message.chat.id` not the owner → `null`, nothing saved. Not a reply, or reply to a message that is no candidate's `telegram_mensaje_id` → help reply. Candidate of a previous ART day → `Ese candidato es de otro día y ya no se puede publicar.` Text `rechazar` (case-insensitive, trimmed) → candidate `descartado` and every `emparejados` row of its `modelo_id` with the rivals' (`tienda`, `ref_externa`) set to `rechazado`; reply `Descartado: <titulo>. No se volverá a proponer.` Valid link on a `pendiente` or `elegido` candidate → `estado = 'elegido'`, `enlace_afiliado = link`; reply `Enlace guardado para <titulo>. Se publica tras revalidar el precio.` Other states → `Este candidato ya está <estado>; no se cambió nada.` Invalid link → `No se guardó el enlace: <reason in Spanish>. Debe ser un único enlace https://meli.la/...` The reply is returned as the webhook HTTP response body (no subrequest).

- [ ] **Step 1: Write the failing tests**

```ts
expect(parseAffiliateLink("  https://meli.la/2AbC_xY?r=1/  ")).toEqual({ ok: true, link: "https://meli.la/2AbC_xY?r=1/" });
expect(parseAffiliateLink("https://MELI.LA/Xy")).toEqual({ ok: true, link: "https://MELI.LA/Xy" });   // stored as typed
it.each([
  ["Acá está: https://meli.la/x", "not_single_url"],
  ["https://meli.la/a https://meli.la/b", "not_single_url"],
  ["http://meli.la/x", "not_https"],
  ["https://www.meli.la/x", "wrong_host"],
  ["https://meli.la.evil.com/x", "wrong_host"],
  ["https://xmeli.la/x", "wrong_host"],
  ["https://articulo.mercadolibre.com.ar/MLA-1", "wrong_host"],
  ["", "empty"],
])("rejects %s", ...);                                                                 // Review Focus 1
// webhook: reply with link → candidatos row elegido, enlace_afiliado byte-equal (Buffer compare) to the input substring
// webhook: update from another chat → null, row unchanged
// webhook: reply to yesterday's candidate → explanation, row unchanged                 // Review Focus 2
// webhook: message that is not a reply → help text, nothing changed
// webhook: "Rechazar" → candidato descartado, emparejados rows rechazado
// webhook: link on a validado candidate → "ya está validado", unchanged
```

- [ ] **Step 2: Run them.** → FAIL. **Step 3: Implement.** **Step 4: Run them.** → PASS.
- [ ] **Step 5: Commit** `git add src/output/affiliate-link.ts src/worker/webhook.ts fixtures/telegram test/output/affiliate-link.test.ts test/worker/webhook.test.ts && git commit -m "feat: accept affiliate links and rejections through the bot webhook"`

---

### Task 8: Publication routine

**Files:**
- Create: `src/output/publish/messages.ts`, `src/worker/publish.ts`
- Test: `test/output/publish/messages.test.ts`, `test/worker/publish.test.ts`

**Interfaces:**
- Consumes: `TelegramClient`, `isInvalidFileId`, `SqlClient`, Task 2 formatters.
- Produces:

```ts
export function buildChannelCaption(c: Candidate, link: string): string;   // ≤ 1024
export function buildXPost(c: Candidate, link: string): string;             // ≤ 280 with the link counted as 23
export type PublishReport = { published: string[]; failed: string[]; stale: string[] };
export function publishValidated(deps: { db: SqlClient; telegram: TelegramClient; channelId: string; ownerChatId: string; now: () => Date; afterPublish: () => Promise<void> }): Promise<PublishReport>;
```

Channel caption: `<titulo>`, `<formatPct>% menos en Mercado Libre: <formatArs(ml)>`, one line per rival `<Tienda>: <formatArs>`, `Diferencia: <formatArs>`, the link verbatim, a blank line, `AFFILIATE_LEGEND`. X post: `<truncate(titulo)>: <formatPct>% menos en Mercado Libre que en <Tienda de otras[0]> (<formatArs(ml)>). <link> Enlace de afiliado.`

`publishValidated`: select today's candidates with `estado = 'validado'`, `validado_en` ≥ now − 30 min, `enlace_afiliado` and `telegram_file_id` not null, and no `salidas` row with `canal = 'telegram_canal'`. Per candidate: claim with `UPDATE candidatos SET estado = 'publicado' WHERE id = ? AND estado = 'validado'` and continue only if `changes = 1`; `sendPhoto` to the channel by `fileId`, one retry; success → `INSERT INTO salidas (..., 'telegram_canal', message_id, now)`, then `sendPhoto` to the owner with the same `fileId` and caption `buildXPost` plus `INSERT INTO salidas (..., 'x_manual', ...)`; failure → revert to `validado`, owner alert `No se pudo publicar <titulo> en el canal. Queda validado y se reintenta en la próxima revalidación.`; invalid `file_id` → also `telegram_file_id = NULL`. `validado` older than 30 minutes → `stale` (left for revalidation). If anything was published, `await afterPublish()`. At most 10 candidates per call; worst case 10 × (2 channel attempts + 1 owner message) + 1 alert stays under 50 subrequests if V-O2 says D1 queries do not count; if they do, batch the reads into one query and record it.

- [ ] **Step 1: Write the failing tests**

```ts
// buildChannelCaption contains the link byte-equal, AFFILIATE_LEGEND, "17,5% menos en Mercado Libre: $329.999"
// buildXPost with the three-rival 120-char title → weighted length ≤ 280, link intact                  // Review Focus 3
// publishes only validado within 30 minutes; a 31-minute-old one is reported stale and not sent
// running publishValidated twice concurrently (Promise.all) → exactly one channel sendPhoto per candidate // Review Focus 4
// a candidate already in salidas telegram_canal is never sent again
// channel failure twice → estado back to validado, owner alerted, no salidas row
// invalid file_id → telegram_file_id NULL, owner alerted
// owner receives the X material (sendPhoto to owner chat with buildXPost caption) and a salidas x_manual row
// afterPublish called once when at least one candidate was published, never when none
```

- [ ] **Step 2: Run them.** → FAIL. **Step 3: Implement.** **Step 4: Run them.** → PASS.
- [ ] **Step 5: Commit** `git add src/output/publish src/worker/publish.ts test/output/publish test/worker/publish.test.ts && git commit -m "feat: publish validated candidates to the channel once"`

---

### Task 9: Worker routes, cron triggers and missing-run notice

**Files:**
- Create: `src/worker/missing-run.ts`, `src/worker/auth.ts`
- Modify: `src/worker/index.ts`, `wrangler.toml`
- Test: `test/worker/routes.test.ts`, `test/worker/missing-run.test.ts`, `test/worker/wrangler-config.test.ts`

**Interfaces:**
- Consumes: `handleTelegramUpdate`, `publishValidated`, `createTelegramClient`, `createD1BindingClient`.
- Produces: `checkMissingRun(deps: { db: SqlClient; telegram: TelegramClient; ownerChatId: string; now: () => Date }): Promise<boolean>`; `safeEqual(a: string, b: string): boolean`; `handleScheduled(cron: string, deps): Promise<void>`; routes in `handleFetch`: `POST /telegram/webhook` (header `X-Telegram-Bot-Api-Secret-Token` must equal `TELEGRAM_WEBHOOK_SECRET`, else 401; returns the `WebhookReply` as JSON or an empty 200), `POST /internal/publish-now` (`Authorization: Bearer <PUBLISH_NOW_SECRET>` checked with `safeEqual`, else 401; runs `publishValidated`, returns the `PublishReport` JSON), `GET /healthz`.

`checkMissingRun`: no `corridas` row with today's ART `fecha` → owner message `Hoy no se recolectó nada. Se puede correr a mano con: imperdibles correr` and `true`; else `false`. `wrangler.toml` `[triggers] crons = ["30 10 * * *", "0 14 * * *"]`; `handleScheduled` maps the first to `checkMissingRun`, the second to `publishValidated`. The cron times are fixed in `wrangler.toml` and mirror `hora_aviso` and `hora_publicacion` in `config`; changing an hour means editing both.

- [ ] **Step 1: Write the failing tests**

```ts
// webhook without or with a wrong secret header → 401, db untouched
// publish-now without Bearer, or with a wrong secret → 401
// publish-now with the right secret → 200 and publishValidated ran
// checkMissingRun: no run today → one owner message, true; a run today (any estado) → no message, false
// checkMissingRun at 2026-11-10T10:30Z with a run whose fecha is 2026-11-09 → message sent
// handleScheduled("0 14 * * *") calls publishValidated; ("30 10 * * *") calls checkMissingRun
// wrangler-config: rg on wrangler.toml finds exactly the two cron strings
```

- [ ] **Step 2: Run them.** → FAIL. **Step 3: Implement.** **Step 4: Run them.** → PASS.
- [ ] **Step 5: Commit** `git add src/worker wrangler.toml test/worker && git commit -m "feat: add Worker routes, cron triggers and missing-run notice"`

---

### Task 10: Local after-revalidation hook

**Files:**
- Create: `src/output/local/after-revalidation.ts`
- Modify: `src/local/output-hooks.ts` (implement `onRevalidated`)
- Test: `test/output/local/after-revalidation.test.ts`

**Interfaces:**
- Consumes: `RevalidationReport`, `TelegramClient`, `renderCardPng`, `loadConfig`, `artTime`.
- Produces: `afterRevalidation(deps: { db: SqlClient; telegram: TelegramClient; ownerChatId: string; render: typeof renderCardPng; fetch: typeof fetch; workerBaseUrl: string; publishSecret: string; now: () => Date }, report: RevalidationReport): Promise<void>`.

Steps: per invalidated → owner message `No se publica <titulo>: el precio cambió y ya no pasa el <umbral>%.` (`below_threshold`) or `No se publica <titulo>: la oferta ya no está disponible.` (`offer_missing`). Per today's `validado` with `telegram_file_id IS NULL` → render from the current payload, `sendPhoto` to the owner with caption `Tarjeta actualizada: <titulo>`, store the new `file_id`. Then, if `artTime(now) >= config.hora_publicacion`, `POST <workerBaseUrl>/internal/publish-now` with the Bearer secret (one call; a failure becomes an owner message). Before the publication hour, do nothing more: the 11:00 cron publishes.

- [ ] **Step 1: Write the failing test:** invalidated → two owner messages with the texts above; a validado without `file_id` is re-uploaded and stored; at 10:45 ART publish-now is not called; at 12:45 ART it is called once with `Authorization: Bearer <secret>`; publish-now 500 → owner message, no throw.
- [ ] **Step 2: Run it.** → FAIL. **Step 3: Implement.** **Step 4: Run it.** → PASS.
- [ ] **Step 5: Commit** `git add src/output/local/after-revalidation.ts src/local/output-hooks.ts test/output/local && git commit -m "feat: re-upload cards and trigger late publication after revalidation"`

---

### Task 11: Deploy, webhook registration and dry runs

**Files:**
- Create: `scripts/set-webhook.ts`
- Modify: `docs/verification/output.md`
- Test: `test/output/set-webhook.test.ts`

**Interfaces:**
- Produces: `buildSetWebhookParams(baseUrl: string, secret: string): { url: string; secret_token: string; allowed_updates: ["message"]; drop_pending_updates: true }` with `url = <baseUrl>/telegram/webhook`.

- [ ] **Step 1: Write the failing test:** `buildSetWebhookParams("https://imperdibles.ar", "s")` equals `{ url: "https://imperdibles.ar/telegram/webhook", secret_token: "s", allowed_updates: ["message"], drop_pending_updates: true }`.
- [ ] **Step 2: Run it.** → FAIL. **Step 3: Implement** the script (calls `setWebhook`, prints Telegram's `description` only). **Step 4: Run it.** → PASS.
- [ ] **Step 5: Owner runs**, with `TELEGRAM_CHANNEL_ID` still pointing to the private test channel (Worker secret and `.env`): `pnpm db:migrate:remote`, `pnpm worker:deploy`, routes the custom domain `imperdibles.ar` to the Worker in the dashboard, `pnpm telegram:set-webhook`. Expected: "Webhook was set".
- [ ] **Step 6: Dry run, at least two mornings before 20/11** (owner): `imperdibles correr --forzar` → shortlist with cards arrives; reply one link and one `rechazar` → both confirmations; `imperdibles revalidar` after 11:00 → the test channel gets the post with the legend and the owner gets the X material; reply to an old message → explanation. Record each result in `docs/verification/output.md` under `V-O5 Dry runs`.
- [ ] **Step 7: Commit** `git add scripts/set-webhook.ts test/output/set-webhook.test.ts docs/verification/output.md && git commit -m "chore: add webhook registration and record dry runs"`

**Milestone (20/11): shortlist, card and Telegram publication work in dry runs.**

---

### Task 12: Page renderer

**Files:**
- Create: `src/output/page/render.ts`, `src/output/html.ts`
- Test: `test/output/page/render.test.ts`

**Interfaces:**
- Produces:

```ts
export function escapeHtml(s: string): string;
export type PageInput = { mode: "today" | "archive" | "none"; fecha: string | null; categoriaNombre: string | null; umbral_pct: number; modelos_comparados: number; items: { candidate: Candidate; enlace_afiliado: string }[]; channelUrl: string };
export function renderHomePage(input: PageInput): string;
```

Markup follows `docs/design/Main.dc.html` and the Design reference: inline styles, Google Fonts link, accent `#C2410C`, sections header, hero, `#hoy`, `#como`, `#canal`, footer. Heading `Los imperdibles de hoy` (`today`) or `Los imperdibles del <formatDateLong>` (`archive`). Threshold strings come from `formatThreshold(umbral_pct)`. Chips `<n> modelos comparados` / `<n> publicados` (singular `1 modelo comparado` / `1 publicado`). Each article lists every rival row then `Diferencia`. Button `Ver en Mercado Libre` with `href` = the stored link (attribute-escaped only) and `rel="sponsored noopener"`. Legend under items: `Precios de lista al <fecha larga>, sin envío ni cuotas.` (or `Precios actuales al ...` per `PRICE_LABEL`). Mode `none` (nothing ever published): hero without eyebrow and chips, section `#hoy` with `Todavía no hay imperdibles publicados.` `<html lang="es">`, `<title>imperdibles.ar</title>`, viewport meta.

- [ ] **Step 1: Write the failing test**

```ts
const html = renderHomePage(inputFrom("valid-2026-11-10.json", "today"));
expect(html).toMatchSnapshot();
expect(html).toContain("Solo publicamos cuando Mercado Libre gana por 15% o más.");
expect(html).toContain("Diferencia de 15% o más");
expect(html).toContain("Los imperdibles de hoy");
expect(html).toContain("Aspiradoras robot · 10 de noviembre de 2026");
expect(html).toContain("9 modelos comparados");
expect(html).toContain(AFFILIATE_LEGEND);
expect(html.match(/rel="sponsored noopener"/g)).toHaveLength(4);
expect(html).toContain('href="https://meli.la/AbC_1?x=1&amp;y=2"');   // link with & stored as https://meli.la/AbC_1?x=1&y=2
expect(renderHomePage({ ...i, umbral_pct: 12.5 })).toContain("gana por 12,5% o más");
expect(renderHomePage({ ...i, mode: "archive", fecha: "2026-11-09" })).toContain("Los imperdibles del 9 de noviembre de 2026");
expect(renderHomePage(noneInput)).toContain("Todavía no hay imperdibles publicados.");
const evil = renderHomePage(withTitle('Robot "S8+" <Negro> & base'));                 // Review Focus 5
expect(evil).toContain("Robot &quot;S8+&quot; &lt;Negro&gt; &amp; base");
expect(evil).not.toContain("<Negro>");
```

- [ ] **Step 2: Run it.** → FAIL. **Step 3: Implement.** **Step 4: Run it.** → PASS.
- [ ] **Step 5: Commit** `git add src/output/page src/output/html.ts test/output/page && git commit -m "feat: render the single page from published candidates"`

---

### Task 13: Page storage, serving and regeneration

**Files:**
- Create: `src/worker/page-store.ts`
- Modify: `src/worker/index.ts` (route `GET /`, pass `afterPublish`)
- Test: `test/worker/page-store.test.ts`

**Interfaces:**
- Consumes: `renderHomePage`, `loadConfig`, `artDate`.
- Produces: `regeneratePages(deps: { db: SqlClient; now: () => Date; channelUrl: string }): Promise<void>`; `servePage(deps: { db: SqlClient; now: () => Date }): Promise<Response>`.

`regeneratePages`: latest ART `fecha` with `publicado` candidates; builds two rows in `paginas`: `hoy:<fecha>` (mode `today`) and `archivo` (mode `archive`, same data); with none ever published, only `archivo` in mode `none`. `servePage`: one query `SELECT clave, html FROM paginas WHERE clave IN (?, 'archivo')` with `hoy:<today>`; serve `hoy:<today>` if present, else `archivo`; no row at all → render mode `none` once and serve it. Headers `content-type: text/html; charset=utf-8`, `cache-control: public, max-age=300`. `publishValidated` gets `afterPublish = () => regeneratePages(...)`.

- [ ] **Step 1: Write the failing test**

```ts
// after publishing on 2026-11-10, GET / at 2026-11-10T15:00Z → "Los imperdibles de hoy"
// same data, GET / at 2026-11-11T12:00Z (no publications that day) → "Los imperdibles del 10 de noviembre de 2026"
// empty database → 200 with "Todavía no hay imperdibles publicados."
// GET / issues exactly one SQL query (spy on SqlClient.all)
```

- [ ] **Step 2: Run it.** → FAIL. **Step 3: Implement.** **Step 4: Run it.** → PASS.
- [ ] **Step 5: Commit** `git add src/worker test/worker/page-store.test.ts && git commit -m "feat: store, regenerate and serve the single page"`

---

### Task 14: Worker CPU budget smoke tests

**Files:**
- Test: `test/worker/cpu-budget.test.ts`

**Interfaces:**
- Consumes: `handleFetch`, `handleScheduled`, `createSqliteClient`, a Telegram fake that resolves immediately.

- [ ] **Step 1: Write the test:** for each of webhook (valid link), `publishValidated` with 10 validated candidates, and `GET /`: 5 warm-up runs, then 20 measured runs with `process.cpuUsage()` deltas (user + system); assert the median is below 8 ms (8000 µs), a cap under the 10 ms free-plan limit. Also assert that `rg -l "cheerio|satori|resvg|better-sqlite3|dotenv|from \"node:" src/worker` finds nothing.
- [ ] **Step 2: Run it.** `pnpm vitest run test/worker/cpu-budget.test.ts`. If it passes immediately, temporarily lower the cap to 0.01 ms, confirm it fails, then restore 8 ms. Expected final: PASS. If a handler exceeds the cap, move its heavy part to the local job (spec §9 fallback), starting with page generation.
- [ ] **Step 3: Owner checks** after the next deploy: dashboard CPU time p99 for `/`, webhook and the 14:00 UTC cron below 10 ms; record in `V-O2`.
- [ ] **Step 4: Commit** `git add test/worker/cpu-budget.test.ts docs/verification/output.md && git commit -m "test: guard Worker handlers against the free-plan CPU limit"`

---

### Task 15: End-to-end run and go-live

**Files:**
- Test: `test/e2e/full-run.test.ts`
- Modify: `docs/verification/output.md`

**Interfaces:**
- Consumes (read only, from the data plan): `runDaily`, `revalidateChosen`, `createReplayFetch`, `fixtures/runs/<date>-aspiradoras-robot/`; from this plan: `createOutputHooks`, `handleFetch`, `handleScheduled`.

- [ ] **Step 1: Write the test:** one sqlite database for everything; `runDaily` with replay fetch and real `createOutputHooks` over a fake Telegram → candidates `pendiente` with `telegram_mensaje_id`; a webhook update replying `https://meli.la/E2e_Test?a=1&b=2` to the first shortlist message → `elegido`; `revalidateChosen` with the same replay → `validado`; `handleScheduled("0 14 * * *")` → one channel post containing the link byte-equal and `AFFILIATE_LEGEND`, one `salidas` row; `GET /` → 200 containing the link (attribute-escaped), `rel="sponsored noopener"` and `15% o más`. With an empty replay listing the page shows `Todavía no hay imperdibles publicados.`
- [ ] **Step 2: Run it.** `pnpm vitest run test/e2e` → PASS (fix only output code; data defects go to the data plan's owner). `pnpm test` → all green.
- [ ] **Step 3: Go live by 24/11 (owner):** declare site, channel and X account in the affiliate program; `pnpm wrangler secret put TELEGRAM_CHANNEL_ID` with the public channel; set `TELEGRAM_CHANNEL_URL` in `wrangler.toml` to the public channel link and `pnpm worker:deploy`; first real morning: shortlist arrives, links pasted, 11:00 post appears, page shows "Los imperdibles de hoy". Record under `V-O6 Go-live`.
- [ ] **Step 4: Commit** `git add test/e2e docs/verification/output.md wrangler.toml && git commit -m "test: add end-to-end run from fixtures to the published page"`

**Milestone (24/11): page live and real publications. From 25/11 only fixes.**

---

## Appendix: Design reference

Copied from `Main.dc.html` and `Tarjeta.dc.html` (accepted design) so the plan stands alone if `docs/design/` is missing. Accent: `#C2410C` (the design also offers `#1D4ED8` and `#0F766E`; not used).

**Colors:** page background `#F4F5F7`; text `#0E1116`; secondary text `#3A4350`; muted `#5B6472`; borders `#DDE1E7`; surfaces `#FFFFFF`; page photo placeholder `#EEF0F3`; card photo placeholder `#E3E6EB`; rival bar `#B4BBC6`; text on the dark channel box `#C9CED6`; dark surfaces and ML bar `#0E1116`; link hover `#3A4350`.

**Fonts:** Inter 400/500/600 (body, `font-size 16px`, `line-height 1.5`), Space Grotesk 500/700 (logo, headings, prices). Page loads `https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;700&display=swap`. Prices use `font-variant-numeric: tabular-nums`.

**Page (max width 1120px, side padding 24px):**
- Header: white, bottom border; logo `imperdibles` + `.ar` in accent (Space Grotesk 700, 24px, letter-spacing -0.02em); nav `aria-label="Principal"`: `Hoy` (`#hoy`), `Cómo elegimos` (`#como`), `Canal de Telegram` (`#canal`, pill with 1px `#0E1116` border).
- Hero (padding 72px 24px 56px, gap 24px): eyebrow `<Categoría> · <fecha larga>` (14px, 600, uppercase, letter-spacing 0.08em, accent); h1 `Solo publicamos cuando Mercado Libre gana por <umbral>% o más.` (Space Grotesk 700, `clamp(2.25rem, 5vw, 4rem)`, line-height 1.05, max width 880px); lead `Comparamos el mismo modelo en otras tiendas. Si la diferencia es chica, el producto no aparece.` (19px, `#3A4350`, max width 640px); chips `<n> modelos comparados` (white, bordered) and `<n> publicados` (`#0E1116` background, white text), radius 999px.
- `#hoy`: h2 `Los imperdibles de hoy` (Space Grotesk 700, 28px). Cards `flex: 1 1 460px`, white, border, radius 16px, padding 20px: placeholder 140x140 radius 12px `Foto del producto` (`role="img"`, `aria-label="Foto del producto pendiente"`, 12px muted); h3 title 18px 600; badge `<pct>% menos` (accent background, white, 14px 600, pill); ML price (Space Grotesk 700, 34px) + `en Mercado Libre` (14px muted); top-bordered rows `<Tienda>` / price (15px, `#3A4350`) and `Diferencia` / amount (600); button `Ver en Mercado Libre` (`#0E1116`, white, radius 10px, min height 44px). Note under cards: `Precios de lista al <fecha larga>, sin envío ni cuotas.` (14px muted).
- `#como` (white band, borders top and bottom, padding 64px 24px): h2 `Cómo elegimos`; three columns numbered `1` `2` `3` in accent: `El mismo modelo exacto` / `Se compara el mismo modelo en Mercado Libre y en otras tiendas, no uno parecido.`; `Diferencia de <umbral>% o más` / `Con una diferencia menor, el producto no se publica.`; `Precio y fecha a la vista` / `Cada comparación muestra los dos precios y el día en que se tomaron.`
- `#canal`: dark box (`#0E1116`, radius 20px, padding 40px): h2 `Los imperdibles del día, en Telegram`; `Un aviso por cada producto que pasa el filtro. Nada más.` (`#C9CED6`); white pill button `Abrir el canal` with a 20px paper-plane SVG (`<path d="M22 2 11 13"></path><path d="M22 2 15 22l-4-9-9-4 20-7z"></path>`, stroke currentColor, width 2).
- Footer (14px muted): `Los enlaces a Mercado Libre son de afiliado: recibimos una comisión por cada compra, sin costo adicional.` and `imperdibles.ar no pertenece a Mercado Libre ni a las tiendas comparadas.`

**Card (1200x675, padding 56px 64px, background `#F4F5F7`, column, space-between):**
- Top row: logo `imperdibles` + `.ar` accent (Space Grotesk 700, 30px); badge `<pct>% menos` (accent, white, Space Grotesk 700, 30px, padding 10px 22px, pill).
- Middle row (gap 48px): placeholder 260x260 radius 20px `#E3E6EB` with `Foto del producto` (18px, `#5B6472`); column (gap 28px): title (Space Grotesk 700, 46px, line-height 1.1); price rows (gap 14px), each a label/price line plus an 18px bar (radius 999px) with 6px gap: `Mercado Libre` (22px 600) and price (Space Grotesk 700, 44px), bar `#0E1116`; rival `<Tienda>` (22px, `#3A4350`) and price (Space Grotesk 500, 30px, `#3A4350`), bar `#B4BBC6`. Bar width = price / highest price shown (design sample: 82.5% and 100%).
- Bottom row (20px, `#3A4350`): `Mismo modelo, precio de lista al <dd/mm/aaaa>` and `Diferencia: $<monto>` (600, `#0E1116`).

Sample values in the design (`19,8%`, `17,1%`, `15,1%`) are rounded mock numbers; the build follows the spec's truncation (`19,7%`, `17,0%`, `15,0%` for the same prices).
