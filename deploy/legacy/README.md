# deploy/legacy/ — Retired Deployment Artifacts

These files are retained for historical reference only. **Do not use them for new deployments.**

## What's here

- `nginx/nginx.conf` — The reverse proxy config from the original A9 rollout plan. Terminated TLS via certbot-issued Let's Encrypt certs and proxied to the `web` and `api` containers.
- `certbot-gitkeep.placeholder` — Placeholder from the retired `deploy/certbot/` directory.

## Why these were retired

The original A9 rollout required opening ports 80/443 on the home router and standing up nginx + certbot inside the Docker stack. This was replaced on 2026-10-05 by **Cloudflare Tunnel + Cloudflare Access**, which:

- Eliminates the router port-forward requirement (tunnel initiates outbound)
- Removes the need to manage TLS certs on the A9 (Cloudflare terminates at the edge)
- Adds email-based identity + allowlist gating at the edge via Cloudflare Access
- Keeps `postgres`, `redis`, `api` host-bound to `127.0.0.1` — unchanged from the security-review state

The current public-access path is: `cloudflared` service in `docker-compose.yml` → Cloudflare edge → `https://alpha.wunderware.app`. See `deploy/RUNBOOK.md` for the current rollout procedure.

## Can I delete these?

Yes — once the Cloudflare Tunnel deployment has been stable for a reasonable period and no one is likely to need to reconstruct the nginx+certbot history. Until then, keep them as a reference for future projects that may want the self-hosted-TLS pattern.
