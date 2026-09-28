# Tech Stack Research

## Real-Time Market Data APIs

### Polygon.io (WINNER for data layer)
- Free tier: 5 req/min, delayed data
- Real-time (Stocks Advanced): ~$199/mo
- WebSocket support for live tick data
- SIP timestamp, full US equities, options, forex, crypto
- Industry standard recommendation for retail-scale real-time workloads
- REST + WebSocket APIs
- Note: polygon.io redirects to massive.com (acquired)

### Alpaca
- Free tier: IEX data (partial volume)
- Real-time available
- Better for brokerage integration; less ideal for pure research
- Use as fallback or paper-trading supplement

### Finnhub
- Free tier: generous — 60 calls/min REST, WebSocket
- Covers: stocks, forex, crypto
- Company news, market news, earnings calendar, sentiment
- Fundamentals, estimates, filings
- Good option as secondary data source or for news/fundamentals

### Tradier
- Options-focused broker API
- Less relevant for pure research dashboard

## News APIs

### Finnhub (free, included above)
- Market news, company news by ticker
- Sentiment scoring
- ~60 calls/min free

### Benzinga
- Institutional-grade financial news
- Free tier via AWS Marketplace (headline + body)
- Paid plans for real-time premium news
- Good for premium news feed

### Marketaux
- 80+ markets, 5000+ sources
- Free tier available
- Good for global coverage

**Decision: Finnhub free tier for news + Benzinga for premium**

## Charting Library

### TradingView Lightweight Charts (WINNER)
- Open source (Apache 2.0)
- 45KB bundle
- HTML5 Canvas — high performance
- Candlestick, OHLC, Line, Area, Bar, Histogram, Baseline
- Designed specifically for financial data
- v5 in active development
- Perfect for multi-ticker comparison (add multiple series to one chart)
- Real-time updates via data streaming

### ApexCharts v5
- Good general-purpose library
- v5.10.1 with modular imports, TypeScript
- Less optimized for financial time-series than TW Lightweight Charts
- Better for fundamentals/comparison bar charts

**Decision: TradingView Lightweight Charts for price charts; ApexCharts for fundamentals/comparisons**

## Dashboard Layout

### react-grid-layout (WINNER)
- Most widely used draggable/resizable grid for React
- Responsive breakpoints
- Add/remove widgets without rebuilding grid
- Nested grids, auto-placement
- MIT license, active maintenance

### Golden Layout
- More complex tabbed/split panel system (Bloomberg-style)
- Better for true "terminal" feel but heavier
- Overkill for v1

### Gridstack.js
- Good alternative but less React-native

**Decision: react-grid-layout for v1; consider Golden Layout for v2 advanced mode**

## Frontend Framework
- **Next.js 15 + React 19 + TypeScript** — SSR for SEO on marketing pages, CSR for dashboard
- **Tailwind CSS** — utility-first, fast iteration
- **Shadcn/ui** — headless components, consistent design system
- **Zustand** — lightweight state management for panel linking / cross-panel ticker state
- **TanStack Query** — server state, auto-refetch for live data

## Backend
- **Node.js + Express** or **Fastify** — API server
  - WebSocket proxy for Polygon.io (avoid exposing API keys to client)
  - REST endpoints for fundamentals, news, user data
- **Python FastAPI** — optional second service for AI/ML tasks (sentiment, summaries)
- Prefer Node.js monolith with BullMQ workers for simplicity in v1

## Database
- **PostgreSQL** (via Supabase or self-hosted) — user accounts, saved workspaces, watchlists, alerts
- **Redis** — tick data cache, WebSocket fan-out, rate limit tracking

## Auth
- **Clerk** — fastest to integrate, handles JWT, social auth, session management
- Alternative: NextAuth.js (free, more control)

## AI Assistant
- **OpenAI GPT-4o** with function calling
  - Tool functions: get_quote, get_news, get_chart_data, build_view, compare_stocks
  - Streaming responses for chat-like UX
  - Alternatively: Claude Sonnet 4 via Anthropic API
- **LangChain.js** or direct OpenAI SDK — toolcalling orchestration
- System prompt gives the AI knowledge of available panels/widgets

## Hosting (Geekom A9, 128GB RAM)
- Self-hosted via Docker Compose
- Nginx reverse proxy
- Let's Encrypt SSL
- PM2 or Docker health checks
- Optional: Cloudflare Tunnel for remote access without port forwarding

## CI/CD
- GitHub Actions
- Self-hosted runner on Geekom A9
- Lint + test + build on PR, deploy to local Docker on merge to main
