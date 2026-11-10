# Environment variables

Writing `.env.example` was denied by the machine's permission settings, so the variable names live here. Copy them into a local `.env` (git-ignored) and into Wrangler secrets. Values are created by the owner.

```
ML_APP_ID=
ML_CLIENT_SECRET=
ML_REDIRECT_URI=
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
D1_DATABASE_ID=
TELEGRAM_BOT_TOKEN=
TELEGRAM_OWNER_CHAT_ID=
TELEGRAM_CHANNEL_ID=
TELEGRAM_WEBHOOK_SECRET=
PUBLISH_NOW_SECRET=
WORKER_BASE_URL=
```

`ML_REDIRECT_URI` takes the value `https://imperdibles.ar`.

## Owner step: create the D1 database

`wrangler.toml` holds the placeholder `REPLACE_WITH_D1_DATABASE_ID`. Run once, then paste the printed `database_id` into `wrangler.toml` and into `D1_DATABASE_ID`:

```
pnpm wrangler login
pnpm wrangler d1 create imperdibles
pnpm db:migrate:remote
```

Expected: wrangler reports `0001_initial.sql` and `0002_seed.sql` applied.
