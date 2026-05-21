# Environment Variables

Every env var the app reads, where it's read, what it's for, and a sample value. If you add a new env var, also update `.env.example`.

## Quick reference

| Variable | Where read | Required? | Local default |
|---|---|---|---|
| `R2_WORKER_URL` | Express dev + Cloudflare Pages Functions | yes | `http://localhost:8787` |
| `R2_API_SECRET` | Express dev + Cloudflare Pages Functions | yes | `dauligor-asset-secret` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Express dev + Cloudflare Pages Functions (Identity Toolkit REST for admin user-management) | required for admin ops; verification works without it | unset |
| `FIREBASE_PROJECT_ID` | `api/_lib/firebase-admin.ts` (used by JWKS verifier + REST base URL) | optional | `gen-lang-client-0493579997` |
| `NODE_ENV` | `server.ts` | optional | unset (dev) |
| `VITE_R2_WORKER_URL` | Browser bundle (legacy direct R2 path) | optional | unset |
| `VITE_R2_API_SECRET` | Browser bundle (legacy direct R2 path) | optional | unset |

Vite-prefixed vars (`VITE_*`) are exposed to the **browser** at build time. Everything else is server-only.

## Server (Express dev + Cloudflare Pages Functions)

Read from `.env` in dev (loaded by `dotenv/config` at the top of `server.ts`) and from the Cloudflare Pages project settings in prod.

### `R2_WORKER_URL`
The base URL the proxy forwards D1 and R2 requests to.
- **Local dev**: `http://localhost:8787` (the URL `wrangler dev` listens on).
- **Production**: the deployed Worker URL (e.g., `https://dauligor-storage.<account>.workers.dev`) or the custom domain it's bound to.

### `R2_API_SECRET`
The shared secret between the proxy and the Worker. The proxy adds `Authorization: Bearer <R2_API_SECRET>` to every Worker request, and the Worker rejects anything without a matching value.
- **Local dev**: `dauligor-asset-secret` (matches `worker/.dev.vars`).
- **Production**: a strong secret stored in both the Cloudflare Pages project env and the Worker secret store.

### `FIREBASE_SERVICE_ACCOUNT_JSON`
The full service-account JSON document, JSON-stringified (one line, with `\n` literal newlines inside `private_key`). Used to mint OAuth2 access tokens for Firebase Identity Toolkit REST calls (`/accounts`, `/accounts:update`, `/accounts:delete`) and to sign custom tokens for the sign-in-link recovery flow.

**Not needed for JWT verification.** `api/_lib/firebase-admin.ts` verifies ID tokens via Firebase's public JWKS endpoint (`jose.createRemoteJWKSet`), which has no credential dependency. Only the admin user-management endpoints (`createUser`, `updateUser`, `deleteUser`, `createCustomToken`) need the service account; they 503 with a clear message when it's missing.

`GOOGLE_APPLICATION_CREDENTIALS` is no longer read — that code path went away with the `firebase-admin` SDK exit in May 2026. Inline the JSON into `FIREBASE_SERVICE_ACCOUNT_JSON` instead.

### `FIREBASE_PROJECT_ID`
Override the Firebase project ID. Used as both the JWKS verifier's `audience` claim and the base path of every Identity Toolkit REST call. Defaults to `gen-lang-client-0493579997`.

### `NODE_ENV`
When `"production"`, `server.ts` serves the static `dist/` build. Otherwise it mounts Vite middleware for dev.

## Worker (`worker/.dev.vars` for local, Cloudflare secret store for prod)

The Worker reads two values from its env binding:

### `API_SECRET`
Must match the proxy's `R2_API_SECRET`. The Worker rejects any request without `Authorization: Bearer <API_SECRET>`.

### `R2_PUBLIC_URL`
The public-facing base URL where R2 objects are served. Returned to clients as the `url` field on upload responses.
- **Local dev / preview**: `https://images.dauligor.com` (still resolves to production CDN — local emulation reuses the production URL for image rendering).
- **Production**: `https://images.dauligor.com`.

The Worker also has bindings (declared in `worker/wrangler.toml`):
- `BUCKET` — R2 bucket binding (`dauligor-storage`).
- `DB` — D1 binding (`dauligor-db`, ID `25a9d61a-29ec-42c7-9dae-8cde8d88913d`).

## Browser (Vite)

`VITE_*` vars get baked into the bundle at build time. Avoid these for anything sensitive — they ship to every client.

### `VITE_R2_WORKER_URL` / `VITE_R2_API_SECRET`
Legacy direct browser-to-Worker R2 access. Should not be used in production — the secure path is via `/api/r2/*` proxies. Only kept for backwards compatibility while the migration finalises.

## Sample `.env` for local dev

```
R2_WORKER_URL=http://localhost:8787
R2_API_SECRET=dauligor-asset-secret
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...","client_email":"..."}
```

## Sample `worker/.dev.vars`

```
API_SECRET=dauligor-asset-secret
R2_PUBLIC_URL=https://images.dauligor.com
```

## What's NOT in env vars

- The Firebase **client** config (`firebase-applet-config.json`). It's a JSON file at the repo root because the Firebase Auth SDK consumes it directly. Anything in this file is publicly visible — it's just project IDs, not secrets.
- The D1 database ID and Worker name. Those are in [worker/wrangler.toml](../../worker/wrangler.toml) so wrangler can resolve them.

## Related docs

- [runtime.md](runtime.md) — request flow that uses these vars
- [d1-architecture.md](d1-architecture.md) — D1 client/proxy/worker chain
- [auth-firebase.md](auth-firebase.md) — Firebase Admin credential setup
- [../operations/local-dev.md](../operations/local-dev.md) — full local setup walk-through
