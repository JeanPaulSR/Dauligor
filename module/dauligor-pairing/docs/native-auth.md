# Native Account Auth

Each Foundry user logs into their **own** Dauligor account from inside Foundry.
The session authenticates every content read (articles, campaigns, system pages),
so the website serves role-appropriate content. Auth is **native** (a Dauligor
session JWT), not Firebase.

**Related docs**
- [`page-system.md`](page-system.md) — the content reads that authenticate through `authFetch`.
- [`ui-entry-points-and-visibility.md`](ui-entry-points-and-visibility.md) — where the login card / account dialog appear.

## Endpoints

| Call | Request | Response |
|---|---|---|
| `POST /api/auth/login` | `{ username, password }` | `{ token, profile }` |
| `POST /api/auth/refresh` | `Authorization: Bearer <token>` | `{ token }` (30-day sliding) |

`token` is a native HS256 session JWT. `requireAuthenticatedUser` accepts it as a
Bearer token on `/api/me`, `/api/lore`, `/api/campaigns`, `/api/d1/query`, etc.

## Session storage — per user, per device

`scripts/auth-service.js` stores the session in the **client-scoped** setting
`SETTINGS.session` (`"dauligor-session"`, `scope: "client"`, a JSON string).

The value is a **map keyed by Foundry user id**:

```json
{ "<foundryUserId>": { "token": "…", "profile": { "id", "username", "role", "display_name" } } }
```

`readSession()` returns the entry for the *current* `game.user.id`. This means:
- Each user on a shared client has their own login — never shared, never
  world-synced.
- It is per-device (client scope), so logging in on one browser doesn't log in
  another.

The legacy bare `{ token, profile }` shape (pre-per-user) is discarded on read.

Public API: `getSession()`, `getProfile()`, `isLoggedIn()`, `getDisplayName()`,
`login(username, password)`, `logout()`, `authFetch(path, opts)`, `resolveApiHost()`.

## `resolveApiHost()`

Returns the API base from the world setting `SETTINGS.apiEndpointMode`:
`"production"` → `https://www.dauligor.com`, otherwise `http://localhost:3000`.

## `authFetch(path, opts)` — the authed transport

`path` may be absolute or app-relative. `authFetch`:
1. Throws `"Not logged in."` if there is no session.
2. Sends the request with `Authorization: Bearer <token>` (no cookies).
3. On `401`, refreshes the token once and retries; if refresh fails, clears the
   session (forcing re-login).
4. Returns the `Response` (callers check `res.ok`).

All content reads go through `authFetch`, so server-side role filtering applies
uniformly.

## `fetchWithRetry` — transient-failure resilience

`login`, `refresh`, and `authFetch` route through `fetchWithRetry`, which retries
only **transient** outcomes — a thrown network error, or a `5xx` / `429` — with a
short linear backoff, and returns real answers (`2xx` / `4xx`, e.g. a `401` for
bad credentials) immediately.

This exists because **Cloudflare Pages Functions can cold-start**: the first hit
may hang or `5xx`, and the failed response drops its CORS headers, so the browser
reports a *misleading* "No `Access-Control-Allow-Origin`" error. A single retry
hits the now-warm function and succeeds. (Same class of issue as the
background-detail 503 the character creator retries around.)

## `authChanged` hook

`login()` and `logout()` fire `Hooks.callAll("dauligor-pairing.authChanged")`.
Open windows (the Library viewer, the launcher's account-label) listen and
re-render, so logging in turns a logged-out CTA into content without a manual
refresh.

## `requestLogin` hook

`main.js` registers `Hooks.on("dauligor-pairing.requestLogin", …)` →
`openDauligorAccountDialog()`. The viewer's logged-out CTA calls
`Hooks.callAll("dauligor-pairing.requestLogin")` instead of importing `main.js`,
avoiding a circular import.

## Login UI (defined in `main.js`)

- **Account dialog** (`openDauligorAccountDialog`) — a themed `DialogV2`: a
  username/password form when logged out; a status line + "Log out" when logged
  in. Reached from the launcher's "Log in to Dauligor" / "Account: <name>" tile.
- **Login chat card** — on the `ready` hook, if the user is logged out and no
  prior card exists, a **whispered** chat card nudges them to log in with a button
  that opens the account dialog. `postLoginChatCard` posts it (whispered to
  `game.user.id`, flagged `loginPrompt`); `hasLoginPromptCard` dedups across
  reloads; `registerLoginChatPrompt` binds the button via the v13
  `renderChatMessageHTML` hook (jQuery is gone — `html` is an `HTMLElement`).

## CORS requirements (app side)

The module is a cross-origin browser client (Foundry at `localhost:30000` →
`www.dauligor.com`), so every endpoint it calls must answer the CORS preflight.
The required wrapper (OPTIONS → `204` + CORS headers before auth; CORS headers on
every response) is **live on production** for:

- `/api/auth/*`, `/api/lore/*`, `/api/campaigns/*`
- `/api/d1/query` (needed for system-page reads)

`/api/module/*` (the public import catalogs) was already CORS-open.

**Why `*` is safe here:** the module sends the JWT as `Authorization: Bearer …`
with **no cookies**, so this is non-credentialed CORS — a hostile origin can't
read responses without a token, and a token holder already has API access
regardless of CORS. Each route's own gates (role checks, `PROTECTED_READ_TABLES`,
etc.) are unchanged; CORS only lets the already-authorized module read what it's
allowed to from a cross-origin context.

If a new module-consumed app route returns "No Access-Control-Allow-Origin",
first rule out a transient cold-start (retry); if it persists, that route needs
the CORS wrapper added app-side.
