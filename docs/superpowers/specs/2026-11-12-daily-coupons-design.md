# Daily Mercado Libre coupons — design

Date: 2026-11-12
Status: draft, pending owner approval

## Intent

Bring visitors who search for things like "cupones mercado libre hoy" and turn them into affiliate sales. Mercado Libre's official affiliates Telegram channel ("Afiliados y Creadores Mercado Libre Argentina", linked from the affiliate panel) posts affiliate-exclusive coupon codes almost every day and asks affiliates to share them with their audience. Other sites (e.g. r/CuponesML) already republish this kind of code and get traffic from it.

A coupon code by itself earns nothing. Mercado Libre attributes the sale through the affiliate link, not the code. So every coupon we show must send the visitor to Mercado Libre through the owner's affiliate link.

Success: within an hour of Mercado Libre posting a coupon in the affiliates channel, it appears on `/cupones` and in the owner's public Telegram channel, with no manual step. The visitor copies the code and lands on Mercado Libre through the owner's link in one tap.

## Goals

- A `/cupones` page that shows only the coupons that are valid right now. For each coupon it shows the code, the discount (fixed ARS amount or %), the minimum purchase, the cap, the scope (all products / a campaign / a brand) and when it expires.
- A "Usar" button on each coupon. It copies the code to the clipboard and opens Mercado Libre through the owner's fixed affiliate link.
- Automatic ingestion from the official affiliates channel, with no owner approval. The owner decided this because the source is official.
- Each new coupon is posted once to the owner's public Telegram channel.
- The owner gets a private notice for each published coupon and can take it down by replying `rechazar`.

## Non-goals

- Per-coupon or per-campaign affiliate links. One fixed link serves every coupon (see Constraints).
- Reading any source other than the official affiliates Telegram channel. That excludes the WhatsApp channel, Reddit and the ML `/cupones` page.
- Personal or account-bound coupons.
- Posting coupons to X.
- An archive or history of past coupons (can come later for SEO; nothing here should block it).

## Anti-goals (failure even if it works)

- Showing an invented or misread code. A code that does not appear literally in the source post must never be published.
- Showing an expired coupon as valid.
- Posting the same coupon twice to the Telegram channel. Mercado Libre often reposts "siguen vigentes" reminders.
- Any link that was built or altered by the system (affiliate terms, clauses 6.3 and 2.4).
- A coupon post in the channel or on the site without the mandatory affiliate legend.
- Leaking the Telegram user session. It gives full access to the owner's Telegram account.
- Coupon ingestion failures breaking or delaying the existing `revalidar` → `ship` flow for deals.

## Constraints

- **Affiliate links:** the owner generates one `meli.la` link once in the panel's link generator and stores it verbatim in config. The system never builds or changes it. Where it points (ML home or `/cupones`) is the owner's choice when they generate it.
- **Reading the channel:** a bot cannot join or read the affiliates channel, because only the channel admins (Mercado Libre) can add bots. Reading needs an MTProto user client with the owner's account. Use GramJS (`telegram` on npm) so it stays TypeScript. It runs only on the owner's Mac. The session string, `api_id` and `api_hash` live in the local `.env` and never go to the Worker, CI or git.
- **Schedule:** coupon reading runs inside the existing local `revalidar` launchd job (10:45, then hourly at :45 until 19:45 ART). It does not get its own job. In the owner's export, 98 of 232 coupon posts arrive between 09:00 and 10:59, and the rest spread through 11:00–18:59. If the Mac is off, no coupons come in. The deal flow already has this same dependency.
- **Site freshness:** the site is static Astro, rebuilt only by `ship`. It reads D1 over HTTP at build time.
- Worker limits from `docs/verification/output.md` still apply to anything added to the Worker.
- UI copy is in Spanish. Times are in ART (`src/shared/time.ts`).

## Source data (observed in the owner's export, 2025-07-17 → 2026-11-12)

- Posts are free text with emojis. One post often holds several coupons ("escalas"). Example: `🎟️ Cupón: CYBERALMAX 💰 $20.000 OFF 🛍️ Compra mínima de $250.000` plus a second code with $45.000 OFF from $500.000.
- Discount: a fixed amount ("$20.000 OFF") or a percentage with a cap ("10% OFF … tope de reintegro $5.250").
- Validity takes many forms: "hasta las 00h", "Válido hasta el 08/09", "Del 2 al 9 de noviembre", or windows such as "De 12 a 15hs" (Glam Days). Some posts give no validity at all.
- Scope: "todos los productos (excepto alimentos, bebidas y medicamentos)", "productos seleccionados", a brand (Puma, New Balance), or a campaign (Glam Days, with a listing URL).
- Reminder posts ("Siguen vigentes estos cupones") repeat codes that were already posted.
- Many posts carry no code at all (product recommendations, tips).

## Decided how

1. **Fetch.** During `revalidar`, the GramJS client reads the channel messages newer than the last processed message id. That id is stored in D1 `config`. On the first run it reads only today's messages.
2. **Extract.** Each post with text goes through an LLM extraction (my call: Claude Haiku via the Anthropic SDK, which adds a new dependency and an `ANTHROPIC_API_KEY` in the local `.env`). The extraction returns zero or more coupons with: code, discount type and value, minimum purchase, cap, scope text, `valid_from`, `valid_until`. The result is validated with zod.
3. **Guard.** Drop any extracted code that does not appear literally (case-sensitive, as a whole token) in the post text. Reject values that fail validation, such as a negative amount or `valid_until` before `valid_from`.
4. **Expiry defaults** (my call): with no validity in the post, `valid_until` is 23:59 ART of the post's day. "hasta las 00h" means 23:59 of that day. A time window ("De 12 a 15hs") sets both `valid_from` and `valid_until`. With no start, `valid_from` is the post time.
5. **Store.** A new D1 table `coupons`, added through a new migration. One row per code plus validity, so a reminder repost of the same code with the same validity is a no-op. Columns include the source message id, `status` (`published`, `removed`), the channel message id and timestamps.
6. **Publish to the channel.** Each newly stored coupon is sent once as a text message to `TELEGRAM_CHANNEL_ID`, with the code, the conditions, the validity, the fixed affiliate link and `AFFILIATE_LEGEND`. Claim before sending, like `publishValidated`, so a concurrent or repeated run cannot double-post.
7. **Notify the owner.** A private message per published coupon, quoting the source post next to what was extracted.
8. **Take down.** The owner replies `rechazar` to that notice. The Worker webhook marks the coupon `removed` and deletes the channel message. This extends `src/worker/webhook.ts`, which today only matches candidate messages.
9. **Rebuild.** When the set of currently valid coupons changed during the run (new, expired or removed), `revalidar` runs `ship --site-only`. It skips this if the deal flow already ran `ship` in the same run.
10. **Page.** `site/` gets `/cupones`, built from coupons with `status='published'` and `valid_until` in the future at build time. Each card carries its `valid_from`/`valid_until`. A small inline script hides cards outside their window in the visitor's browser, so a coupon that expires between rebuilds stops showing. The page always has static content explaining how to use a coupon, so it never renders empty. The empty state says there are no coupons right now. The page is linked from the home and listed in the sitemap.

## Settled after the builder review (my calls)

- **Where it runs.** The coupon step is a new `src/local` module called from the `revalidar` process, after the deal work. It publishes from the Mac straight to the Bot API, using the existing `TelegramClient` and the local bot token. It claims rows over D1 HTTP with a conditional `UPDATE`, the same pattern as `publishValidated`. It adds no new Worker endpoint or secret.
- **Dedupe key: the code.** If a code arrives while a row with that code is still valid at the post time, nothing is posted again. If the reminder gives a later `valid_until`, the row is extended. A code that comes back after its previous row expired is a new coupon and gets posted. This keeps multi-day "siguen vigentes" reminders from double-posting.
- **Guard covers numbers too.** Besides the code, the discount, minimum and cap must each appear as a number in the post text. A number may be written with or without thousands separators. A coupon that fails any check is not published. It goes to the owner as "no publicado" together with the source text.
- **Extraction failures.** The cursor does not move past a post whose extraction call failed (network, API or invalid JSON). That post is retried on the next runs, up to 3 attempts counted in D1. After that it is skipped and the owner is notified. Posts after it are still processed in the same run.
- **Take-down lookup.** `coupons` stores the owner-notice message id. The webhook tries candidates first and coupons second. A `rechazar` that matches neither is ignored, as it is today.
- **Rebuild trigger.** `config` stores a fingerprint of the coupon ids that were valid and published at the last build. `revalidar` recomputes it for "now" and runs `ship --site-only` when it differs.
- **Affiliate link storage.** D1 `config` key `coupons_affiliate_link`, set once by the owner with a CLI command (`imperdibles cupones-link <url>`). That command accepts only a `https://meli.la/...` link, parsed by the existing `src/output/affiliate-link.ts`. Both the local job and the site build can read it from D1. Until it is set, coupons are stored but neither posted nor shown, and the owner is told why.
- **First run.** Read only messages from today in ART.

## Calls I made (owner can override)

- LLM extraction instead of regex, because the posts' formats vary a lot. This adds the Anthropic SDK and an API key. The cost is a few cents a month at roughly 10 posts a day.
- Expiry defaults from step 4.
- A coupon removed with `rechazar` leaves the site at the next rebuild (at most about an hour), not immediately. The Worker cannot trigger a rebuild today.
- Brand- and campaign-scoped coupons are published too, with their scope text shown. They still use the single fixed link.

## Left to the builder

- Exact table columns, indexes and the migration number.
- The extraction prompt and the zod schema shape.
- The one-time GramJS login script (to produce the session string) and how it is documented in `docs/env.md`.
- Card layout and copy on `/cupones`, following the existing design and `DealCard.astro`.
- The text format of the channel post and the owner notice, within the 4096-character message limit.
- Error handling: a failed fetch or extraction is logged and reported to the owner, never thrown into the deal flow.
- Tests mirroring `src/` in `test/`, with fixtures taken from real posts in the export.
