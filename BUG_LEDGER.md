# Bug Ledger

| Date | Root Cause | Affected Files | Regression Test | Fix Commit | Prevention Note |
|------|-----------|----------------|-----------------|------------|-----------------|
| —    | —         | —              | —               | —          | Initial build — no bugs logged yet |

## Known Risks

| Risk | Symptom | Impact | Migration Owner | Workaround |
|------|---------|--------|-----------------|------------|
| Next.js middleware deprecation | Build warning: `middleware` is deprecated in favour of `proxy` (Next.js 16.3+) | Non-breaking — Phase 1 auth middleware still functions correctly | Frontend — Phase 2 | None required for Phase 1; migrate `apps/web/middleware.ts` to the `proxy` pattern before Phase 2 deployment |
