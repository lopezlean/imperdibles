# Environment variables

Writing `.env.example` was denied by the machine's permission settings, so the variable names live here. Copy them into a local `.env` (git-ignored) and into Wrangler secrets. Values are created by the owner.

```
ML_APP_ID=
ML_CLIENT_SECRET=
ML_REDIRECT_URI=
D1_ACCOUNT_ID=
D1_API_TOKEN=
D1_DATABASE_ID=
TELEGRAM_BOT_TOKEN=
TELEGRAM_OWNER_CHAT_ID=
TELEGRAM_CHANNEL_ID=
TELEGRAM_WEBHOOK_SECRET=
PUBLISH_NOW_SECRET=
WORKER_BASE_URL=
SITE_URL=https://imperdibles.com.ar
TELEGRAM_CHANNEL_URL=
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=
TELEGRAM_API_ID=
TELEGRAM_API_HASH=
TELEGRAM_SESSION=
TELEGRAM_SOURCE_CHANNEL_ID=
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=
```

`ML_REDIRECT_URI` takes the value `https://imperdibles.com.ar`.

`D1_ACCOUNT_ID` and `D1_API_TOKEN` are used by the local job to reach D1 over the REST API. The token needs only `Account → D1 → Edit`. They are deliberately not named `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN`: Wrangler reads those from `.env` and would use the D1-only token instead of `wrangler login`, so `wrangler deploy` would fail with "No access to the specified service".

## Owner step: create the D1 database

`wrangler.toml` already holds the real `database_id`. Run once on a fresh account (otherwise skip), then paste the printed `database_id` into `wrangler.toml` and into `D1_DATABASE_ID`:

```
pnpm wrangler login
pnpm wrangler d1 create imperdibles
pnpm db:migrate:remote
```

Expected: wrangler reports `0001_initial.sql` and `0002_seed.sql` applied.

## Owner step: coupon reading

The coupon step reads the official Mercado Libre affiliates channel with your own Telegram user account and extracts coupons with Claude.

1. Create an app at https://my.telegram.org (API development tools) and copy its `api_id` and `api_hash` into the local `.env` as `TELEGRAM_API_ID` and `TELEGRAM_API_HASH`.
2. Run `pnpm telegram:login`. It asks for your phone number, the login code and, if you have one, your 2FA password. It prints one line `TELEGRAM_SESSION=...` and the list of your channels (id and title).
3. Copy `TELEGRAM_SESSION` and the affiliates channel id (`TELEGRAM_SOURCE_CHANNEL_ID`) into the local `.env` only.
4. Set `ANTHROPIC_API_KEY` in the local `.env`. `ANTHROPIC_MODEL` is optional (default `claude-haiku-5-5`).

Warning: the session string gives full access to your Telegram account. Never put it in Wrangler secrets, CI or git. To revoke it, end the session in Telegram under Settings > Devices.

If any of these variables is missing, the coupon step is skipped; the rest of the pipeline is unaffected.

## Static site and deploy

The site is an Astro static build (`dist/site`) served as Workers static assets by the same Worker, on the custom domain `imperdibles.com.ar` (declared in `wrangler.toml`; `workers_dev` is off).

Build-time variables (both required, the build fails without them):

- `SITE_URL=https://imperdibles.com.ar`: canonical base for every page, the sitemap and `robots.txt`.
- `TELEGRAM_CHANNEL_URL`: the public channel link shown on the page. It is no longer a Worker var in `wrangler.toml`.
- `SITE_FIXTURE_DB`: tests only. Points the build at a fixture SQLite file instead of D1.

The build reads D1 over HTTP with `D1_ACCOUNT_ID`, `D1_API_TOKEN` and `D1_DATABASE_ID`.

`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are what `wrangler deploy` uses. On the Mac, either put them in `.env` or authenticate with `wrangler login` (do not point `CLOUDFLARE_API_TOKEN` at the D1-only token, see above). In CI the token is a dedicated one scoped to Workers deploy, D1, and Workers Routes Write for the zone.

### `pnpm run ship`

1. Publish: calls `POST $WORKER_BASE_URL/internal/publish-now` in a loop until a call publishes nothing (hard stop at 10 calls). A publish failure does not stop the site deploy, but `ship` then exits 2 (the owner gets a Telegram alert when the local job ran it).
2. `astro build`.
3. `wrangler deploy`.

Exit codes: 0 success; 1 build or upload failed (it mentions that Telegram posts went out only if some did); 2 the site deployed but a publish call failed (HTTP error, network error, invalid body or the 60 s timeout). `pnpm run ship --site-only` skips step 1. The local revalidation job runs `ship` after revalidating.

### CI: `Deploy site` workflow

Manual (`workflow_dispatch`), one run at a time, runs `pnpm run ship --site-only`. Repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `D1_ACCOUNT_ID`, `D1_API_TOKEN`, `D1_DATABASE_ID`, `SITE_URL`, `TELEGRAM_CHANNEL_URL`. It does not need `WORKER_BASE_URL` or `PUBLISH_NOW_SECRET`.

### Rollout

1. The `imperdibles.com.ar` zone must be on Cloudflare with no conflicting DNS record for the apex. The domain is managed in code (`custom_domain` route), so the first deploy attaches it.
2. From the Mac, with `SITE_URL`, `TELEGRAM_CHANNEL_URL` and the Cloudflare credentials (or `wrangler login`) set: `pnpm run ship`.
3. Right after the custom domain is attached, and before relying on Telegram publishing: `workers_dev = false` takes `imperdibles.lopezlean.workers.dev` offline, so set `WORKER_BASE_URL=https://imperdibles.com.ar` in `.env`, run `pnpm telegram:set-webhook`, and verify `https://imperdibles.com.ar/healthz` answers ok. Until then publishing and the bot webhook still point at the dead workers.dev URL.
4. Add the CI secrets above and run the `Deploy site` workflow once (it runs on Node 24).
5. Submit `https://imperdibles.com.ar/sitemap-index.xml` in Search Console.
6. Only after the new Worker is live: apply `migrations/0005_drop_pages.sql` (drops the unused `pages` table) by hand with `pnpm db:migrate:remote`.
