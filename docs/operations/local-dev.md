# Local Development

The Archive runs as **two parallel processes** locally: a Cloudflare Worker for D1+R2, and an Express dev server that wraps Vite.

## Prerequisites

- **Node.js** ≥ 20
- **npm** (lockfile is committed)
- **`firebase-service-account.json`** at the repo root (project owner provides it)

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
| `.env` | Server env vars for the Express dev server |
| `worker/.dev.vars` | Worker secrets for `wrangler dev` |
| `firebase-service-account.json` | Admin SDK credential — used by Express + `scripts/migrate.js` |

#### Sample `.env`
```
R2_WORKER_URL=http://localhost:8787
R2_API_SECRET=dauligor-asset-secret
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

(or set `GOOGLE_APPLICATION_CREDENTIALS=/abs/path/to/firebase-service-account.json` instead)

#### Sample `worker/.dev.vars`
```
API_SECRET=dauligor-asset-secret
R2_PUBLIC_URL=https://images.dauligor.com
```

The two `*_SECRET` values must match. See [../platform/env-vars.md](../platform/env-vars.md) for the complete list.

### Bootstrap the local D1 database

If `worker/.wrangler/state/` doesn't already contain a populated database, run the schema migrations and copy live data into local D1:

```bash
cd worker
npx wrangler d1 execute dauligor-db --local --file=migrations/0001_phase1_foundation.sql
npx wrangler d1 execute dauligor-db --local --file=migrations/0002_phase2_identity.sql
npx wrangler d1 execute dauligor-db --local --file=migrations/0003_phase3_lore.sql
npx wrangler d1 execute dauligor-db --local --file=migrations/0004_items.sql
npx wrangler d1 execute dauligor-db --local --file=migrations/0005_feats.sql
npx wrangler d1 execute dauligor-db --local --file=migrations/0006_spells.sql
npx wrangler d1 execute dauligor-db --local --file=migrations/0007_features.sql
npx wrangler d1 execute dauligor-db --local --file=migrations/0008_classes.sql
npx wrangler d1 execute dauligor-db --local --file=migrations/0009_scalings.sql
npx wrangler d1 execute dauligor-db --local --file=migrations/0010_characters.sql
npx wrangler d1 execute dauligor-db --local --file=migrations/0011_system_metadata.sql

cd ..
node scripts/migrate.js
```

`migrate.js` reads from Firestore and writes to **local** D1 only. It is idempotent: re-running it overwrites the local rows but never touches Firestore.

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

When iterating on schema, it's faster to nuke and re-migrate than to write reversal migrations:

```bash
cd worker
npx wrangler d1 execute dauligor-db --local --file=migrations/9999_cleanup.sql
# then re-apply migrations 0001 through 0011
# then re-run node ../scripts/migrate.js from the project root
```

**Local only.** Never run `9999_cleanup.sql` with `--remote`.

## Common gotchas

### "503 — D1 proxy is not configured"
The Express server can't see `R2_WORKER_URL` or `R2_API_SECRET`. Confirm `.env` is present, restart the Express process, and confirm `R2_WORKER_URL=http://localhost:8787` (note the protocol).

### "401 — Unauthorized" from the Worker
The proxy and Worker secrets don't match. `.env`'s `R2_API_SECRET` must equal `worker/.dev.vars`'s `API_SECRET`. Restart both processes after editing.

### Worker won't start: "no D1 database bound"
Run from `worker/`, not from the repo root. The wrangler.toml is in that subdirectory.

### "Could not load the default credentials"
Either `FIREBASE_SERVICE_ACCOUNT_JSON` or `GOOGLE_APPLICATION_CREDENTIALS` must be set, and the credential must be valid for the configured project. The proxy has a signatureless-token fallback for local dev that grants admin — the warning in the console is expected behaviour. Production must always have a real service account.

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

In [scripts/](../../scripts/):

| Script | Purpose |
|---|---|
| `migrate.js` | Firestore → local D1 (Phase 1–4 data) |
| `migrate_subclasses.js` | Targeted migration for a subset of subclass docs |
| `check_firestore.js` | Counts documents in selected Firestore collections — useful as a pre-migration sanity check |

All scripts use `firebase-service-account.json` at the repo root.

## Related docs

- [../platform/runtime.md](../platform/runtime.md) — what runs where
- [../platform/env-vars.md](../platform/env-vars.md) — every env var
- [../platform/auth-firebase.md](../platform/auth-firebase.md) — JWT flow and bootstrap accounts
- [../database/README.md](../database/README.md) — phase status, schema philosophy
- [troubleshooting.md](troubleshooting.md) — what to do when something breaks
- [deployment.md](deployment.md) — moving from local to remote safely
