# Output side verification log

Entries marked PENDING OWNER are filled in only from results the owner pastes.

Prerequisites before any deploy step (see `docs/env.md`, "Owner step: create the D1 database"):

```
pnpm wrangler login
pnpm wrangler d1 create imperdibles
# put the real database_id in wrangler.toml and in D1_DATABASE_ID (.env)
pnpm db:migrate:remote
pnpm wrangler secret put TELEGRAM_BOT_TOKEN
pnpm wrangler secret put TELEGRAM_OWNER_CHAT_ID
pnpm wrangler secret put TELEGRAM_CHANNEL_ID
pnpm wrangler secret put TELEGRAM_WEBHOOK_SECRET
pnpm wrangler secret put PUBLISH_NOW_SECRET
```

## V-O1 Telegram file_id reuse

- Status: PENDING OWNER.
- Check: owner creates a private test channel, adds the bot as admin, puts its id in `.env` as `TELEGRAM_CHANNEL_ID`, then runs `pnpm verify:telegram`. Expected last line: `file_id reuse: ok` (otherwise the Telegram `description` is printed).
- Result: PENDING OWNER.
- Fallback named by the spec: on a rejected `file_id` the local job re-uploads the PNG (Task 10). If reuse never works, stop and ask the owner.

## V-O2 Worker CPU and D1 subrequests

- Status: PENDING OWNER (CPU measurement); limits looked up 2026-11-10.
- Check: owner runs `pnpm worker:deploy` after the prerequisites above, opens `/healthz` 20 times and reads CPU time per invocation in the Cloudflare dashboard (Workers, imperdibles, Metrics).
- Limits (Cloudflare docs, developers.cloudflare.com/workers/platform/limits and developers.cloudflare.com/d1/platform/limits, read 2026-11-10):
  - Free plan: 50 subrequests per invocation. D1 queries count toward that budget (the docs define a subrequest as any Fetch API call or call to Cloudflare services such as R2, KV or D1).
  - D1 Free plan: 50 queries per Worker invocation (same limit as the subrequests). `db.batch()` counts as a single query, not one per statement.
  - CPU: 10 ms per HTTP request and per Cron Trigger; time waiting on network or D1 does not count.
  - Consequence: Fetch plus D1 calls together must stay under 50 per invocation (Telegram calls included); prefer batched or single-statement writes.
- Result (CPU per invocation): PENDING OWNER.
- Fallback named by the spec: move the step that does not fit to the local job (page generation first).

## V-O3 X API

- Status: PENDING OWNER.
- Check: owner checks the free tier's posting limits, cost and image upload.
- Result: PENDING OWNER.
- Fallback / default: phase 1 always sends the X material to the owner; automatic posting is out of this plan unless this check passes and the owner asks for it.

## V-O4 Catalog photos

- Status: PENDING OWNER.
- Check: owner confirms whether the affiliate program terms allow catalog photos.
- Result: PENDING OWNER.
- Default: placeholder only ("Foto del producto"); `imagen_url` is ignored.

## V1 price label

- V1 price label: PENDING OWNER. `PRICE_LABEL` in `src/output/copy.ts` is `"lista"` until `docs/verification/data.md` V1 is recorded; switch it there.
