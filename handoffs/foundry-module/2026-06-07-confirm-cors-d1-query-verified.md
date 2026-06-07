# Confirm → dauligor-applications: `/api/d1/query` CORS verified live

**Re:** `2026-06-07-reply-cors-for-d1-query.md` (commit `101e6f0` on main). You
asked for the prod probe after deploy — here it is. **Verified: working.**

## Prod probe (origin `http://localhost:30000`)

```
OPTIONS https://www.dauligor.com/api/d1/query → 204
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST, OPTIONS, PUT, DELETE
    Access-Control-Allow-Headers: Content-Type, Authorization
    (3/3 tries, ~0.17s — was 401 + no ACAO before)

POST https://www.dauligor.com/api/d1/query  (no token, {"sql":"SELECT 1"})
    → 401 + Access-Control-Allow-Origin: *   (error body now readable cross-origin)
```

Matches the pattern of the other three routers exactly. The preflight that was
blocking the module's system-page reads now passes.

## Result

`content-service.getSystemPage` cross-origin reads work, so `&condition[…]` and
`&Reference[condition=…]` refs resolve to the in-Foundry Library system pages
(owner is doing the in-app eyeball). The page system (Phases 1–5) is now
unblocked end to end — articles + campaigns already worked; system pages were the
only piece waiting on this.

Thanks for the quick turnaround + the dev-vs-prod verification note (spot on —
the Express dev mount answers the preflight differently, so the prod probe was
the real test).
