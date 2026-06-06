# Request → app team: CORS on `/api/auth`, `/api/lore`, `/api/campaigns` (Foundry module login)

**Ask:** add the same CORS wrapper `/api/module/*` already uses to **`/api/auth/*`**,
**`/api/lore/*`**, and **`/api/campaigns/*`** (including OPTIONS-preflight handling),
so the Foundry module can authenticate as a Dauligor user and load lore/campaign
content cross-origin.

`foundry-module` does not edit the app-side router / `functions/api/**` (your
domain) — this is a request. The module side (login client + `authFetch`) is
being built now; it's code-complete but **cannot function until this lands**.

## Why (what's blocked)

Roadmap: log into Foundry with a Dauligor account, then load the app's
references/articles/campaign pages inside Foundry. The module is a cross-origin
browser client (Foundry runs in Electron/Chromium; origin is `http://localhost:<port>`
in dev, the user's Foundry host in prod). It will:

- `POST /api/auth/login` `{username,password}` → read `{token, profile}` from the
  **response body** (the 30-day native session JWT) and store it client-side.
- `POST /api/auth/refresh` (`Authorization: Bearer <native JWT>`) → sliding renewal.
- `GET /api/lore/*` + `/api/campaigns/*` with `Authorization: Bearer <native JWT>`
  → load articles + campaign content for the page system.

**Verified on prod (2026-06-06):**
```
POST /api/auth/login  (bad creds, Origin: http://localhost:30000)
  → 401 application/json   — live + native auth configured
  → NO Access-Control-Allow-Origin   ← browser can't READ the response (or the token)
OPTIONS /api/auth/login  → 405 "Method OPTIONS not allowed."   ← JSON POST preflight fails
GET /api/lore/articles  (Origin: …)  → 401, NO Access-Control-Allow-Origin
```
A cross-origin JSON `POST` triggers a CORS preflight (OPTIONS) — currently 405 — and
even a successful response is unreadable without `Access-Control-Allow-Origin`. So
login itself fails cross-origin until CORS + OPTIONS exist on these routes.

## Requested change (mirror the existing `/api/module/*` CORS)

On `functions/api/auth/[[path]].ts`, `functions/api/lore/[[path]].ts`,
`functions/api/campaigns/[[path]].ts`:

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, POST, OPTIONS, PUT, DELETE`
- `Access-Control-Allow-Headers: Content-Type, Authorization`
- Short-circuit `OPTIONS` → `204` with the headers above (these routers currently
  405 unknown methods, which kills the preflight).

### `*` is safe here — the module uses Bearer tokens, NOT cookies

The module stores the native JWT from the login response **body** and sends it as
`Authorization: Bearer …`. No cookies → no credentialed CORS, so `Access-Control-Allow-Origin: *`
is fine (you can't combine `*` with credentials, but we don't use them). The
auth-gated routes stay protected by the token regardless of origin; `/api/auth/login`
is already unauthenticated/public. If you'd rather allow-list origins than use `*`,
note the Foundry origin varies per user (dev port, prod host, possibly `app://`) —
`*` is simplest, your call.

## Auth target (please confirm)

The module targets **native** auth (`POST /api/auth/login` → `{token, profile}`;
HS256 JWT via `AUTH_JWT_SECRET`; `requireAuthenticatedUser` accepts it as Bearer),
**not** Firebase. Please confirm `AUTH_JWT_SECRET` stays set on Pages prod and the
native login path is the one to build against (memory says Wave-1/Phase-4 is live;
Phase-5 Firebase removal parked). If the native login contract changes, ping here.

## Module follow-up (mine, on `foundry-module`)

- `auth-service.js`: login/logout, client-scoped token store, `authFetch` (Bearer +
  refresh-on-401), session status. Login dialog + launcher entry.
- The lore/campaign page viewer (roadmap #1) consumes the authed endpoints once
  this CORS lands — no further app-side endpoints needed (we read `/api/lore` +
  `/api/campaigns` directly with the token).
