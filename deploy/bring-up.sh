#!/usr/bin/env bash
# ============================================================
# Alpha (alphaspace-clone) — LAN bring-up script
# Runs on the Geekom A9 from inside ~/apps/alphaspace-clone.
#
# What it does:
#   1. Preflight: .env exists, docker/compose available
#   2. docker compose up -d --build
#   3. Waits (up to 5 min) for postgres, redis, api, web to become healthy
#   4. Runs Prisma migrate deploy against the running api container
#   5. Restarts api so it picks up any freshly-created tables
#   6. curl-checks /healthz on the API and / on the web
#   7. Prints a clear pass/fail summary + the URL to open
#
# Idempotent — safe to re-run.
# ============================================================

set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/apps/alphaspace-clone}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-300}"   # seconds
POLL_INTERVAL=5

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
ok()   { printf '\033[1;32m[ok]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

# ---- 1. Preflight ---------------------------------------------------------
[[ -d "$REPO_DIR" ]]        || die "Repo not found at $REPO_DIR — run bootstrap-lan.sh first"
cd "$REPO_DIR"
[[ -f .env ]]               || die ".env missing in $REPO_DIR — run bootstrap-lan.sh first"
command -v docker >/dev/null || die "docker not installed"
docker compose version >/dev/null 2>&1 || die "docker compose plugin missing"

# ---- 2. Pull LAN_IP from .env for the smoke test --------------------------
LAN_IP="$(sed -n 's|^AUTH_URL=http://\([^:]*\):.*|\1|p' .env | head -n1)"
[[ -n "$LAN_IP" ]] || die "Could not parse LAN IP from .env AUTH_URL — regenerate .env"
say "Target LAN IP: $LAN_IP"

# ---- 3. Build + start -----------------------------------------------------
say "docker compose up -d --build (first run can take several minutes)"
docker compose up -d --build

# ---- 4. Wait for services healthy -----------------------------------------
say "Waiting up to ${HEALTH_TIMEOUT}s for services to become healthy"

deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
services=(postgres redis api web)

all_healthy() {
  for s in "${services[@]}"; do
    status="$(docker compose ps --format json "$s" 2>/dev/null | \
              python3 -c 'import sys,json
try:
  d=json.loads(sys.stdin.read() or "{}")
  print(d.get("Health") or d.get("State") or "unknown")
except Exception:
  print("unknown")' 2>/dev/null || echo unknown)"
    case "$status" in
      healthy|running) ;;
      *) return 1 ;;
    esac
  done
  return 0
}

while :; do
  if all_healthy; then
    ok "All four services report healthy/running"
    break
  fi
  now=$(date +%s)
  if (( now >= deadline )); then
    err "Timeout waiting for services. Current state:"
    docker compose ps
    echo
    err "Last 40 log lines per service:"
    docker compose logs --tail=40
    exit 1
  fi
  sleep "$POLL_INTERVAL"
done

# ---- 5. Prisma migrate deploy (idempotent) --------------------------------
say "Running Prisma migrations against the api container"
if docker exec "$(docker compose ps -q api)" \
     /app/node_modules/.pnpm/node_modules/.bin/prisma migrate deploy \
     --schema=/app/packages/db/prisma/schema.prisma; then
  ok "Prisma migrations applied (or already up to date)"
else
  warn "prisma migrate deploy returned non-zero — check output above."
  warn "If schema is missing you can retry with:"
  warn "  docker exec \$(docker compose ps -q api) /app/node_modules/.pnpm/node_modules/.bin/prisma migrate deploy --schema=/app/packages/db/prisma/schema.prisma"
fi

# ---- 6. Restart api so it picks up any new tables -------------------------
say "Restarting api container to pick up schema changes"
docker compose restart api >/dev/null
sleep 4

# ---- 7. Smoke test --------------------------------------------------------
say "Smoke-testing /healthz on the API and / on the web"

api_ok=false
web_ok=false

if curl -fsS --max-time 5 "http://$LAN_IP:3001/healthz" >/dev/null; then
  api_ok=true
  ok "API /healthz responded 200 at http://$LAN_IP:3001/healthz"
else
  err "API /healthz did not respond at http://$LAN_IP:3001/healthz"
fi

if curl -fsS --max-time 5 "http://$LAN_IP:3000/" >/dev/null; then
  web_ok=true
  ok "Web root responded 200 at http://$LAN_IP:3000/"
else
  err "Web root did not respond at http://$LAN_IP:3000/"
fi

# ---- 8. Summary -----------------------------------------------------------
echo
echo "=========================================="
if $api_ok && $web_ok; then
  ok "Alpha is up on the LAN."
  echo
  echo "    Open in your browser:  http://$LAN_IP:3000"
  echo
  echo "    Follow logs anytime:   (cd $REPO_DIR && docker compose logs -f)"
  echo "    Stop the stack:        (cd $REPO_DIR && docker compose down)"
  exit 0
else
  err "One or more smoke checks failed. Recent logs:"
  echo
  docker compose logs --tail=80
  exit 2
fi
