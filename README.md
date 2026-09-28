# Alpha

A self-hosted, open-source investment research workspace. Build a drag-and-drop canvas of linked panels — charts, news, fundamentals, watchlists, and an AI assistant — that persist across sessions.

## Quick Start

```bash
cp .env.example .env
# Fill in your credentials in .env
docker compose up --build
```

Open `http://localhost:3000` for the web app and `http://localhost:3001` for the API.

## Architecture

- **Frontend:** Next.js 16.3 + React 19.2, Tailwind + shadcn/ui, Zustand, TanStack Query, react-grid-layout
- **API:** Fastify (Node.js/TypeScript)
- **Database:** PostgreSQL 16 + Prisma ORM
- **Cache:** Redis 7
- **Auth:** Auth.js v5 (email magic-link + password credentials)
- **Data:** Finnhub (quotes, candles, news, fundamentals)
- **Deployment:** Docker Compose on Geekom A9 behind Nginx + Let's Encrypt

## Development

```bash
pnpm install
pnpm dev
```

## Requirements

- Node.js 24+
- pnpm 9+
- Docker + Docker Compose

## License

MIT — see [LICENSE](./LICENSE)
