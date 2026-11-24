# Running Birr on your Windows PC

No VPS, no Docker, no domain to buy. Birr runs in the background on this PC and starts automatically when
Windows boots, even before you log in. **Tailscale Funnel** gives it a free, permanent HTTPS address that
your iPhone and Telegram can reach.

```
iPhone Shortcut ──► https://<pc>.<tailnet>.ts.net/ingest/sms ─┐
Telegram Mini App ─► https://<pc>.<tailnet>.ts.net/            ├─► Tailscale Funnel ─► 127.0.0.1:8787 (Birr on this PC)
Telegram bot ◄──── long polling (outbound only) ──────────────┘
```

**The PC must be on, awake and online whenever an SMS arrives.** If it's asleep or off, your iPhone's
forward fails and iOS does not retry it, so that transaction is missing until you paste it into the bot.
Step 6 turns off sleep, and a UPS helps with power cuts.

## 1. What you need

- This repo at `C:\Users\HP\financial_tracker`, plus Node ≥ 22, pnpm and git. You already have these.
- A bot from **@BotFather** (`/newbot`) and its token.
- Your numeric Telegram ID. Send any message to **@userinfobot** to get it.
- A free **Tailscale** account (sign in with Google, Microsoft or GitHub).

## 2. Tailscale Funnel (the public HTTPS address)

1. Install Tailscale for Windows from https://tailscale.com/download/windows and sign in.
2. Optional, for a nicer URL: in the admin console (https://login.tailscale.com/admin/machines), open this
   PC → **Edit machine name** → `birr`. Do this before step 3, because the name is part of the URL.
3. In an **Administrator PowerShell**:

   ```powershell
   tailscale funnel --bg 8787
   ```

   The first time, it prints a link to enable HTTPS certificates and Funnel for your tailnet. Open it and
   approve, then run the command again. `--bg` keeps the funnel on across reboots.
4. Get your public URL:

   ```powershell
   tailscale funnel status
   ```

   It looks like `https://birr.tail1234ab.ts.net`. That address forwards to `127.0.0.1:8787`.

## 3. Configure `.env`

In `C:\Users\HP\financial_tracker`:

```powershell
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # → DATA_ENCRYPTION_KEY
notepad .env
```

Set these values, using your own URL, token and ID:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=8787
PUBLIC_URL=https://birr.tail1234ab.ts.net
MINIAPP_URL=https://birr.tail1234ab.ts.net
SERVE_MINIAPP=true
BOT_TOKEN=<from BotFather>
BOT_MODE=polling
ALLOWED_TELEGRAM_IDS=<your id>
DATA_ENCRYPTION_KEY=<generated above>
DATABASE_PATH=../../data/birr.db
```

> **Save `DATA_ENCRYPTION_KEY` in your password manager.** It encrypts the raw SMS in the database and its
> backups. Without it they can't be read.

`.env` is gitignored, so it never gets committed.

## 4. Install the background service

In an **Administrator PowerShell**:

```powershell
cd C:\Users\HP\financial_tracker
.\deploy\windows\birr.ps1 install
```

This builds the Mini App and registers two Scheduled Tasks:

- **Birr**: starts at boot and restarts itself if it crashes. It runs as your user, and no password is stored.
- **Birr Backup**: runs daily at 03:00 and writes to `data\backups`, keeping 14.

The script then starts Birr and waits until it's healthy. Check `https://<your-url>/health` in a browser;
it should show `{"ok":true}`.

## 5. Telegram

1. Send `/start` to your bot and tap **📊 Open Birr**. You should see "Selam … you're signed in".
2. For the menu button next to the message box: @BotFather → `/mybots` → your bot → **Bot Settings** →
   **Menu Button** → send your URL and the title `Birr`.
3. Send `/connect` and set up the iPhone automation with [SETUP.md](SETUP.md).

## 6. Keep the PC awake

Go to Settings → System → Power → **Screen and sleep**, and set "When plugged in, put my device to sleep
after" to **Never**. The screen can still turn off; that's fine. Or, in an Administrator PowerShell:

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```

Windows Update restarts are fine. Birr and Tailscale both come back on their own after a reboot.

## Day-to-day

```powershell
.\deploy\windows\birr.ps1 status     # running? healthy? last backup?
.\deploy\windows\birr.ps1 logs       # live log (no SMS text or secrets are logged)
.\deploy\windows\birr.ps1 restart    # after editing .env                 (Administrator)
.\deploy\windows\birr.ps1 update     # git pull + rebuild + restart       (Administrator)
.\deploy\windows\birr.ps1 backup     # back up now
.\deploy\windows\birr.ps1 stop       # stop until next boot              (Administrator)
.\deploy\windows\birr.ps1 uninstall  # remove the tasks; data is kept    (Administrator)
```

| What | Where |
|---|---|
| Database | `data\birr.db` |
| Backups | `data\backups\` |
| Log | `data\logs\birr.log` (rotates at 10 MB) |

To keep an off-PC copy, copy `data\backups` to OneDrive or a USB drive now and then. Raw SMS stay
encrypted in backups, but transaction details are readable, so keep copies private.

**Restore a backup:** `birr.ps1 stop`, copy `data\backups\birr-<timestamp>.db` over `data\birr.db`, delete
`data\birr.db-wal` and `data\birr.db-shm` if present, then `birr.ps1 start`.

## Developing while Birr is running

`pnpm dev` and the background service would both use port 8787 and the same bot, and Telegram allows only
one polling client per bot. Either:

- run `birr.ps1 stop` first and `birr.ps1 start` when you're done, or
- (better) create a second test bot in @BotFather and put its token in a separate dev env file, so the
  real one keeps running.

## Troubleshooting

| Symptom | Check |
|---|---|
| `status` says NOT RESPONDING | `birr.ps1 logs`. A missing or invalid `.env` value is named in the log. |
| Bot doesn't answer | Is your ID in `ALLOWED_TELEGRAM_IDS`? Is `pnpm dev` also running with the same bot? (The log shows `409 Conflict`.) |
| `https://…ts.net` doesn't load | `tailscale funnel status` should list port 8787. Rerun `tailscale funnel --bg 8787`. Is Tailscale connected (tray icon)? |
| Mini App says "Could not reach the server" | `PUBLIC_URL` and `MINIAPP_URL` must both be your `https://…ts.net` URL, then run `birr.ps1 restart`. |
| iPhone forwards fail | Open `https://<url>/health` on the phone. If it doesn't load, the PC is asleep or offline, or the funnel is off. |
