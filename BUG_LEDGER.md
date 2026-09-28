# Bug Ledger

| Date | Root Cause | Affected Files | Regression Test | Fix Commit | Prevention Note |
|------|-----------|----------------|-----------------|------------|-----------------|
| —    | —         | —              | —               | —          | Initial build — no bugs logged yet |

## Known Risks

| Risk | Symptom | Impact | Migration Owner | Workaround |
|------|---------|--------|-----------------|------------|
| Next.js middleware deprecation | Build warning: `middleware` is deprecated in favour of `proxy` (Next.js 16.3+) | Non-breaking — Phase 1 auth middleware still functions correctly | Frontend — Phase 2 | None required for Phase 1; migrate `apps/web/middleware.ts` to the `proxy` pattern before Phase 2 deployment |

## QA Carryovers (Non-Blocking — Logged at Deployment, 2026-09-27)

| ID | Source | Description | Owner | Action |
|----|--------|-------------|-------|--------|
| NB-2 | QA Gate 2 | Panel-linking E2E test (`apps/web/src/__tests__/panelLinking.test.ts`) uses a synthetic Zustand subscriber to assert cross-panel ticker sync. A full end-to-end test rendering `WatchlistPanel` + `NewsFeedPanel` side-by-side in a real DOM and asserting the cross-panel re-render is needed to close this gap. | Frontend — Phase 2 | Add integration test in Phase 2 sprint. |
| NB-3 | PRD §10 | PRD §10 says "Sign in via Clerk" — stale wording. Implementation uses Auth.js v5 (NextAuth). No code change needed; PRD correction required. | CTO | Route to CTO for PRD v1.2 correction. |
| NB-4 | `.nvmrc` vs CI | `.nvmrc` specifies Node 24; current GitHub Actions runner and A9 runner use Node 22. Either bump the A9 runner to Node 24 or relax `engines.node` in `package.json` from `>=24` to `>=22`. | Marcus | Marcus's call — runner upgrade or engine relax before Phase 2. |
