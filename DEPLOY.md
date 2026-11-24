# Deploying Birr to a VPS (no Docker)

Birr runs natively on one small Linux VPS:

- **`birr.service`** (systemd): Node 22 running the API, the Telegram bot (webhook mode) and `/ingest/sms`.
  It listens on `127.0.0.1:8787` only, runs as its own unprivileged `birr` user, and can write only to
  `/var/lib/birr` (the SQLite database and backups).
- **Caddy**: gets the HTTPS certificate automatically, serves the Mini App and proxies the backend.
- **`birr-backup.timer`**: takes a consistent SQLite backup daily at 03:00 Addis time and keeps 14.

```
Internet ──443──► Caddy ──► /api /ingest /telegram /health ──► 127.0.0.1:8787 (birr.service)
                       └──► everything else ──► /opt/birr/apps/miniapp/dist
```

| Path | What |
|---|---|
| `/opt/birr` | the code (git clone, owned by `birr`) |
| `/etc/birr/birr.env` | all configuration and secrets (root:birr, 640) |
| `/var/lib/birr/birr.db` | the database |
| `/var/lib/birr/backups/` | daily backups |
| `/etc/caddy/Caddyfile` | generated from `deploy/Caddyfile.template` |

## Requirements

- Ubuntu 22.04/24.04 or Debian 12, with 1 GB RAM or more and root/sudo access.
- Nothing else using ports 80/443. The installer checks and stops if something is.
- A domain or subdomain whose DNS you control, e.g. `birr.example.com`.
- A bot token from @BotFather and your numeric Telegram ID (from @userinfobot).

## 1. DNS

Create an **A record** `birr.example.com → <VPS IPv4>`, plus AAAA if the VPS has IPv6, and wait until
it resolves:

```sh
nslookup birr.example.com     # must show the VPS IP
```

On Cloudflare, use **DNS only** (grey cloud) at least until the first certificate is issued.

## 2. Install (two runs)

From your PC, in the repo folder:

```sh
ssh root@<vps-ip> 'bash -s -- birr.example.com' < deploy/install.sh
```

Use `sudo bash -s` if you log in as a sudo user instead of root.

**Run 1** installs Node 22, pnpm and Caddy, creates the `birr` user, and prints a **deploy key**. Add it
to GitHub as a read-only deploy key (the script prints how), or from your PC:

```sh
gh repo deploy-key add birr_deploy.pub --repo berbir12/birr --title birr-vps   # paste the key into birr_deploy.pub first
```

**Run 2** (the same command again) clones the repo, builds the Mini App, writes `/etc/birr/birr.env`
with freshly generated secrets, configures Caddy and the firewall, and installs the systemd units.

## 3. Add your bot token and start

```sh
ssh root@<vps-ip>
nano /etc/birr/birr.env          # set BOT_TOKEN=… and ALLOWED_TELEGRAM_IDS=…
systemctl enable --now birr
curl -s https://birr.example.com/health   # {"ok":true}
```

> **Copy `DATA_ENCRYPTION_KEY` from `/etc/birr/birr.env` into your password manager.** Without it the
> encrypted raw SMS in the database and its backups can't be read.

If you also ran Birr on your PC with the same bot, stop it. A bot can't use long polling and a webhook
at the same time.

## 4. Register the Mini App with @BotFather

The **Open Birr** button that `/start` sends already works. To also get the menu button next to the
message box:

1. @BotFather → `/mybots` → your bot → **Bot Settings** → **Menu Button** → **Configure menu button**.
2. Send `https://birr.example.com` and a title, e.g. `Birr`.

Optional: **Bot Settings → Configure Mini App → Enable Mini App** with the same URL.

## 5. Connect your iPhone

Send `/connect` to the bot and follow [SETUP.md](SETUP.md).

## Updating

After pushing to `main`:

```sh
ssh root@<vps-ip> /opt/birr/deploy/update.sh
```

It pulls, installs, rebuilds the Mini App, restarts the service (migrations run on start) and waits for
it to become healthy.

## Day-to-day

```sh
systemctl status birr                    # running?
journalctl -u birr -f                    # live logs (no message bodies or secrets are logged)
systemctl restart birr                   # after editing /etc/birr/birr.env
systemctl list-timers birr-backup.timer  # next backup
systemctl start birr-backup              # back up now
ls -lh /var/lib/birr/backups/
```

Copy backups off the VPS now and then, from your PC:

```sh
scp -r root@<vps-ip>:/var/lib/birr/backups ./birr-backups-$(date +%F)
```

**Restore** a backup:

```sh
systemctl stop birr
cp /var/lib/birr/backups/birr-<timestamp>.db /var/lib/birr/birr.db
rm -f /var/lib/birr/birr.db-wal /var/lib/birr/birr.db-shm
chown birr:birr /var/lib/birr/birr.db
systemctl start birr
```

## Troubleshooting

| Symptom | Check |
|---|---|
| `birr` won't start | `journalctl -u birr -n 50`. The log names any missing or invalid setting in `/etc/birr/birr.env`. |
| Bot doesn't answer | `curl -s https://api.telegram.org/bot<TOKEN>/getWebhookInfo` and look at `last_error_message`. Is your ID in `ALLOWED_TELEGRAM_IDS`? |
| Certificate errors | `journalctl -u caddy -n 50`. Usually DNS isn't pointing at the VPS yet, or a Cloudflare proxy is in front. |
| Mini App says "Could not reach the server" | `PUBLIC_URL` and `MINIAPP_URL` must both be `https://<your domain>`. |
| Installer says ports 80/443 are in use | Another web server (nginx/Apache) is running. Stop or remove it, or ask for a config that runs Birr behind it. |
