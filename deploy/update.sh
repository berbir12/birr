#!/usr/bin/env bash
# Deploy the latest main branch.   On the VPS:  sudo /opt/birr/deploy/update.sh
#                                  From your PC: ssh root@<vps> /opt/birr/deploy/update.sh
main() {
  set -euo pipefail
  exec </dev/null
  local APP_DIR=/opt/birr
  as_birr() { runuser -u birr -- env HOME=/home/birr PATH="$PATH" "$@"; }
  [[ $(id -u) -eq 0 ]] || { echo "run as root (or with sudo)"; exit 1; }

  local before after
  before=$(as_birr git -C "$APP_DIR" rev-parse --short HEAD)
  as_birr git -C "$APP_DIR" pull -q --ff-only
  after=$(as_birr git -C "$APP_DIR" rev-parse --short HEAD)
  echo "==> $before → $after"

  as_birr bash -c "cd '$APP_DIR' && pnpm install --frozen-lockfile && pnpm --filter @birr/miniapp build"

  install -m 644 "$APP_DIR"/deploy/birr.service "$APP_DIR"/deploy/birr-backup.service \
    "$APP_DIR"/deploy/birr-backup.timer /etc/systemd/system/
  systemctl daemon-reload
  systemctl restart birr   # migrations run on start

  for _ in $(seq 1 30); do
    curl -fsS http://127.0.0.1:8787/health >/dev/null 2>&1 && { echo "==> healthy"; exit 0; }
    sleep 1
  done
  journalctl -u birr -n 40 --no-pager
  echo "xx  birr did not become healthy. Roll back with: sudo -u birr git -C $APP_DIR checkout $before && sudo $0"
  exit 1
}
main "$@"
