# Alpha — A9 Production Rollout Runbook

**Deployment target:** Geekom A9 (Ubuntu Linux, self-hosted)
**Commit deployed:** `a1f7355fa2fca6c091c0955c47a7033893597bc3`
**Prepared by:** Deployment Agent (2026-09-27)

> This runbook is executed manually by Marcus on the Geekom A9.
> The Deployment Agent does not have SSH access to the A9.

---

## Prerequisites

- Docker Engine 24+ and Docker Compose v2 installed on the A9
- `git`, `curl` available
- Ports 80 and 443 open (firewall / router port-forward)
- A DNS A-record pointing your domain to the A9's public IP
- A GitHub Personal Access Token (or SSH key) with `repo` scope to clone

---

## Step 1 — Clone the repo

```bash
git clone https://github.com/MarcusWun/alphaspace-clone.git /opt/alpha
cd /opt/alpha
git checkout main
git log --oneline -3   # verify a1f7355 is at HEAD
```

---

## Step 2 — Fill in secrets

```bash
cp .env.example .env
nano .env   # fill in every placeholder — see below
```

### Mandatory secrets to fill

| Variable | Where to get it |
|---|---|
| `FINNHUB_API_KEY` | https://finnhub.io/dashboard |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_URL` | `https://YOUR_DOMAIN` |
| `AUTH_TRUST_HOST` | Uncomment and set to `true` (behind Nginx) |
| `AUTH_EMAIL_SERVER` | Your SMTP provider (e.g. Postfix, SendGrid) |
| `AUTH_EMAIL_FROM` | e.g. `noreply@yourdomain.com` |
| `DATABASE_URL` | `postgresql://alpha:alpha@postgres:5432/alpha` (Docker internal — no change needed) |
| `REDIS_URL` | `redis://redis:6379` (Docker internal — no change needed) |
| `NEXT_PUBLIC_API_URL` | `https://YOUR_DOMAIN/api` |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com (optional — cloud AI escalation) |

OAuth providers (`AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`) are optional. Leave empty to disable those sign-in buttons.

---

## Step 3 — Configure Nginx domain

Edit `deploy/nginx/nginx.conf` and replace every occurrence of `YOUR_DOMAIN` with your actual hostname:

```bash
sed -i 's/YOUR_DOMAIN/alpha.example.com/g' deploy/nginx/nginx.conf
```

---

## Step 4 — Initial TLS bootstrap (HTTP-only first pass)

Certbot needs port 80 reachable before it can issue a cert. On first boot, comment out the `ssl_*` lines in nginx.conf temporarily, or use the standard certbot standalone flow:

```bash
# Option A — standalone (stop Nginx first if running):
sudo certbot certonly --standalone -d YOUR_DOMAIN \
  --agree-tos --email your@email.com --no-eff-email

# Option B — webroot (with Nginx already running on port 80):
sudo certbot certonly --webroot -w ./deploy/certbot/www \
  -d YOUR_DOMAIN --agree-tos --email your@email.com --no-eff-email
```

Certs land in `/etc/letsencrypt/live/YOUR_DOMAIN/`. The compose prod stack mounts them at `./deploy/certbot/conf`.

Symlink or copy the letsencrypt dir into the repo volume path if needed:

```bash
sudo ln -s /etc/letsencrypt ./deploy/certbot/conf
```

---

## Step 5 — Start the stack

```bash
cd /opt/alpha
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Watch logs until all 6 containers are healthy (postgres, redis, api, web, nginx, certbot):

```bash
docker compose ps
docker compose logs -f --tail=50
```

Expected healthy state:

```
NAME       STATUS          PORTS
postgres   Up (healthy)    (internal only)
redis      Up (healthy)    (internal only)
api        Up (healthy)    (internal only)
web        Up (healthy)    (internal only)
nginx      Up (healthy)    0.0.0.0:80->80, 0.0.0.0:443->443
certbot    Up              (renewal daemon)
```

---

## Step 6 — Run Prisma migrations

```bash
docker compose exec api pnpm --filter @alpha/db prisma migrate deploy
```

Expected output: `Applied 1 migration(s) — 0001_init`

---

## Step 7 — Smoke tests

```bash
# Health endpoint
curl -sf https://YOUR_DOMAIN/healthz && echo "API OK"

# Next.js home page
curl -sf https://YOUR_DOMAIN/ | grep -i "Alpha" && echo "Web OK"

# Auth page
curl -sf https://YOUR_DOMAIN/auth/signin | grep -i "sign" && echo "Auth OK"
```

All three should return without error and print the confirmation message.

---

## Step 8 — Configure GitHub Actions self-hosted runner

1. Go to `https://github.com/MarcusWun/alphaspace-clone/settings/actions/runners`
2. Click **New self-hosted runner** → Linux → x64
3. Follow the displayed instructions on the A9 (download, configure, run as service):

```bash
# On the A9 — substitute the token from the GitHub UI
mkdir -p /opt/actions-runner && cd /opt/actions-runner
# Download the runner package as shown in GitHub UI (version varies)
./config.sh --url https://github.com/MarcusWun/alphaspace-clone --token <GITHUB_TOKEN>
sudo ./svc.sh install
sudo ./svc.sh start
```

Once the runner is online, the `.github/workflows/deploy.yml` workflow will trigger automatically on every push to `main`.

---

## Step 9 — Set GitHub Actions secrets

In `https://github.com/MarcusWun/alphaspace-clone/settings/secrets/actions`, add:

| Secret name | Value |
|---|---|
| `DEPLOY_HOST` | A9 hostname or IP (used if switching to SSH-based deploy later) |

The deploy workflow runs on the self-hosted runner which has local Docker access — no SSH secret needed for the self-hosted runner approach.

---

## Rollback plan (first deploy)

There is no prior production state to roll back to. If the A9 boot fails:

1. `docker compose down` — stop all containers
2. Diagnose: `docker compose logs api` / `docker compose logs web`
3. Common issues:
   - **Cert not found** → redo Step 4
   - **DB connection refused** → check `DATABASE_URL` in `.env` and postgres container health
   - **Auth errors** → verify `AUTH_SECRET` and `AUTH_URL` are set correctly
4. Fix the root cause (code or config)
5. If code fix needed: push a new commit to `main` → runner picks it up automatically after Step 8

---

## Cert renewal

The certbot container in `docker-compose.prod.yml` runs `certbot renew` every 12 hours. No manual action needed after initial cert issuance.

---

## Useful commands

```bash
# View live logs
docker compose logs -f api
docker compose logs -f web

# Restart a single service
docker compose restart api

# Pull latest code and rebuild
git pull origin main
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# Open a shell in the API container
docker compose exec api sh

# Run a one-off Prisma command
docker compose exec api pnpm --filter @alpha/db prisma studio
```
