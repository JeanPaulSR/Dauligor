# Runtime Architecture

This doc explains where each piece of the application runs, how requests flow between them, and what runs differently in local dev versus production.

## The four runtimes

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Browser (Vite-built React SPA)                              │
│     - Calls /api/* on the same origin                           │
│     - Uses Firebase Auth SDK directly (JWT issuance)            │
│     - Calls D1 via /api/d1/query, R2 via /api/r2/*              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼  HTTP, Bearer <Firebase ID token>
┌─────────────────────────────────────────────────────────────────┐
│  2. Vercel functions (production) OR Express (local dev)        │
│     - api/_lib/firebase-admin.ts: verify JWT, check role        │
│     - api/_lib/d1-proxy.ts: forward queries to the Worker       │
│     - api/_lib/r2-proxy.ts: forward upload/list/etc to Worker   │
│     - Adds shared API_SECRET for the Worker → Bearer header     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼  HTTP, Bearer <API_SECRET>
┌─────────────────────────────────────────────────────────────────┐
│  3. Cloudflare Worker (worker/index.js)                         │
│     - Bindings: DB (D1), BUCKET (R2)                            │
│     - Endpoints: /upload, /list, /delete, /rename,              │
│                  /move-folder (R2), /query (D1)                 │
│     - No client-side state; pure stateless gateway              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼  D1 binding / R2 binding
┌─────────────────────────────────────────────────────────────────┐
│  4. Cloudflare D1 + R2 (data plane)                             │
│     - D1 (dauligor-db): SQL tables                              │
│     - R2 (dauligor-storage): binary objects                     │
└─────────────────────────────────────────────────────────────────┘
```

Authentication is handled by **Firebase**, but Firebase Authentication is only used as a JWT issuer. Firestore is being decommissioned. See [auth-firebase.md](auth-firebase.md).

## Local dev vs production

| Concern | Local dev | Production |
|---|---|---|
| App server | Express via `tsx watch server.ts` (port 3000) | Vercel functions |
| Vite dev | Express mounts Vite middleware | Static `dist/` served by Vercel |
| Worker | `wrangler dev` (port 8787) | Deployed Cloudflare Worker |
| D1 backing | Local SQLite under `worker/.wrangler/state/` | Remote D1 database |
| R2 backing | Local Wrangler R2 emulation | Real R2 bucket |
| Env vars | `.env`, `worker/.dev.vars` | Vercel env, Worker secrets |
| `R2_WORKER_URL` | `http://localhost:8787` | `https://dauligor-storage.<account>.workers.dev` |

The Express dev server in `server.ts` and the Vercel functions in `api/` share their proxy logic via `api/_lib/`. So the surface area is identical between dev and prod — local dev does **not** drift.

## Request flow examples

### a) Reading classes (via the legacy SQL proxy)

1. `ClassList.tsx` calls `fetchCollection('classes')` from `src/lib/d1.ts`.
2. `d1.ts` checks in-memory cache → sessionStorage cache → de-duplicates inflight → otherwise issues a `POST /api/d1/query` with the SQL.
3. The Express/Vercel handler `handleD1Query` verifies the Firebase JWT. The gate is split: writes/DDL go through `requireStaffAccess`, reads go through `requireAuthenticatedUser`. A `SELECT * FROM classes` read passes the latter for any signed-in user.
4. Proxy forwards to the Worker with the shared `API_SECRET`.
5. The Worker calls `env.DB.prepare(sql).bind(...params).all()`.
6. Result returns through the chain. `d1.ts` caches it and auto-parses JSON columns.

This path is the catch-all that still handles most compendium reads. The per-route endpoints below are the preferred shape for any new endpoint — the SQL stays server-side and the gate is tighter.

### b) Reading a character (per-route endpoint)

1. `CharacterBuilder.tsx` calls `fetch('/api/characters/' + id, { headers: { Authorization: 'Bearer <token>' } })`.
2. The Vercel function at [api/characters/[id].ts](../../api/characters/[id].ts) runs `requireCharacterAccess(authHeader, characterId)`, which:
   - Verifies the JWT.
   - SELECTs `user_id` from the `characters` row.
   - 404s (not 403) if the row doesn't exist OR the caller isn't the owner AND isn't a character-DM. Same shape on purpose so probes can't enumerate ids.
3. Handler runs the 8 `character_*` table queries in parallel, reshapes via `rebuildCharacterFromSql`, returns `{ character }`.
4. The client receives a fully-reconstructed character object — no client-side cross-table joining.

The PUT branch on the same endpoint handles both create (row doesn't exist yet — new character) and update (row exists — must be owner or DM). The DELETE branch lets the schema's FK cascade clear all `character_*` child rows in one shot. See [api-endpoints.md](api-endpoints.md) for the full per-route surface.

### c) Uploading an image

1. `ImageUpload` component converts the file to WebP (and to icon/token canvas size if applicable) via `src/lib/imageUtils.ts`.
2. Calls `r2Upload(file, key)` from `src/lib/r2.ts`. It POSTs `multipart/form-data` to `/api/r2/upload` with the user's Firebase JWT.
3. `handleR2Upload` (Vercel/Express) calls `requireImageManagerAccess(...)` then forwards the body to the Worker with the shared `API_SECRET`.
4. The Worker writes to R2 (`env.BUCKET.put`) and returns the public URL.
5. The client typically writes a metadata row through D1 (e.g., `image_metadata`) referencing the URL.

All five R2 actions (list / delete / rename / move-folder / upload) live in one dispatcher at [api/r2/[action].ts](../../api/r2/[action].ts) — consolidated from five separate functions to stay under the Vercel Hobby plan's 12-function deployment cap.

### d) Authenticating a user

1. Browser calls `signInWithEmailAndPassword(auth, usernameToEmail(username), pw)` from `src/lib/firebase.ts`.
2. Firebase Auth issues an ID token. The token is automatically attached to every D1 / R2 / per-route call as `Authorization: Bearer <id-token>`.
3. `App.tsx` calls `GET /api/me`, which verifies the token, auto-creates the `users` row on first sign-in, auto-promotes the bootstrap admins, and returns the profile. See [auth-firebase.md §2 Profile load](auth-firebase.md#2-profile-load) for the full sequence.

## Why one Worker, two bindings

Both D1 and R2 traffic go through the same `dauligor-storage` Worker. Reasons:

- **Single auth surface.** One shared `API_SECRET` between proxy and Worker. Every endpoint enforces the same `Bearer <secret>` check.
- **Lower cold-start surface.** One Worker, fewer separate KV / D1 / R2 contexts.
- **Local dev simplicity.** `wrangler dev` runs a single process for both bindings.

The Worker is intentionally stateless and trusts only the proxy-layer auth. **The Worker must never be exposed to the public internet without the API_SECRET wall** — the proxy layer enforces user-level auth before forwarding.

## Where each runtime's code lives

| Path | Runs on | Purpose |
|---|---|---|
| [src/](../../src/) | Browser | The React SPA |
| [api/](../../api/) | Vercel functions in prod / imported by Express in dev | Auth-checked proxies for D1, R2, admin actions, Foundry module endpoints |
| [api/_lib/](../../api/_lib/) | Both | Shared proxy logic and `firebase-admin` JWT verification |
| [server.ts](../../server.ts) | Local dev only | Express server that wires the same routes as Vercel + Vite middleware |
| [worker/](../../worker/) | Cloudflare Worker | The stateless gateway to D1 and R2 |
| [scripts/](../../scripts/) | Node CLI | Migration utilities (`migrate.js`, `check_firestore.js`) — never deployed |
| [worker/migrations/](../../worker/migrations/) | wrangler CLI | D1 schema migrations |

## Process boundaries / what runs where

- **Firebase Admin SDK** runs only on the proxy (Express / Vercel), never in the Worker. The Worker has no Firebase dependency.
- **Firestore client** is being decommissioned. Where it still appears, treat it as a temporary fallback. See [database/README.md](../database/README.md).
- **R2 operations** never touch the proxy's filesystem. Uploads stream from browser through the proxy to the Worker.

## Environment configuration

See [env-vars.md](env-vars.md) for the complete list of environment variables, where each one is read, and example values.

## Related docs

- [d1-architecture.md](d1-architecture.md) — D1 client API, cache layers, JSON columns
- [r2-storage.md](r2-storage.md) — R2 bucket structure, image handling
- [auth-firebase.md](auth-firebase.md) — Firebase Auth, JWT flow, server-side helpers
- [../operations/local-dev.md](../operations/local-dev.md) — practical setup for the two-terminal workflow
- [../operations/deployment.md](../operations/deployment.md) — deploying changes
