# Local Development

The Archive runs as **two parallel processes** locally: a Cloudflare Worker for D1+R2, and an Express dev server that wraps Vite.

## Prerequisites

- **Node.js** ≥ 20
- **npm** (lockfile is committed)
- A **Firebase service account JSON** inlined into your `.env` as
  `FIREBASE_SERVICE_ACCOUNT_JSON` (project owner provides the JSON).
  Required only if you exercise the admin user-management flows locally
  (create user / temp password / sign-in link) — JWT verification works
  without it.

## One-time setup

```bash
# from repo root
npm install

# from worker/ — run once if you don't have wrangler installed globally
# the project ships wrangler as a dev dependency; npx works
cd worker
npx wrangler login        # only the first time
```

### Required files

| File | Purpose |
|---|---|
| `.env` | Server env vars for the Express dev server, including the Firebase service account JSON for admin operations |
| `worker/.dev.vars` | Worker secrets for `wrangler dev` |

#### Sample `.env`
```
R2_WORKER_URL=http://localhost:8787
R2_API_SECRET=dauligor-asset-secret
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

The service account JSON drives admin user-management (`createUser` /
`updateUser` / temp-password / sign-in-link) which calls Firebase
Identity Toolkit REST under the hood. **JWT verification does NOT need
it** — verification runs against Firebase's public JWKS via `jose`, so
the rest of the app (lore, characters, compendium) works without a
service account configured. The admin routes return 503 with a
clear message if you hit them without it.

`GOOGLE_APPLICATION_CREDENTIALS` is no longer read — inline the JSON
into `FIREBASE_SERVICE_ACCOUNT_JSON` (one line, escape newlines as
`\n` in the `private_key` value).

#### Sample `worker/.dev.vars`
```
API_SECRET=dauligor-asset-secret
R2_PUBLIC_URL=https://images.dauligor.com
```

The two `*_SECRET` values must match. See [../platform/env-vars.md](../platform/env-vars.md) for the complete list.

### Bootstrap the local D1 database

If `worker/.wrangler/state/` doesn't already contain a populated database, apply the full migration chain locally and pull a snapshot of remote D1's data:

```bash
# 1. Apply the schema chain locally (skips the stillborn 0016).
cd worker
for f in migrations/0001_*.sql migrations/0002_*.sql migrations/0003_*.sql \
         migrations/0004_*.sql migrations/0005_*.sql migrations/0006_*.sql \
         migrations/0007_*.sql migrations/0008_*.sql migrations/0009_*.sql \
         migrations/0010_*.sql migrations/0011_*.sql migrations/0012_*.sql \
         migrations/0013_*.sql migrations/0014_*.sql migrations/0015_*.sql \
         migrations/0017_*.sql; do
  npx wrangler d1 execute dauligor-db --local --file="$f"
done

# 2. Snapshot remote → local so you have the same content as production.
npx wrangler d1 export dauligor-db --remote --output=./remote-dump.sql --no-schema
npx wrangler d1 execute dauligor-db --local --file=./remote-dump.sql
rm ./remote-dump.sql
cd ..
```

`scripts/_archive/migrate.js` is the historical Firestore→D1 importer; it is **not** part of the regular dev loop and should not be run today. Use the remote-snapshot pattern above to refresh local data instead.

## For Claude Code agents

**Don't ask the user to start any local servers.** When you need the app running, spawn both processes yourself via your Bash tool's `run_in_background` flag — they live for the rest of the conversation; the user never has to switch terminals.

The full bring-up sequence — run these only when something below isn't already up:

```bash
# 1. If worker/.wrangler/state/v3/d1 isn't populated, bootstrap local D1.
#    Snapshot remote into local (faster + dodges the d1_migrations
#    tracking gap that breaks `wrangler d1 migrations apply --local`):
cd worker
npx wrangler d1 export dauligor-db --remote --output=./remote-snapshot.sql
npx wrangler d1 execute dauligor-db --local --file=./remote-snapshot.sql
rm ./remote-snapshot.sql

# 2. Confirm .env points at localhost:
#       R2_WORKER_URL=http://localhost:8787
#    (Comment header in the file describes both modes; if it's still on
#    the deployed worker URL, swap it.) Make sure worker/.dev.vars has
#    the same API_SECRET value as .env's R2_API_SECRET — wrangler dev
#    reads .dev.vars; the Express server reads .env; they must agree
#    or the worker rejects every request with 401.

# 3. Start the worker (background, port 8787, miniflare local D1 binding):
cd worker && npx wrangler dev    # via run_in_background

# 4. Start the Express dev server (background, port 3000):
npm run dev                       # via run_in_background
```

Sanity check the stack with a known D1 query:

```bash
curl -s -X POST http://localhost:8787/query \
  -H "Authorization: Bearer <value from worker/.dev.vars API_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"sql":"SELECT COUNT(*) AS n FROM classes;"}'
```

A response with `"served_by":"miniflare.db"` confirms you're hitting the local sandbox, not prod. (`v3-prod` means a worker config or env var is sending you to remote — fix that before running anything else.)

### Restart-after-env-edit

`dotenv/config` reads `.env` once at process start. If you edit `.env` while `npm run dev` is already running, the cached value stays in memory. To pick up the new value, find the stale Express process and kill its tree, then restart in the background:

```bash
# Windows (Git Bash):
netstat -ano | grep ":3000.*LISTEN"
taskkill //F //T //PID <pid-from-above>

# macOS / Linux:
lsof -i :3000
kill -- -<pid>
```

Same logic for wrangler dev (port 8787) if you edit `worker/.dev.vars`.

### Killing the dev stack at end of session

If you started either server with `run_in_background`, you have a background-task ID — use that. Otherwise repeat the netstat / taskkill dance for both 3000 and 8787.

### Schema migrations during agent work

Apply locally first, **always**:

```bash
cd worker
npx wrangler d1 execute dauligor-db --local --file=migrations/<new>.sql
```

Verify the app boots against the new schema. Only after that do you ask the user "ok to apply to remote?" — the green light has to be in-conversation and migration-specific. Treat `--remote` as a one-way door (see `docs/operations/deployment.md`).

## Daily run

You need **two terminals**.

**Terminal 1 — Cloudflare Worker (D1 + R2):**
```bash
cd worker
npx wrangler dev
```

The Worker listens on `http://localhost:8787`. Leave this running.

**Terminal 2 — Vite + Express:**
```bash
npm run dev
```

The dev script is `tsx watch server.ts`, so the Express server reloads on backend file changes too. App is at `http://localhost:3000`.

### Sign-in for local dev

The bootstrap admin emails are:
- `admin@archive.internal`
- `gm@archive.internal`
- `luapnaej101@gmail.com` (project owner)

Log in with username `admin` (which maps to `admin@archive.internal` via `usernameToEmail`). The first sign-in auto-promotes the user to `admin` role in D1.

If those users don't exist in your local D1 yet, sign up via `/admin/users` once you've signed in as a hardcoded staff email — or seed them directly with a SQL `INSERT`.

## Verifying the local DB is wired up

Quick D1 sanity check from the project root:

```bash
cd worker
npx wrangler d1 execute dauligor-db --local --command "SELECT COUNT(*) FROM classes;"
npx wrangler d1 execute dauligor-db --local --command "SELECT name FROM sources LIMIT 5;"
```

If both work, your local D1 has data and the Worker can talk to it.

End-to-end check from the running app:
1. Open the network tab in DevTools.
2. Navigate to a page that reads classes (e.g., `/compendium`).
3. You should see `POST /api/d1/query` requests with `200 OK` responses.
4. Console should show `[D1] Successfully fetched N rows from classes`.

## Resetting the local DB

When iterating on schema, it's faster to nuke and re-apply than to write reversal migrations. The full procedure (including the gotcha that `9999_cleanup.sql` only drops Phase 1+2 tables and trips FK checks) lives in [../database/README.md#resetting-local-dev](../database/README.md#resetting-local-dev). The short version is:

```bash
# 1. Stop wrangler dev (it locks the sqlite file).
# 2. Delete the local D1 sqlite file under worker/.wrangler/state/v3/d1/...
# 3. Re-apply the migration chain (0001 → 0017, skipping 0016).
# 4. Optionally pull a fresh snapshot from remote.
```

**Local only.** Never run `9999_cleanup.sql` with `--remote`.

## Testing the Foundry pairing module locally

The module's importer can hit either the live Cloudflare Pages API (`https://www.dauligor.com/api/module/sources`) or the local Express server (`http://localhost:3000/api/module/sources`). Toggle via the **API Endpoint Mode** module setting in Foundry's *Configure Settings → Module Settings → Dauligor Pairing*.

For local testing:

1. Start the two dev terminals as above.
2. Make sure the Foundry module install at `<FoundryUserData>/Data/modules/dauligor-pairing/` is in sync with the repo's [module/dauligor-pairing/](../../module/dauligor-pairing/) — `scripts/main.js` and `module.json` are the files most likely to drift between repo edits and your install. (A symlink avoids manual syncing; on Windows requires Developer Mode or admin shell.)
3. Set the module's *API Endpoint Mode* setting to `local`.
4. Restart the Foundry world. The console should log `dauligor-pairing | Registered libWrapper for remote class/subclass image handling.` on init.
5. Open the importer (sidebar tools button or actor-sheet header) → pick a source → pick a class → import.

The local Express path uses `exportClassSemantic` from [src/lib/classExport.ts](../../src/lib/classExport.ts); production uses [api/_lib/_classExport.ts](../../api/_lib/_classExport.ts). Both must produce identical bundles — see the drift contract in [../architecture/foundry-integration.md §6](../architecture/foundry-integration.md#6-how-the-pipeline-is-wired-today).

## Common gotchas

### "503 — D1 proxy is not configured"
The Express server can't see `R2_WORKER_URL` or `R2_API_SECRET`. Confirm `.env` is present, restart the Express process, and confirm `R2_WORKER_URL=http://localhost:8787` (note the protocol).

### "401 — Unauthorized" from the Worker
The proxy and Worker secrets don't match. `.env`'s `R2_API_SECRET` must equal `worker/.dev.vars`'s `API_SECRET`. Restart both processes after editing.

### Worker won't start: "no D1 database bound"
Run from `worker/`, not from the repo root. The wrangler.toml is in that subdirectory.

### "Firebase service account is not configured" (503)
The admin user-management endpoints (`/api/admin/users/[id]/temporary-password`,
`/api/admin/users/[id]/sign-in-token`, `POST /api/admin/users` to
create) need `FIREBASE_SERVICE_ACCOUNT_JSON` in your `.env`. JWT
verification works without it (jose + JWKS), so login and read-only
admin pages still load; only operations that call Firebase Identity
Toolkit REST will 503. Paste the full JSON value (one line, escape
newlines in `private_key` as `\n`) and restart the Express server.

There is **no** signatureless-token fallback. The firebase-admin SDK
exit ([../../api/_lib/firebase-admin.ts](../../api/_lib/firebase-admin.ts))
removed it — every token now has its signature verified against
Firebase's public JWKS unconditionally.

### Newly added `/api/...` route returns 404
The Express server reloads on save (because of `tsx watch`), but if you added a route to a deeply-imported file the watcher might miss it. Stop and restart `npm run dev`.

### TipTap editor is empty after switching tabs
This was a real bug in `MarkdownEditor.tsx` early in the migration: `useEditor` initialised with the value at mount time, and the sync effect was gated incorrectly. If you see it again, check the `setContent({ emitUpdate: false })` call in [src/components/MarkdownEditor.tsx](../../src/components/MarkdownEditor.tsx).

### Foundation heartbeat seems stuck
The 30-second polling interval reads `system_metadata.last_foundation_update` with `noCache: true`. If your tabs aren't picking up cross-tab mutations, confirm the row exists:

```bash
cd worker
npx wrangler d1 execute dauligor-db --local --command "SELECT * FROM system_metadata WHERE key='last_foundation_update';"
```

If the row is missing, applying `0011_system_metadata.sql` will seed it.

## Useful supporting scripts

Active scripts in [scripts/](../../scripts/):

| Script | Purpose |
|---|---|
| `backup-d1.mjs` | D1 backup runner (`npm run backup:d1`). |
| `restore-d1.mjs` | D1 restore runner (`npm run restore:d1`). |
| `d1-timetravel.mjs` | D1 Time Travel diagnostic (`npm run timetravel`). |
| `_repro_progression_loop.mjs` | Headless regression harness for the character-builder normalize/build loop. Run with `npx tsx scripts/_repro_progression_loop.mjs`. |
| `install-nightly-backup.ps1` / `uninstall-nightly-backup.ps1` | Windows scheduled-task installer for nightly backups. |

The historical Firestore→D1 migration utilities and one-shot codemods live in [scripts/_archive/](../../scripts/_archive/) for reference. None of them are part of the dev loop; they're documented in [../../DIRECTORY_MAP.md §5a](../../DIRECTORY_MAP.md).

## Related docs

- [../platform/runtime.md](../platform/runtime.md) — what runs where
- [../platform/env-vars.md](../platform/env-vars.md) — every env var
- [../platform/auth-firebase.md](../platform/auth-firebase.md) — JWT flow and bootstrap accounts
- [../database/README.md](../database/README.md) — phase status, schema philosophy
- [troubleshooting.md](troubleshooting.md) — what to do when something breaks
- [deployment.md](deployment.md) — moving from local to remote safely
