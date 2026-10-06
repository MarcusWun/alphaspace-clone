# Alpha — A9 Production Rollout Runbook

**Deployment target:** Geekom A9 (Ubuntu Linux, self-hosted)
**Public URL:** `https://alpha.wunderware.app` (via Cloudflare Tunnel + Access)
**LAN URL:** `http://192.168.0.162:3002` (direct, no Cloudflare gate)

This runbook is executed manually by Marcus on the Geekom A9. There is no SSH-based automated deploy — the A9 is pulled and brought up by hand.

---

## Architecture summary

```
Public internet ─► Cloudflare edge (TLS + Access gate)
                      │
                      ▼
                   cloudflared (A9, Docker)  ─── outbound-only tunnel ───
                      │
                      ▼ (Docker internal network)
                   web (Next.js, :3000)  ─►  api (Fastify, :3001)
                                                 │
                                                 ▼
                                             postgres + redis

Home LAN ──► 192.168.0.162:3002 (direct to `web` container)
```

- **Public access:** Cloudflare terminates TLS, enforces the Access allowlist, then forwards to `web:3000` via the tunnel.
- **LAN access:** Marcus's Windows machine hits `web` directly on `0.0.0.0:3002` for development.
- **postgres / redis / api:** bound to `127.0.0.1` only (via base compose) and further stripped in `docker-compose.prod.yml`. Not reachable from the LAN or internet.

---

## First-time rollout

### Prerequisites

- Docker Engine 24+ and Docker Compose v2 on the A9
- `git`, `curl` available
- A Cloudflare account with a configured Zero Trust team (free tier is fine)
- The `wunderware.app` domain managed on Cloudflare DNS
- A GitHub Personal Access Token or SSH key with `repo` scope to clone

### Step 1 — Clone the repo

```bash
git clone https://github.com/MarcusWun/alphaspace-clone.git ~/projects/alphaspace-clone
cd ~/projects/alphaspace-clone
git checkout main
```

### Step 2 — Fill in secrets

```bash
cp .env.example .env
nano .env   # fill in every placeholder — see table below
```

| Variable | Where to get it |
|---|---|
| `FINNHUB_API_KEY` | https://finnhub.io/dashboard |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_URL` | `https://alpha.wunderware.app` |
| `AUTH_TRUST_HOST` | `true` (required behind Cloudflare) |
| `AUTH_EMAIL_SERVER` | Your SMTP provider |
| `AUTH_EMAIL_FROM` | e.g. `noreply@wunderware.app` |
| `DATABASE_URL` | `postgresql://alpha:alpha@postgres:5432/alpha` (Docker internal — no change needed) |
| `REDIS_URL` | `redis://redis:6379` (Docker internal — no change needed) |
| `CLOUDFLARE_TUNNEL_TOKEN` | Zero Trust → Networks → Tunnels → `a9-alpha` → token (begins with `eyJ…`) |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com (optional) |

OAuth providers (`AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`) are optional. Leave empty to disable those sign-in buttons.

> **Important — `NEXT_PUBLIC_*` baked at build time.** Any `NEXT_PUBLIC_*` env var that needs the production value in client-visible code must be threaded as a Docker build ARG, not just set at runtime. `INTERNAL_API_URL=http://api:3001` is already handled this way (see `apps/web/Dockerfile`). If you ever reference `NEXT_PUBLIC_*` in server-side Next.js rewrites, repeat the ARG pattern. A plain `.env` change + `docker compose up -d` will NOT propagate — a `docker compose build web` is mandatory. See `BUG_LEDGER.md` entry WORKSPACES-500 for the full post-mortem.

### Step 3 — Create the Cloudflare Tunnel

In the Zero Trust dashboard (https://one.dash.cloudflare.com):

1. **Networks → Tunnels → Create a tunnel**
2. Connector type: **Cloudflared**
3. Tunnel name: `a9-alpha`
4. Copy the token and paste it into `.env` as `CLOUDFLARE_TUNNEL_TOKEN=eyJ…`
5. Add a **Public Hostname** to the tunnel:
   - Subdomain: `alpha`
   - Domain: `wunderware.app`
   - Service type: `HTTP`
   - URL: `web:3000`

### Step 4 — Create the Cloudflare Access application

Still in the Zero Trust dashboard:

1. **Integrations → Identity providers → Add new identity provider → One-time PIN** (if not already present). Delete the stock "Cloudflare" IdP unless you want Cloudflare-account logins.
2. **Access → Applications → Add an application**
   - Type: **Self-hosted**
   - Name: `Alpha`
   - Session duration: 24 hours
   - Application domain: `alpha.wunderware.app`
   - DNS: **Public DNS**
   - Identity providers: **One-time PIN** (check it)
3. Create the Access policy:
   - Name: `Allowed users`
   - Action: `Allow`
   - Include → **Emails** → add your email as the first entry
4. Save.

Adding or removing friends later is a UI task — no code change required.

### Step 5 — Start the stack

```bash
cd ~/projects/alphaspace-clone
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Expected healthy state:

```
docker compose ps

NAME          STATUS         PORTS
postgres      Up (healthy)   (internal only)
redis         Up (healthy)   (internal only)
api           Up (healthy)   (internal only)
web           Up (healthy)   0.0.0.0:3002->3000
cloudflared   Up             (outbound tunnel)
```

### Step 6 — Run Prisma migrations

```bash
docker compose exec api pnpm --filter @alpha/db prisma migrate deploy
```

### Step 7 — Smoke tests

- **Public (phone on cellular, OFF the home WiFi):**
  - `https://alpha.wunderware.app` → Cloudflare Access login → enter allowlisted email → PIN email arrives → enter PIN → Alpha signup/login loads.
- **Negative:** `https://alpha.wunderware.app` with a non-allowlisted email → Access denies, Alpha never loads.
- **LAN:** `http://192.168.0.162:3002` from the Windows machine → Alpha signup/login loads directly, no Access gate.

---

## Routine operations

### Pull latest code and rebuild

```bash
cd ~/projects/alphaspace-clone
git pull origin main
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

> **Reminder — `docker compose build` is mandatory** when any Docker build ARG (including `INTERNAL_API_URL` or any `NEXT_PUBLIC_*` baked into the web image) changes. A plain `up -d` will reuse the stale image.

### Restart a single service

```bash
docker compose restart api
docker compose restart web
docker compose restart cloudflared
```

### View logs

```bash
docker compose logs -f api
docker compose logs -f web
docker compose logs -f cloudflared
```

### Allowlist a new user

Zero Trust dashboard → **Access → Applications → Alpha → Policies → Allowed users → Edit** → add email → Save. Takes effect immediately on the next sign-in attempt.

### Rotate the Cloudflare Tunnel token

1. Zero Trust → Networks → Tunnels → `a9-alpha` → **Refresh token**
2. Paste new token into `.env` → `CLOUDFLARE_TUNNEL_TOKEN=…`
3. `docker compose up -d cloudflared`

### Rollback a bad deploy

```bash
cd ~/projects/alphaspace-clone
git log --oneline -10
git checkout <previous-good-sha>
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

If `cloudflared` keeps crash-looping with "Provided Tunnel token is not valid":
- Make sure the token is in `.env` as `CLOUDFLARE_TUNNEL_TOKEN=…` (no quotes, full `eyJ…` string).
- The compose file passes the token via `TUNNEL_TOKEN` env var (not `--token` CLI flag). Docker Compose cannot variable-expand values on the `command:` line.

---

## Adding another subdomain (future projects)

The tunnel can carry many hostnames. To add `aeolus.wunderware.app` (or similar) in the future:

1. Zero Trust → Networks → Tunnels → `a9-alpha` → **Public Hostnames → Add a public hostname**
2. Subdomain / Domain / Service URL (e.g. `aeolus-web:3000` if that project runs on the same Docker network, or `host.docker.internal:PORT` if on a different stack)
3. Zero Trust → Access → Applications → **Add an application** → same self-hosted / One-time PIN / allowlist pattern as Alpha.

No router changes, no new certs. The same `cloudflared` service on the A9 handles all of them.

---

## What's NOT in this stack anymore

- **nginx** — retired 2026-10-05. Legacy config at `deploy/legacy/nginx/nginx.conf`.
- **certbot** — retired 2026-10-05. Cloudflare handles TLS at the edge.
- **Port forwarding** — no router changes required. The tunnel is outbound-only.
- **Ports 80 / 443 on the A9** — not bound to anything. Can be used for other local services.
