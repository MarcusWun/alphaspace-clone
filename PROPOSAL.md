# PROPOSAL.md — AlphaSpace Clone
**Project slug:** `alphaspace-clone`
**Date:** 2026-05-19 (revised 2026-09-27)
**Author:** Forge (Research Architect)

### Revision 2 — 2026-09-27 Freshness Pass
Framing and core concept unchanged. Four months of landscape drift required updates in five areas:

| Area | What Changed | Impact on Proposal |
|---|---|---|
| **AI stack** | GPT-4o is two generations behind. Sept 2026 frontier is Claude 4.6 / GPT-6 / Gemini 3.8. Meanwhile local-tool-calling models (gpt-oss-120b, Qwen3 235B A22B, Llama-3-Groq-70B-Tool-Use at 90.76% BFCL) are now genuinely competitive on the A9's 128GB RAM. | Switched to **local-first hybrid**: Ollama gpt-oss-120b as default, Anthropic Claude Sonnet 4.6 as cloud escalation. Zero baseline AI cost; OpenAI dropped from critical path. |
| **Polygon.io → Massive.com** | Rebrand completed; polygon.io redirects to massive.com. API, docs, and tier structure preserved (Free EOD → Starter/Developer delayed → Advanced real-time). Advanced pricing not surfaced on public pricing page — verify at signup. | Renamed env var to `MASSIVE_API_KEY`; updated all URLs and resource links. |
| **Clerk pricing (Feb 2026)** | Free tier raised from 10K → **50K MAU**; Pro dropped from $25 → **$20/mo**. Metric now "MRU". | Removed MAU risk entirely for self-hosted scale. |
| **Framework versions** | Next.js 16.3 stable (Aug 2026), React 19.2, TradingView Lightweight Charts 5.2.1. | Bumped versions; no architectural change. |
| **OSS competitor landscape** | New self-hosted entrants: OpenTerminalUI, FinceptTerminal (Qt6/C++), FC Terminal (Gemini + Google grounding), a Go/TUI local-AI terminal. | Differentiation story tightened in §2. Canvas-metaphor + panel-linking UX is still the moat; none of the new OSS entrants replicate it. |

### Revision 1 — Open Questions Resolved (2026-05-19)
| Question | Decision | Implication |
|---|---|---|
| Single-user or multi-user? | **Multi-user** | Full user isolation in DB schema; per-user workspaces, watchlists, alerts |
| Delayed data OK for Phase 1? | **Yes — delayed free tier** | Use Massive Developer/free tier + Finnhub free WebSocket. Upgrade is a config swap. |
| Demo tickers to pre-populate? | **AVGO, NVDA, MRVL, MU, VRTS** | Semiconductor/AI-adjacent theme; pre-load a "Semiconductors" starter workspace as the default layout for new users |

---

## ⚠️ Flag Up Front
Yahoo Finance launched AlphaSpace on 2026-05-19 and has been investing hard: real-time options (Jul 22, Unusual Whales partnership), earnings hub with Scout AI summaries, and GPT-6 Sol/Luna added to Scout's model picker on Sep 24. Yahoo is not slowing down. This clone will never win on features or distribution against a 150M-DAU incumbent.

**Value proposition remains:** self-hosted, extensible, zero subscription tax, and yours to modify. Build it for Marcus's personal use and as a portfolio-quality open-source project. Framing it as a SaaS competitor to Yahoo Finance is not the play. Framing it as "the open-source AlphaSpace" is — and, as of Sept 2026, that niche has new entrants (see §2), so the differentiator inside the OSS category is the **canvas + panel-linking UX**, not "there's no OSS alternative."

---

## 1. Executive Summary

A self-hosted, open-source investment research workspace modeled on Yahoo Finance's AlphaSpace. Users build a drag-and-drop canvas of linked panels — charts, news, fundamentals, watchlists, AI assistant — that persist across sessions. The crown feature is a multi-ticker group comparison chart with normalized percentage performance over user-defined time windows. Runs on Marcus's Geekom A9 with data sourced from Polygon.io and Finnhub.

---

## 2. Problem & Opportunity

**User pain:** Retail investors maintain 4–6 open browser tabs to research stocks — charts on TradingView, news on Bloomberg/Reuters, fundamentals on Macrotrends, screeners elsewhere. Context is lost on every tab switch. There is no persistent, unified workspace.

**Market gap:** AlphaSpace proved the demand exists. Koyfin covers fundamentals well but lacks the canvas metaphor and AI layer. TradingView has great charts but zero fundamentals. Since May 2026 a handful of self-hosted terminals have shipped, but none combine the drag-and-drop canvas with live cross-panel ticker linking — that gap is still open.

**Opportunity:** Build a modular, self-hosted research workspace that matches AlphaSpace's core UX with zero recurring subscription cost (beyond data APIs) and full extensibility. Initial audience: Marcus personally + open-source community.

**Competitors and weaknesses:**
| Product | Price | Weakness |
|---|---|---|
| AlphaSpace (Yahoo Finance) | Bundled in YF Plus Gold | Closed, Yahoo lock-in, no API access; Scout AI is Yahoo-controlled |
| Koyfin | $49/mo | Weak canvas, limited AI |
| Bloomberg Terminal | $2,250/mo | Inaccessible to retail |
| TradingView | Free–$60/mo | No fundamentals, no workspace canvas |
| Benzinga Pro | $197/mo | News only, weak charting |
| **OpenTerminalUI** (OSS, 2026) | Free | New, thin panels, no canvas linking |
| **FinceptTerminal** (OSS, C++/Qt6) | Free | Desktop-only, non-web, higher barrier to modify |
| **FC Terminal** (OSS, Gemini-powered) | Free | AI-first but no persistent canvas; single-ticker focus |

---

## 3. Proposed Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                        Browser (SPA)                          │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ Canvas/Layout│  │ Panel Widget │  │   AI Chat Sidebar    │ │
│  │ react-grid-  │  │ Registry     │  │   (Scout clone)      │ │
│  │ layout       │  │              │  │                      │ │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘ │
│         │                 │                      │             │
│         └─────────────────┼──────────────────────┘             │
│                     Zustand Store                              │
│               (active ticker context,                          │
│                panel layout, linked state)                     │
└───────────────────────────┬────────────────────────────────────┘
                            │  HTTP REST + WebSocket
                            ▼
┌────────────────────────────────────────────────────────────────┐
│                     API Server (Node/Fastify)                  │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ Market Data  │  │ News &       │  │   AI Service         │ │
│  │ Router       │  │ Fundamentals │  │   (local-first,      │ │
│  │              │  │ Router       │  │    cloud escalation) │ │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘ │
│         │                 │                      │             │
│  ┌──────┴────────────────┐│                      │             │
│  │  WebSocket Fan-out    ││                      │             │
│  │  (Massive WS proxy)   ││                      │             │
│  └──────┬────────────────┘│                      │             │
└─────────┼─────────────────┼──────────────────────┼────────────┘
          │                 │              ┌───────┴────────┐
          │                 │              │                │
    ┌─────▼──────┐  ┌───────▼──────┐  ┌────▼──────┐  ┌─────▼──────────┐
    │ Massive.com│  │  Finnhub     │  │  Ollama   │  │  Anthropic API │
    │ (ex-       │  │  (news,      │  │  (local,  │  │  (Claude       │
    │  Polygon;  │  │  fundamentals│  │  gpt-oss- │  │   Sonnet 4.6;  │
    │  WS + REST)│  │  free tier)  │  │  120b on  │  │   escalation   │
    │            │  │              │  │  A9 GPU/  │  │   only)        │
    └────────────┘  └──────────────┘  │  RAM)     │  └────────────────┘
                                      └───────────┘
          │                 │
    ┌─────▼─────────────────▼──────┐
    │         Redis                 │
    │   (tick cache, WS sessions,  │
    │    rate limit buckets)       │
    └───────────────────────────────┘
          │
    ┌─────▼──────────────────────┐
    │     PostgreSQL              │
    │  (users, workspaces,        │
    │   watchlists, alerts,       │
    │   saved layouts)            │
    └────────────────────────────┘
```

**Panel linking model:** Zustand global store holds `activeTicker` (and optionally `activeTimeRange`). Every panel subscribes to the store. Clicking a ticker in a Watchlist panel fires `setActiveTicker("NVDA")` — Chart, News Feed, and Fundamentals panels all re-render to that ticker automatically. This is the core UX differentiator.

---

## 4. Tech Stack

| Layer | Choice | Rationale | Alternatives Considered |
|---|---|---|---|
| Language | TypeScript (full-stack) | Type safety across frontend + backend; better IDE support for complex domain types | JavaScript (less safe), Python (poor real-time WS for frontend) |
| Frontend framework | Next.js 16.3 + React 19.2 | App Router + RSC for marketing pages; pure CSR for dashboard shell | Vite SPA (simpler, faster), Remix (less ecosystem) |
| Styling | Tailwind CSS + Shadcn/ui | Dark-mode financial aesthetic; unstyled primitives, full control | MUI (opinionated), Ant Design (heavy) |
| State management | Zustand | Lightweight, no boilerplate, perfect for cross-panel ticker context | Redux (overkill), Jotai (less ergonomic for complex derived state) |
| Server state | TanStack Query v5 | Auto-refetch, cache invalidation, background polling for quotes | SWR (less powerful), raw useState+useEffect (no caching) |
| Dashboard layout | react-grid-layout | Most-used drag/resize grid for React; responsive breakpoints; add/remove without rebuild | Golden Layout (overkill for v1), Gridstack.js (less React-native) |
| Price charting | TradingView Lightweight Charts 5.2.x | Purpose-built financial canvas charts; 45KB; open source Apache 2.0; multi-series for group comparison. Pin to 5.2.1 (Aug 2026 stable) | ApexCharts (good but general-purpose), Highcharts (paid for commercial) |
| Fundamentals charts | ApexCharts v5 | Better for bar/donut/treemap fundamentals; TypeScript; modular | Recharts (less feature-rich), D3 (raw, too low-level) |
| Backend framework | Fastify (Node.js) | Faster than Express; JSON schema validation built-in; TypeScript-native | Express (fine, but slower), NestJS (too heavy for v1) |
| Real-time data | Massive.com (ex-Polygon.io) | Rebrand of Polygon.io; same API surface, same tier structure. Free = EOD; Starter/Developer = 15-min delayed; Advanced = real-time WS+REST | Finnhub (free but volume limits), Alpaca (brokerage-first), Databento (institutional-priced) |
| News + fundamentals | Finnhub (free) | 60 calls/min free; company news, market news, earnings, estimates, filings | Benzinga (better news quality but paid), Marketaux (broader but thinner) |
| Premium news | Benzinga API | Institutional-grade news; AWS Marketplace free tier for headlines | Reuters API (enterprise pricing), AP News (no financial focus) |
| AI assistant (primary) | **Ollama + gpt-oss-120b** | OpenAI open-weights model, 128K context, strong tool-use; runs comfortably on A9's 128GB RAM; zero API cost; keeps user data local. Function calling via OpenAI-compatible endpoint | Qwen3 235B A22B (top BFCL score 0.708, larger footprint), Llama-3-Groq-70B-Tool-Use (90.76% BFCL, tool-use-tuned), Nemotron 3 Super |
| AI assistant (escalation) | **Anthropic Claude Sonnet 4.6** | Frontier function-calling quality; used only when local model requests escalation (long reasoning, complex multi-step queries). Cheaper per-token than GPT-6 for equivalent quality | OpenAI GPT-5.4 (similar quality, higher cost), Gemini 3.8 Flash (cheapest cloud, weaker tool-use) |
| Auth | Clerk | Auth in <30 min; JWT; social login; session management. Free = 50K MRU (raised from 10K in Feb 2026); Pro $20/mo | NextAuth.js / Auth.js v5 (free, more config; consider for pure-OSS release), Supabase Auth |
| Primary DB | PostgreSQL (self-hosted) | Relational; JSONB for workspace layouts; battle-tested | Supabase (managed PG, faster start), SQLite (not for multi-user) |
| Cache / pub-sub | Redis (self-hosted) | Tick data TTL cache; WebSocket session fan-out; rate limit buckets | Upstash (managed Redis, adds latency) |
| Hosting | Docker Compose on Geekom A9 | 128GB RAM; no cloud cost; full control | Railway/Render (cloud, adds $) |
| Reverse proxy | Nginx | SSL termination, static file serving, WS upgrade | Caddy (simpler config, valid alternative) |
| CI/CD | GitHub Actions + self-hosted runner | Push-to-deploy; lint/test/build pipeline | GitLab CI (overkill), Drone (less ecosystem) |

---

## 5. External APIs & Services

| Service | Purpose | Pricing Tier | Auth Method | Signup URL |
|---|---|---|---|---|
| Massive.com (ex-Polygon.io) | US equities quotes (REST + WebSocket), OHLC bars, trades | Free (EOD) → Starter/Developer (15-min delay, ~$29/mo entry) → Advanced (real-time, verify pricing at signup) | API key in header | https://massive.com |
| Finnhub | Company news, market news, fundamentals, estimates, earnings calendar, SEC filings | Free: 60 calls/min REST; Premium from ~$11.99/mo | API key in query param | https://finnhub.io |
| Benzinga | Premium financial news feed | Free tier (headlines+body) via AWS Marketplace; paid for real-time | API key | https://www.benzinga.com/apis/ |
| Ollama (local, self-hosted) | Primary AI assistant model host on A9. Runs gpt-oss-120b or Qwen3. Exposes OpenAI-compatible endpoint on `localhost:11434` | Free (compute-only) | None (localhost); optional bearer token if exposing beyond loopback | https://ollama.com |
| Anthropic | Cloud AI escalation (Claude Sonnet 4.6); used when local model returns low-confidence or exceeds context | Pay-per-token; Sonnet 4.6 ~$3/1M input, $15/1M output | API key (Bearer) | https://console.anthropic.com |
| Clerk | User auth, session management, JWT | Free tier: **50K MRU**; Pro $20/mo (annual) | Publishable + Secret keys | https://clerk.com |
| Let's Encrypt | TLS certificate for self-hosted domain | Free | ACME DNS/HTTP challenge | https://letsencrypt.org |

---

## 6. Access Tokens & Credentials Needed

| Credential | What It Is | Where to Get It | Env Var | Scopes / Notes |
|---|---|---|---|---|
| `MASSIVE_API_KEY` | Massive.com API key (ex-Polygon) | https://massive.com → Dashboard → API Keys | `MASSIVE_API_KEY` | Free key works for dev/test (EOD); upgrade to Developer for 15-min delay, Advanced for real-time. Verify Advanced price at signup |
| `FINNHUB_API_KEY` | Finnhub API key | https://finnhub.io → Sign up → API Key | `FINNHUB_API_KEY` | Free tier; 60 calls/min; no special scopes required |
| `BENZINGA_API_KEY` | Benzinga news API key | AWS Marketplace → subscribe to Benzinga Basic News (free tier) | `BENZINGA_API_KEY` | Requires AWS account; free tier gives headline + body |
| `OLLAMA_BASE_URL` | Local Ollama endpoint | Installed on A9 host; default `http://localhost:11434` | `OLLAMA_BASE_URL` | No auth needed for loopback. Pull model: `ollama pull gpt-oss:120b` |
| `OLLAMA_MODEL` | Local model name/tag | Configuration only | `OLLAMA_MODEL` | Default: `gpt-oss:120b`. Alt: `qwen3:235b-a22b`, `llama3-groq-tool-use:70b` |
| `ANTHROPIC_API_KEY` | Anthropic API key (cloud escalation) | https://console.anthropic.com → API Keys | `ANTHROPIC_API_KEY` | Must add billing; set spend limits. Model: `claude-sonnet-4-6` |
| `CLERK_PUBLISHABLE_KEY` | Clerk public key (frontend) | Clerk dashboard → API Keys | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Public; safe for client bundle |
| `CLERK_SECRET_KEY` | Clerk secret key (backend) | Clerk dashboard → API Keys | `CLERK_SECRET_KEY` | Server-only; never expose to client |
| `DATABASE_URL` | PostgreSQL connection string | Self-hosted; set in docker-compose | `DATABASE_URL` | Format: `postgresql://user:pass@localhost:5432/alphaspace` |
| `REDIS_URL` | Redis connection string | Self-hosted; set in docker-compose | `REDIS_URL` | Format: `redis://localhost:6379` |
| `JWT_SECRET` | App-level JWT signing secret | Generate: `openssl rand -base64 32` | `JWT_SECRET` | 32+ bytes random; rotate periodically |

**No waiting period or approval process** for any of the above — all are instant signup except Benzinga AWS Marketplace (~5 min to activate) and Ollama model pull (gpt-oss:120b is ~65GB — plan for a first-time download).

---

## 7. Implementation Roadmap

### Phase 1 — Walking Skeleton (2–3 weeks)
**Goal:** Running app with the group comparison chart and panel linking.

- Project scaffold: Next.js + Fastify monorepo, Docker Compose, PostgreSQL, Redis
- Auth with Clerk (login/signup)
- Basic canvas: react-grid-layout with 3 panel types: Watchlist, Chart, News Feed
- Massive.com integration: REST OHLC bars for historical data
- **Group Comparison Chart** (MVP of Marcus's favorite feature):
  - Multi-ticker input (add/remove tickers)
  - Time range selector: 1W / 1M / 3M / YTD / 1Y / 5Y / Custom
  - Normalized % change chart (all tickers anchored to 0% at period start)
  - TradingView Lightweight Charts multi-series line chart
  - Color-coded legend
- Panel linking: Zustand store, clicking ticker in watchlist updates all panels
- Finnhub news feed by ticker
- Workspace save/load (PostgreSQL JSONB)
- Deploy to Geekom A9 via Docker Compose

**Milestone:** Marcus can add AAPL, MSFT, NVDA to a comparison chart, set a 1Y window, and see normalized performance — and click any of them to get a news panel update.

### Phase 2 — Individual Stock Deep Dive (2–3 weeks)
- Individual stock panel with:
  - Live quote (Massive.com WebSocket, 15-second fallback to REST for delayed-tier)
  - Candlestick OHLC chart with volume bars
  - Company fundamentals (Finnhub: P/E, EV/EBITDA, revenue, margins, debt)
  - Earnings history chart
  - SEC filings panel (Finnhub)
  - Analyst estimates panel
- Benzinga premium news integration
- News sentiment display (Finnhub sentiment score)
- Price alerts (stored in PG, evaluated on WebSocket tick arrival, push notification via browser)

**Milestone:** Click any ticker → full single-stock research view with live price, chart, news, and fundamentals.

### Phase 3 — AI Assistant (2 weeks)
- Chat sidebar panel (dockable)
- **Local-first via Ollama** (gpt-oss:120b default; MoE with 5.1B active params, native MXFP4). Expected throughput on the A9 Max: 10–25 tok/s eval, 30–60s cold start. **Downgrade path:** if measured eval throughput on the target box drops below ~8 tok/s, switch the local default to `gpt-oss:20b` (3.6B active, ~12GB footprint, 40–60 tok/s expected). Same tool-calling behavior, much lower RAM pressure. Function calling through OpenAI-compatible endpoint:
  - `get_quote(ticker)` — pulls live price
  - `get_news(ticker, days)` — fetches recent news
  - `compare_stocks(tickers[], period)` — returns normalized performance data
  - `build_view(description)` — emits a layout config JSON that the canvas can load
  - `summarize_news(ticker)` — summarizes last N articles
- **Cloud escalation to Claude Sonnet 4.6** when: input context > 96K tokens, local model's tool-selection confidence flag is low, or user explicitly requests "deep reasoning"
- Router logic sits in `services/ai.ts`: try local first, fall through on failure or escalation signal
- Streaming responses (both providers support SSE)
- Conversation history per workspace (stored in PG)

**Milestone:** Type "compare Tesla and Rivian over the past 6 months and pull their latest news" → workspace auto-populates with comparison chart + news panels.

### Phase 4 — Polish & Extensions (2–3 weeks)
- Pre-defined themes / starter layouts (Magnificent Seven, Energy Sector, etc.)
- Portfolio tracker panel (manual positions, no brokerage integration)
- Technical indicators on chart (SMA, EMA, RSI, MACD) — TW LW Charts plugin system
- Dark/light mode toggle
- Mobile-responsive layout (simplified single-column view)
- Keyboard shortcuts
- Export chart as PNG
- Watchlist import from CSV
- Performance optimization: Redis caching for Polygon bars (5-min TTL), request deduplication

### Phase 5 — Open Source Release (1 week)
- Clean up secrets, add `.env.example`
- Write README with 5-minute setup guide
- Docker Compose one-liner
- MIT license
- Submit to openalternative.co as "open-source AlphaSpace alternative"

---

## 8. Coding Agent Handoff Notes

### Repo Structure to Bootstrap

```
alphaspace-clone/
├── apps/
│   ├── web/                    # Next.js 15 app
│   │   ├── app/
│   │   │   ├── (auth)/         # Clerk auth pages
│   │   │   ├── (dashboard)/    # Main canvas page
│   │   │   └── api/            # Next.js API routes (thin proxies only)
│   │   ├── components/
│   │   │   ├── canvas/         # react-grid-layout wrapper + panel shell
│   │   │   ├── panels/         # One folder per panel type
│   │   │   │   ├── GroupComparisonChart/
│   │   │   │   ├── StockChart/
│   │   │   │   ├── NewsFeed/
│   │   │   │   ├── Fundamentals/
│   │   │   │   ├── Watchlist/
│   │   │   │   └── AIAssistant/
│   │   │   └── ui/             # Shadcn/ui components
│   │   └── store/              # Zustand stores
│   │       ├── useTickerStore.ts  # activeTicker, activeTimeRange
│   │       └── useLayoutStore.ts  # panel positions, sizes
│   └── api/                    # Fastify API server
│       ├── routes/
│       │   ├── market.ts       # Massive.com proxy
│       │   ├── news.ts         # Finnhub / Benzinga proxy
│       │   ├── fundamentals.ts # Finnhub fundamentals proxy
│       │   ├── ai.ts           # Local-first AI streaming proxy
│       │   └── workspaces.ts   # CRUD for saved layouts
│       ├── services/
│       │   ├── massive.ts      # ex-polygon.ts
│       │   ├── finnhub.ts
│       │   ├── ollama.ts       # Local model client (OpenAI-compat)
│       │   ├── anthropic.ts    # Cloud escalation client
│       │   └── aiRouter.ts     # Local-vs-cloud routing logic
│       └── ws/
│           └── tickStream.ts   # Massive WS → Redis → client fan-out
├── packages/
│   ├── db/                     # Prisma schema + client
│   └── types/                  # Shared TypeScript types
├── docker-compose.yml
├── .env.example
└── turbo.json                  # Turborepo config
```

### Scaffold Commands

```bash
# 1. Initialize monorepo
npx create-turbo@latest alphaspace-clone --package-manager pnpm

# 2. Add Next.js app
cd apps/web
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir

# 3. Add Fastify API
cd ../api
pnpm init && pnpm add fastify @fastify/websocket @fastify/cors fastify-plugin

# 4. Add Shadcn/ui
npx shadcn@latest init

# 5. Add key deps (web)
pnpm add lightweight-charts react-grid-layout zustand @tanstack/react-query

# 6. Add Prisma
pnpm add -D prisma && pnpm add @prisma/client
npx prisma init

# 7. Add Clerk
pnpm add @clerk/nextjs
```

### .env.example Template

```env
# Massive.com (ex-Polygon.io)
MASSIVE_API_KEY=

# Finnhub
FINNHUB_API_KEY=

# Benzinga
BENZINGA_API_KEY=

# AI — local (default)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=gpt-oss:120b

# AI — cloud escalation (optional; disable escalation if unset)
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-6

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

# Database
DATABASE_URL=postgresql://alphaspace:password@localhost:5432/alphaspace

# Redis
REDIS_URL=redis://localhost:6379

# App
JWT_SECRET=
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### Key Gotchas

1. **Massive.com WebSocket requires server-side proxy.** Never expose `MASSIVE_API_KEY` to the browser. The Fastify server opens one WS connection to Massive, subscribes to all active tickers, then fans out to connected clients via Redis pub/sub. Client connects to your Fastify WS endpoint, not Massive directly.

2. **TradingView Lightweight Charts requires a DOM element ref.** Use `useRef` + `useEffect` carefully in React 19 — don't initialize the chart before the ref mounts. Use a ResizeObserver to handle panel resize events.

3. **react-grid-layout layout state must be serialized carefully.** The `layout` array uses string keys. When saving to PostgreSQL, use JSONB. On restore, validate the keys match registered panel IDs before rendering to avoid crashes.

4. **Group comparison chart normalization.** When loading multi-ticker OHLC data, normalize each series: `normalizedClose = ((close - firstClose) / firstClose) * 100`. The first data point of each series must align to the same calendar date (some tickers may have different trading days — handle gaps with forward-fill).

5. **Finnhub free tier throttling.** 60 calls/min. With multiple panel types all calling Finnhub on ticker switch, you will hit limits fast. Implement a request queue (p-queue) with rate limiting in the Fastify service layer. Cache fundamentals aggressively (1-hour TTL in Redis).

6. **Clerk + Next.js 15 App Router.** Use `auth()` from `@clerk/nextjs/server` in Server Components; use `useAuth()` in Client Components. Protect all `/api/*` Fastify routes with Clerk JWT verification middleware.

7. **Panel linking via Zustand.** The `useTickerStore` must be a singleton (no context provider wrapping needed with Zustand). All panel components read from and write to the same store instance. This is what makes the "click ticker → everything updates" UX work.

8. **Ollama function-calling nuances.** gpt-oss:120b exposes an OpenAI-compatible `/v1/chat/completions` endpoint on port 11434 — you can point the OpenAI SDK at `OLLAMA_BASE_URL` and it just works. Two catches: (a) not every open-weights model handles `tool_choice: "required"` reliably — if you see the model narrate tool use instead of emitting a tool call, switch to `llama3-groq-tool-use:70b` which is fine-tuned for this. (b) First request after cold start can take 30–60s while Ollama loads the model into RAM — send a warm-up prompt at server boot.

9. **AI router escalation contract.** `services/aiRouter.ts` should return a discriminated union `{ source: "local" | "cloud", response: ... }` so the frontend can badge which model answered. Escalation triggers: (i) local returns an error, (ii) input token count > 96K, (iii) user prefix `!deep`. Keep the router logic dumb and observable — do not try to be clever about routing by query content in v1.

10. **Next.js 16 App Router quirk.** Server Actions default cache behavior changed in 16.0 — explicitly annotate cache semantics on any action that touches user-scoped data. See Next.js 16 upgrade notes before Phase 1.

---

## 9. Risks & Open Questions

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Real-time data cost (Massive Advanced tier) | **Resolved** | N/A | Delayed/EOD free tier confirmed for Phase 1; Finnhub free WebSocket provides partial real-time; upgrade is a one-config change |
| Yahoo Finance terms of service prohibit scraping AlphaSpace | N/A | N/A | Not scraping — using public APIs only; no data from Yahoo |
| Cloud AI costs spike | **Resolved / Low** | Low | Local Ollama is default path (zero cost). Cloud escalation is opt-in and gated; set Anthropic spend caps as belt-and-suspenders |
| Local model quality regressions on complex financial queries | Medium | Medium | Escalation to Sonnet 4.6 is the safety net. Benchmark local model on 20 representative queries during Phase 3; if pass rate < 80%, switch default to `llama3-groq-tool-use:70b` or bump escalation aggressiveness |
| Ollama cold-start latency (30–60s first request) | Medium | Low | Warm-up prompt at server boot; keep model resident via `OLLAMA_KEEP_ALIVE=-1` |
| A9 memory pressure with 120B model + Postgres + Redis + Node co-resident | Medium | Medium | **Memory budget:** ~80GB reserved for gpt-oss:120b weights + KV cache (native MXFP4), leaves ~48GB for Postgres, Redis, Node runtime, and OS. Comfortable but not infinite — monitor with `docker stats`. If pressure appears, first fallback is `gpt-oss:20b` (~12GB footprint, same family, same tool-calling contract); further fallbacks are `qwen3:32b` or `llama3-groq-tool-use:70b` |
| Massive.com rebrand / API deprecation | Low | Low | Rebrand from Polygon.io complete; API surface preserved. Monitor changelog |
| react-grid-layout layout persistence bugs (stale keys on panel add/remove) | Medium | Medium | Always generate UUID panel IDs; write integration tests for layout save/restore. Library is actively maintained (last commit Feb 2026) |
| Lightweight Charts 5.x API changes during development | Low | Low | Pin to 5.2.1; check changelog before upgrading |
| Clerk MRU limit (50K free) | **Resolved** | N/A | New Feb 2026 pricing lifts the ceiling far beyond expected self-hosted usage |
| OSS competitor category is now crowded (OpenTerminalUI, FinceptTerminal, FC Terminal) | Low | Low | None replicate the canvas + linking UX. Ship Phase 1 fast; don't let feature-list envy delay the walking skeleton |
| Yahoo AlphaSpace momentum (Scout AI now has GPT-6 Sol/Luna) | Medium | Low | This is a personal project + OSS release, not a Yahoo competitor. Do not chase Yahoo's feature list |

**Open questions — all resolved:**
1. ~~Single-user or multi-user?~~ → **Multi-user.** All workspace, watchlist, and alert rows carry `user_id` FK. Clerk handles auth + session; access control enforced at Fastify service layer.
2. ~~Delayed vs real-time?~~ → **Delayed free tier for Phase 1.** Polygon.io free (15-min delay) + Finnhub free WebSocket. Upgrade: swap `POLYGON_PLAN=advanced` env var + update WS subscription logic — no schema changes required.
3. ~~Pre-populate tickers?~~ → **AVGO, NVDA, MRVL, MU, VRTS.** Seed a "Semiconductors" starter workspace auto-created on first login for every new user.

---

## 10. Resources

| URL | Why It Matters |
|---|---|
| https://fortune.com/2026/05/19/exclusive-yahoo-finance-alphaspace-data-research-ai-portfolio-tracking-bloomberg-terminal/ | Fortune exclusive — full feature description, canvas/linking UX, Yahoo GM interview |
| https://www.yahooinc.com/press/introducing-alphaspace-by-yahoo-finance-a-professional-grade-investment-platform-built-for-everyday-investors | Official press release — feature list, pricing, AI layer description |
| https://massive.com | Primary market data API (ex-Polygon.io) — REST + WebSocket, US equities |
| https://massive.com/docs/rest/stocks/overview | Massive stocks REST API reference |
| https://massive.com/pricing | Tier pricing — verify Advanced (real-time) cost at signup |
| https://finnhub.io | Free-tier fundamentals, news, earnings, estimates |
| https://www.benzinga.com/apis/ | Premium news API — institutional grade |
| https://ollama.com/library/gpt-oss | Primary local model — OpenAI open-weights, 128K context, tool-use capable |
| https://ollama.com/library/qwen3 | Alt local model — top BFCL score (0.708) for pure tool-calling |
| https://ollama.com/library/llama3-groq-tool-use | Alt local model — 90.76% BFCL, tool-use-fine-tuned |
| https://docs.anthropic.com/en/docs/build-with-claude/tool-use | Anthropic function-calling docs — cloud escalation path |
| https://github.com/tradingview/lightweight-charts | TradingView Lightweight Charts source + docs (v5.2.1) |
| https://github.com/react-grid-layout/react-grid-layout | Drag-and-drop dashboard grid (Snyk "Sustainable" as of Sept 2026) |
| https://nextjs.org/blog/next-16 | Next.js 16 release notes — read before Phase 1 for App Router changes |
| https://www.koyfin.com | Closest feature competitor — benchmark the UX |
| https://clerk.com/docs | Clerk auth integration docs (50K MRU free tier as of Feb 2026) |
| https://clerk.com/pricing | Confirm current Clerk pricing at signup |
