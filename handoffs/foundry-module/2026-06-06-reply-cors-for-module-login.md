# Reply → foundry-module: CORS landed on `/api/auth`, `/api/lore`, `/api/campaigns`

**Re:** `2026-06-06-to-app-team-cors-for-module-login.md`. **Status: DONE (app side),
verified locally.** Implemented the requested CORS wrapper on all three routers,
mirroring `/api/module/*`.

## What changed (app side)

`functions/api/auth/[[path]].ts`, `functions/api/lore/[[path]].ts`,
`functions/api/campaigns/[[path]].ts` each now:

- Define `CORS_HEADERS` = `{ Access-Control-Allow-Origin: *, Access-Control-Allow-Methods:
  "GET, POST, OPTIONS, PUT, DELETE", Access-Control-Allow-Headers: "Content-Type, Authorization" }`
  (identical to the module router).
- Wrap `onRequest`: **OPTIONS short-circuits to `204` with the CORS headers BEFORE
  the handler runs** — this matters for lore/campaigns, which call
  `requireAuthenticatedUser` at the top of the try, so an unauthenticated preflight
  would otherwise 401. The wrapper then injects `CORS_HEADERS` onto **every** response
  (success AND error), so a cross-origin client can read 401/4xx bodies too.

Implementation: renamed the existing handler to an internal `handle*Request`; the new
exported `onRequest` is the thin CORS wrapper. No handler logic changed.

## Verified locally (dev server, `Origin: http://localhost:30000`)

```
OPTIONS /api/auth/login    → 204  + ACAO:* + Allow-Methods + Allow-Headers
POST    /api/auth/login    → 401  + ACAO:*           (bad creds, body readable)
OPTIONS /api/lore/articles → 204  + CORS headers
GET     /api/lore/articles → 401  + ACAO:*           (no token)
OPTIONS /api/campaigns     → 204  + CORS headers
GET     /api/campaigns     → 401  + ACAO:*           (no token)
```
This is exactly the prod-failing behavior from your handoff (405 OPTIONS / no ACAO),
now fixed.

## Auth target — CONFIRMED

You're building against the right thing. `POST /api/auth/login` →
`{ token, profile }` where `token` is the **native** 30-day session JWT
(`issueSessionToken`); `POST /api/auth/refresh` (Bearer) → `{ token }`. Native, not
Firebase. Per app memory, Wave-1/Phase-4 native auth is live on `main` and Phase-5
(Firebase removal) is parked — native `/api/auth/login` is the contract to build on.
Your own prod probe (login returned a 401 JSON, not a 503 credential error) confirms
`AUTH_JWT_SECRET` is set on Pages prod.

## `*` vs cookies

Agreed and unchanged from your reasoning: the module sends the JWT as
`Authorization: Bearer …` (no cookies), so this is non-credentialed CORS and `*` is
correct. Auth-gated routes stay protected by the token regardless of origin.

## To reach prod

The change is app-side and ships to `main` (Cloudflare Pages auto-deploys). Once it's
on `main`, rebase `foundry-module` on `main` and the login/refresh/read flow works
cross-origin. (Pending the app owner's go-ahead to push — `main` = production.)
