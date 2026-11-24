#!/usr/bin/env bash
# Birr installer for Ubuntu 22.04+/Debian 12. Safe to re-run.
#
#   From your PC:   ssh root@<vps> 'bash -s -- birr.example.com' < deploy/install.sh
#   On the VPS:     sudo bash install.sh birr.example.com
#
# Run 1 installs packages and prints a GitHub deploy key, then stops.
# Run 2 (after adding the key) clones, builds, writes /etc/birr/birr.env and starts everything.

# Everything lives in main() so that, when piped through `ssh … bash -s`, bash has read the whole
# script before any command runs (otherwise apt/git could swallow the rest of the script from stdin).
main() {
  set -euo pipefail
  exec </dev/null

  local DOMAIN="${1:-}"
  local REPO="${2:-git@github-birr:berbir12/birr.git}"
  local APP_DIR=/opt/birr ETC_DIR=/etc/birr ENV_FILE=/etc/birr/birr.env
  local NODE_MAJOR=22 PNPM_VERSION=12.23.0
  local KEY=/home/birr/.ssh/birr_deploy

  log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
  warn() { printf '\n\033[1;33m!!  %s\033[0m\n' "$*"; }
  die() { printf '\n\033[1;31mxx  %s\033[0m\n' "$*"; exit 1; }
  as_birr() { runuser -u birr -- env HOME=/home/birr PATH="$PATH" "$@"; }

  [[ -n "$DOMAIN" ]] || die "usage: install.sh <domain> [git-repo]"
  [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "'$DOMAIN' doesn't look like a domain name"
  [[ $(id -u) -eq 0 ]] || die "run as root (or with sudo)"
  . /etc/os-release
  [[ "$ID" == ubuntu || "$ID" == debian || "${ID_LIKE:-}" == *debian* ]] || die "Ubuntu/Debian only (found $ID)"

  # ---------- refuse to fight another web server ----------
  if ss -ltnp 2>/dev/null | grep -E ':(80|443)\s' | grep -vq caddy; then
    ss -ltnp | grep -E ':(80|443)\s' || true
    die "Ports 80/443 are used by another program (above). Stop it or move it first; Caddy needs them."
  fi

  # ---------- packages ----------
  log "System packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get install -y -q curl git ca-certificates gnupg openssl ufw build-essential python3 \
    debian-keyring debian-archive-keyring apt-transport-https

  if ! command -v node >/dev/null || (( $(node -p 'process.versions.node.split(".")[0]') < NODE_MAJOR )); then
    log "Node.js $NODE_MAJOR (NodeSource)"
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y -q nodejs
  fi
  if ! command -v pnpm >/dev/null || [[ "$(pnpm -v)" != "$PNPM_VERSION" ]]; then
    log "pnpm $PNPM_VERSION"
    npm install -g "pnpm@$PNPM_VERSION"
  fi

  if ! command -v caddy >/dev/null; then
    log "Caddy (official apt repo)"
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' |
      gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' >/etc/apt/sources.list.d/caddy-stable.list
    apt-get update -q
    apt-get install -y -q caddy
  fi

  # ---------- service user + deploy key ----------
  if ! id birr >/dev/null 2>&1; then
    log "Creating system user 'birr'"
    useradd --system --create-home --home-dir /home/birr --shell /usr/sbin/nologin birr
  fi
  if [[ ! -f "$KEY" ]]; then
    log "Generating GitHub deploy key"
    install -d -m 700 -o birr -g birr /home/birr/.ssh
    as_birr ssh-keygen -q -t ed25519 -f "$KEY" -N "" -C "birr-vps@$(hostname)"
    cat >/home/birr/.ssh/config <<EOF
Host github-birr
  HostName github.com
  User git
  IdentityFile $KEY
  IdentitiesOnly yes
EOF
    # GitHub's published ed25519 host key (pinned rather than trusted on first use).
    echo 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' \
      >/home/birr/.ssh/known_hosts
    chown birr:birr /home/birr/.ssh/config /home/birr/.ssh/known_hosts
    chmod 600 /home/birr/.ssh/config /home/birr/.ssh/known_hosts
  fi

  if ! as_birr git ls-remote "$REPO" >/dev/null 2>&1; then
    warn "The VPS can't read the repo yet. Add this READ-ONLY deploy key on GitHub, then run this script again:"
    echo
    cat "$KEY.pub"
    echo
    echo "  GitHub → berbir12/birr → Settings → Deploy keys → Add deploy key (leave 'Allow write access' off)"
    echo "  or from your PC:  gh repo deploy-key add <file-with-the-key> --repo berbir12/birr --title birr-vps"
    exit 2
  fi

  # ---------- code + build ----------
  if [[ ! -d "$APP_DIR/.git" ]]; then
    log "Cloning into $APP_DIR"
    install -d -m 755 -o birr -g birr "$APP_DIR"
    as_birr git clone -q "$REPO" "$APP_DIR"
  else
    log "Updating $APP_DIR"
    as_birr git -C "$APP_DIR" pull -q --ff-only
  fi
  log "Installing dependencies and building the Mini App"
  as_birr bash -c "cd '$APP_DIR' && pnpm install --frozen-lockfile && pnpm --filter @birr/miniapp build"

  # ---------- configuration ----------
  install -d -m 750 -o root -g birr "$ETC_DIR"
  if [[ ! -f "$ENV_FILE" ]]; then
    log "Writing $ENV_FILE (with freshly generated secrets)"
    (
      umask 027
      cat >"$ENV_FILE" <<EOF
# Birr configuration. Owned root:birr, mode 640. Restart after editing: systemctl restart birr

# ---- fill these two ----
BOT_TOKEN=
ALLOWED_TELEGRAM_IDS=

# ---- generated; BACK UP DATA_ENCRYPTION_KEY somewhere safe (password manager) ----
DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)
TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 24)

NODE_ENV=production
HOST=127.0.0.1
PORT=8787
PUBLIC_URL=https://$DOMAIN
MINIAPP_URL=https://$DOMAIN
BOT_MODE=webhook
DATABASE_PATH=/var/lib/birr/birr.db
TZ=Africa/Addis_Ababa
INITDATA_MAX_AGE_SECONDS=86400
INGEST_RATE_LIMIT_PER_MIN=30
LLM_FALLBACK_ENABLED=false
ANTHROPIC_API_KEY=
LLM_MODEL=claude-haiku-5-5
LLM_MIN_CONFIDENCE=0.8
LARGE_TX_THRESHOLD_ETB=5000
LOW_BALANCE_THRESHOLD_ETB=500
DIGEST_TIME=21:00
EOF
    )
    chown root:birr "$ENV_FILE"
    chmod 640 "$ENV_FILE"
  else
    log "Keeping existing $ENV_FILE"
  fi

  # ---------- systemd units ----------
  log "Installing systemd units"
  install -m 644 "$APP_DIR"/deploy/birr.service "$APP_DIR"/deploy/birr-backup.service \
    "$APP_DIR"/deploy/birr-backup.timer /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now birr-backup.timer >/dev/null

  # ---------- Caddy ----------
  log "Configuring Caddy for $DOMAIN"
  local NEW_CADDY
  NEW_CADDY=$(mktemp)
  sed "s/__DOMAIN__/$DOMAIN/" "$APP_DIR/deploy/Caddyfile.template" >"$NEW_CADDY"
  caddy validate --config "$NEW_CADDY" --adapter caddyfile >/dev/null
  if [[ -f /etc/caddy/Caddyfile ]] && ! cmp -s "$NEW_CADDY" /etc/caddy/Caddyfile; then
    local BAK="/etc/caddy/Caddyfile.bak.$(date +%Y%m%d%H%M%S)"
    cp /etc/caddy/Caddyfile "$BAK"
    if ! grep -q '__DOMAIN__\|Installed to /etc/caddy/Caddyfile by deploy/install.sh' "$BAK"; then
      warn "Replaced an existing /etc/caddy/Caddyfile (saved as $BAK). Merge any other sites back by hand."
    fi
  fi
  install -m 644 "$NEW_CADDY" /etc/caddy/Caddyfile
  rm -f "$NEW_CADDY"
  systemctl enable caddy >/dev/null
  systemctl reload-or-restart caddy

  # ---------- firewall (never lock out SSH) ----------
  log "Firewall"
  local SSH_PORT
  SSH_PORT=$(awk '{print $4}' <<<"${SSH_CONNECTION:-}")
  ufw allow OpenSSH >/dev/null
  [[ -n "$SSH_PORT" && "$SSH_PORT" != 22 ]] && ufw allow "$SSH_PORT/tcp" >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 443/udp >/dev/null
  ufw status | grep -q 'Status: active' || ufw --force enable >/dev/null
  ufw status | sed -n '1,20p'

  # ---------- start ----------
  if grep -qE '^BOT_TOKEN=.+' "$ENV_FILE" && grep -qE '^ALLOWED_TELEGRAM_IDS=[0-9]' "$ENV_FILE"; then
    log "Starting birr"
    systemctl enable birr >/dev/null
    systemctl restart birr
    for _ in $(seq 1 30); do
      curl -fsS http://127.0.0.1:8787/health >/dev/null 2>&1 && break
      sleep 1
    done
    if curl -fsS http://127.0.0.1:8787/health >/dev/null 2>&1; then
      log "Birr is running. Check https://$DOMAIN/health, then send /start to your bot."
    else
      journalctl -u birr -n 40 --no-pager || true
      die "birr did not become healthy (log above)."
    fi
  else
    log "Almost done."
    echo "  1. Edit $ENV_FILE and set BOT_TOKEN and ALLOWED_TELEGRAM_IDS:"
    echo "       sudo nano $ENV_FILE"
    echo "  2. Start it:  sudo systemctl enable --now birr"
    echo "  3. Back up DATA_ENCRYPTION_KEY from that file to your password manager."
  fi
}

main "$@"
