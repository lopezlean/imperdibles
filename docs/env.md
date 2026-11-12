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
```

`ML_REDIRECT_URI` takes the value `https://imperdibles.com.ar`.

`D1_ACCOUNT_ID` and `D1_API_TOKEN` are used by the local job to reach D1 over the REST API. The token needs only `Account → D1 → Edit`. They are deliberately not named `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN`: Wrangler reads those from `.env` and would use the D1-only token instead of `wrangler login`, so `wrangler deploy` would fail with "No access to the specified service".

## Owner step: create the D1 database

`wrangler.toml` holds the placeholder `REPLACE_WITH_D1_DATABASE_ID`. Run once, then paste the printed `database_id` into `wrangler.toml` and into `D1_DATABASE_ID`:

```
pnpm wrangler login
pnpm wrangler d1 create imperdibles
pnpm db:migrate:remote
```

Expected: wrangler reports `0001_initial.sql` and `0002_seed.sql` applied.

## Optional: automatic affiliate mode

By default (`affiliate_mode = 'manual'`) the owner replies to each Telegram card with a `https://meli.la/...` link. In `auto` mode the link is built from the Mercado Libre product URL by adding `matt_word` and `matt_tool` (the constant per-affiliate values found in a resolved meli.la link). The card then says the candidate already has its link; the owner replies `publicar` to approve, `rechazar` to discard, or a meli.la link to override.

Unverified: that appending these two params credits the affiliate. Check it with one real link before enabling.

Apply the migration, then set the three rows (replace `<word>` and `<tool>`; never commit them):

```
pnpm db:migrate:remote
pnpm wrangler d1 execute imperdibles --remote --command "UPDATE config SET value='<word>' WHERE name='affiliate_word'"
pnpm wrangler d1 execute imperdibles --remote --command "UPDATE config SET value='<tool>' WHERE name='affiliate_tool'"
pnpm wrangler d1 execute imperdibles --remote --command "UPDATE config SET value='auto' WHERE name='affiliate_mode'"
```

Auto mode applies only when the mode is `auto` and both ids are non-empty; otherwise the manual flow runs. To go back: set `affiliate_mode` to `manual`. The mode is read when the shortlist is sent (local job), so it affects the next run only.
