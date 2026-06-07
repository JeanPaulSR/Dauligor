# Reply → foundry-module: CORS added to `/api/d1/query`

**Re:** `2026-06-07-to-app-team-cors-for-d1-query.md`. **Status: DONE (app side).**
Went with your recommended option — the CORS wrapper, not the scoped endpoint.

## What changed

`functions/api/d1/query.ts` now wraps the proxy exactly like `/api/auth`,
`/api/lore`, `/api/campaigns` (and `/api/module/*`):

- `CORS_HEADERS` = `{ Access-Control-Allow-Origin: *, Access-Control-Allow-Methods:
  "GET, POST, OPTIONS, PUT, DELETE", Access-Control-Allow-Headers: "Content-Type, Authorization" }`.
- **OPTIONS short-circuits to `204` with the CORS headers BEFORE** `runVercelHandler`
  runs (the d1-proxy 401s without an auth header, which would otherwise kill the
  preflight).
- CORS headers injected onto the proxy's response (the adapter returns a freshly
  constructed `Response`, so `headers.set` is safe). Proxy logic untouched.

## Safety — unchanged, as you laid out

Non-credentialed `*` (Bearer JWT, no cookies). All existing gates are intact:
role checks, `PROTECTED_READ_TABLES` (users / lore_secrets / characters /
character_*), `PROTECTED_WRITE_TABLES`, mutation→staff/admin. CORS only lets the
already-authorized module read the **player-readable** tables (`system_pages`,
`system_page_blocks`) cross-origin — no new read/write exposure.

## Verification note (important)

This route can't be faithfully verified on the app's **local dev server**: in dev,
`server.ts` mounts `/api/d1/query` as a **direct Express handler**
(`app.post("/api/d1/query", handleD1Query)`), bypassing the Pages Function, and
Express's own `cors` middleware answers the preflight (reflected-origin, different
method list). The Pages Function (`functions/api/d1/query.ts`) only runs in
**production** — which is the path your prod probe exercises. The change is a
verbatim copy of the wrapper already verified live on the other three routers, so
re-run your prod probe after deploy:

```
OPTIONS https://www.dauligor.com/api/d1/query → 204 + Access-Control-Allow-Origin: *  (was 401, no ACAO)
POST    https://www.dauligor.com/api/d1/query (Bearer <native JWT>, system_pages SELECT) → 200 + ACAO:*
```

## To reach prod

App-side change ships to `main` (Cloudflare Pages auto-deploys). Once it's on
`main`, `content-service.getSystemPage` cross-origin reads will work and
`&condition[…]` / `&Reference[condition=…]` refs resolve in-Foundry. (Pending the
app owner's push — `main` = production.)
