# Deploying Birr to a VPS

One small Linux VPS runs two containers:

- `server`: the API, the bot (Telegram webhook mode) and `/ingest/sms`, with SQLite on a Docker volume.
- `web`: Caddy, which gets the HTTPS certificate, serves the Mini App and proxies the backend.

```
Internet ──443──► Caddy ──► /api, /ingest, /telegram, /health ──► server:8787 (not exposed)
                       └──► everything else ──► Mini App static files
```

Requirements:

- A VPS with Ubuntu 22.04/24.04 or Debian 12, 1 GB RAM or more, and ports 80/443 free.
- A domain or subdomain you control, e.g. `birr.example.com`.
- A bot token from @BotFather and your numeric Telegram ID (from @userinfobot).

## 1. Point DNS at the VPS

Create an **A record**: `birr.example.com → <VPS IPv4>`. Add an AAAA record if the VPS has IPv6.
Check it before continuing, because Caddy can't get a certificate until DNS resolves:

```sh
dig +short birr.example.com    # should print the VPS IP
```

If you use Cloudflare, set the record to **DNS only** (grey cloud) for the first certificate. You can turn
the proxy on afterwards with SSL mode "Full (strict)".

## 2. Prepare the server (once)

SSH in as a sudo user, then:

```sh
# Docker Engine + compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

# Firewall: SSH, HTTP, HTTPS only
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp
sudo ufw --force enable
```

## 3. Get the code onto the VPS

The repo is private, so give the VPS a **read-only deploy key**:

```sh
ssh-keygen -t ed25519 -f ~/.ssh/birr_deploy -N "" -C "birr-vps"
cat ~/.ssh/birr_deploy.pub
```

Add that public key under GitHub → repo → Settings → Deploy keys (read-only), or from your PC run
`gh repo deploy-key add birr_deploy.pub --repo berbir12/birr --title birr-vps`. Then on the VPS:

```sh
cat >> ~/.ssh/config <<'EOF'
Host github-birr
  HostName github.com
  IdentityFile ~/.ssh/birr_deploy
  IdentitiesOnly yes
EOF
git clone git@github-birr:berbir12/birr.git ~/birr && cd ~/birr
```

## 4. Configure `.env`

```sh
cp .env.example .env && chmod 600 .env
echo "DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)"
echo "TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 24)"
nano .env
```

Set at least the following:

```dotenv
DOMAIN=birr.example.com
NODE_ENV=production
PUBLIC_URL=https://birr.example.com
MINIAPP_URL=https://birr.example.com
BOT_TOKEN=<from BotFather>
BOT_MODE=webhook
TELEGRAM_WEBHOOK_SECRET=<generated above>
ALLOWED_TELEGRAM_IDS=<your id>
DATA_ENCRYPTION_KEY=<generated above>
```

> **Back up `DATA_ENCRYPTION_KEY` somewhere safe, away from the server** (e.g. your password manager).
> Without it the encrypted raw SMS in the database and its backups can't be read.

If you ran Birr locally in polling mode with the same bot, stop it first. A bot can't use long polling
and a webhook at the same time.

## 5. Start it

```sh
docker compose up -d --build
docker compose ps                         # server should become "healthy"
docker compose logs -f server             # look for "[api] listening on :8787"
curl https://birr.example.com/health      # {"ok":true}
```

The first build takes a few minutes. Caddy gets the TLS certificate on the first HTTPS request.
`docker compose logs web` shows progress if it doesn't work straight away.

## 6. Register the Mini App with @BotFather

The **Open Birr** button that `/start` sends already works, because inline `web_app` buttons accept any
HTTPS URL. To also get the **menu button** next to the message box:

1. @BotFather → `/mybots` → your bot → **Bot Settings** → **Menu Button** → **Configure menu button**.
2. Send the URL `https://birr.example.com` and a title, e.g. `Birr`.

Optional: **Bot Settings → Configure Mini App → Enable Mini App** with the same URL, which gives the bot
a launchable Mini App on its profile.

## 7. Connect your phone

Send `/start`, then `/connect` to the bot and follow [SETUP.md](SETUP.md) (iPhone Shortcuts).

## Updating

```sh
cd ~/birr && git pull && docker compose up -d --build
```

Migrations run automatically on start. SQLite data lives in the `birr-data` volume and survives rebuilds.

## Backups

Run a consistent online backup daily at 03:00 Addis time, keeping the last 14:

```sh
crontab -e
# add (VPS clock in UTC; 00:00 UTC = 03:00 EAT):
0 0 * * * cd ~/birr && docker compose exec -T server ./node_modules/.bin/tsx src/db/backup.ts >> ~/birr-backup.log 2>&1
```

Backups land in the volume under `/data/backups`. Copy them off the VPS now and then:

```sh
docker compose cp server:/data/backups ./backups-$(date +%F)
```

To restore one: `docker compose stop server`, copy the backup over `/data/birr.db`
(`docker compose cp ./birr-….db server:/data/birr.db`), then `docker compose start server`.

## Troubleshooting

| Symptom | Check |
|---|---|
| Bot doesn't answer | `docker compose logs server`. The `BOT_TOKEN` or `ALLOWED_TELEGRAM_IDS` may be wrong. Run `curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo` and look at `last_error_message`. |
| Certificate errors | DNS doesn't point at the VPS yet, ports 80/443 are closed, or Cloudflare proxy is on before the first certificate. |
| Mini App shows "Could not reach the server" | `PUBLIC_URL`/`MINIAPP_URL` must both be `https://<DOMAIN>`. |
| `server` keeps restarting | Usually a missing or invalid `.env` value. The log says which one. |
| SQLite "readonly database" | The volume was created by an older image. Run `docker compose run --rm -u root server chown -R node:node /data` once. |
