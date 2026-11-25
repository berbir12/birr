# Deploying Birr: Vercel + Supabase

Birr runs entirely on free tiers, with nothing running at home:

- **Vercel** (Hobby plan) hosts the Mini App, plus one serverless function that handles the API, the
  Telegram bot (webhook mode), `/ingest/sms` and a daily cron. You get `https://<project>.vercel.app`.
- **Supabase** (free plan) is the Postgres database. Birr's tables live in a private `birr` schema with
  row-level security on, so Supabase's public Data API can't read them. Only the Birr function connects,
  using the connection string stored in Vercel.

```
iPhone Shortcut ─► https://<project>.vercel.app/ingest/sms ┐
Telegram ────────► https://<project>.vercel.app/telegram/…  ├─► Vercel function (fra1) ─► Supabase Postgres (Frankfurt)
Mini App ────────► https://<project>.vercel.app/             ┘
```

Every push to `main` deploys automatically. Production builds also run database migrations and register
the Telegram webhook. Preview builds touch neither.

## What stays private

- Raw SMS are encrypted (AES-256-GCM) with `DATA_ENCRYPTION_KEY`, which exists only in Vercel's
  environment settings. Supabase never sees it.
- Account numbers are stored masked to the last 4 digits.
- Transaction details (amounts, names, categories) are stored as plain columns in Supabase, so they can
  be searched and summed.
- Logs never contain SMS text or query values; errors are logged as type and code only.

## 1. Telegram

1. @BotFather → `/newbot`. Keep the token for step 3.
2. Get your numeric ID from **@userinfobot**.
3. For local development, also create a **second, test bot**. The production bot runs in webhook mode,
   and local dev refuses to take it over.

## 2. Supabase

1. Sign up at https://supabase.com → **New project**.
   - **Region:** Central EU (Frankfurt), next to the Vercel function.
   - **Database password:** generate a strong one and save it in your password manager.
2. Once it's ready, click **Connect** (top of the dashboard) → **Transaction pooler**. Copy the URI:

   ```
   postgresql://postgres.<ref>:<password>@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
   ```

   Replace `[YOUR-PASSWORD]` with the password from step 1. This is your `DATABASE_URL`.
3. Recommended: Birr doesn't use Supabase's auto-generated REST API, so turn it off under
   **Project Settings → Data API** (disable the Data API, or make sure `birr` isn't in the exposed schemas).

Free-plan notes:

- 500 MB is many years of SMS for one person.
- Supabase pauses free projects after about a week with no activity. Daily SMS and the daily cron should
  keep yours active.
- The free plan has no downloadable backups. Birr's own JSON export, coming in a later phase, covers that.

## 3. Vercel

1. Sign up at https://vercel.com with GitHub → **Add New… → Project** → import `berbir12/birr`, and
   grant Vercel access to the private repo when asked.
2. **Project name** becomes your URL: e.g. `birr-tracker` gives `https://birr-tracker.vercel.app`.
   Leave Framework Preset as **Other** and Root Directory as `./`. The build and install commands come
   from `vercel.json`.
3. **Before the first deploy**, open **Environment Variables** and add these with **only Production**
   ticked (untick Preview and Development):

   | Name | Value |
   |---|---|
   | `BOT_TOKEN` | from BotFather (production bot) |
   | `ALLOWED_TELEGRAM_IDS` | your numeric id |
   | `DATABASE_URL` | the Supabase transaction-pooler URI |
   | `DATA_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
   | `TELEGRAM_WEBHOOK_SECRET` | `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` |
   | `CRON_SECRET` | `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` |
   | `PUBLIC_URL` | `https://<project>.vercel.app` |
   | `MINIAPP_URL` | `https://<project>.vercel.app` (same) |
   | `BOT_MODE` | `webhook` |
   | `NODE_ENV` | `production` |

   Generate the three secrets on your PC and paste them straight into Vercel. **Also save
   `DATA_ENCRYPTION_KEY` in your password manager.** Without it the encrypted raw SMS can't be read.
4. Click **Deploy**. The build log should end with:

   ```
   ==> Migrations
   Migrated postgresql://***@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
   ==> Telegram webhook + commands
   [setup] @your_bot → https://<project>.vercel.app/telegram/webhook
   ==> Done (production build)
   ```

   A missing or invalid variable fails the build with a message naming it. Nothing half-deploys.
5. Open `https://<project>.vercel.app/health`. It should show `{"ok":true}`.
6. **Settings → Deployment Protection:** keep the default (Standard Protection, which covers previews
   only). Protecting production would block Telegram and your iPhone.

## 4. Finish in Telegram

1. Send `/start` to the bot and tap **📊 Open Birr**. You should see "Selam … you're signed in".
2. Menu button: @BotFather → `/mybots` → your bot → **Bot Settings** → **Menu Button** → send
   `https://<project>.vercel.app` and the title `Birr`.
3. Send `/connect` and set up the iPhone automation with [SETUP.md](SETUP.md).

## Updating

`git push` to `main`. Vercel builds, migrates, re-registers the webhook and switches traffic once the
build succeeds. If anything goes wrong, **Deployments → ⋯ → Instant Rollback** restores the previous
version. Migrations only ever add to the schema, so a rollback is safe.

## Daily cron

`config.json` schedules `GET /cron/daily` at 18:00 UTC (21:00 Addis). Vercel authenticates it with
`CRON_SECRET`. It cleans up rate-limit counters and expired bot prompts now; the daily digest and alerts
will be added there in a later phase. You can see it under **Settings → Cron Jobs**.

## Troubleshooting

| Symptom | Check |
|---|---|
| Build fails at "Migrations" | `DATABASE_URL` is wrong (password, or the `[YOUR-PASSWORD]` placeholder left in). If migrations time out on the transaction pooler, add `MIGRATION_DATABASE_URL` with the **Session pooler** URI (port 5432). |
| Build fails at "Telegram webhook" | `BOT_TOKEN` is wrong, or `PUBLIC_URL` isn't `https://`. |
| Bot doesn't answer | Vercel → **Logs** (filter `/telegram`). `curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo` shows `last_error_message`. Is your ID in `ALLOWED_TELEGRAM_IDS`? |
| `401` on everything from Telegram | Deployment Protection is on for production. Turn it off for the production domain. |
| Mini App says "Could not reach the server" | `PUBLIC_URL` and `MINIAPP_URL` must equal the production URL exactly. Redeploy after changing variables. |
| Supabase project paused | Supabase dashboard → **Restore project**. |
