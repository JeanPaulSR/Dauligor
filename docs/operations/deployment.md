# Deployment

The app deploys to **Vercel** (frontend + functions) and **Cloudflare** (Worker + D1 + R2). They deploy on independent cycles. There is no single "ship it" button — you trigger each side intentionally.

## Production layout

| Component | Where | How updated |
|---|---|---|
| Frontend SPA | Vercel | Auto-deploys on push to `main` (Vercel Git integration) |
| Vercel functions (`api/*`) | Vercel | Same auto-deploy as the SPA |
| Cloudflare Worker | Cloudflare | Manual `wrangler deploy` from `worker/` |
| D1 schema | Cloudflare D1 | Manual `wrangler d1 execute … --remote` |
| R2 bucket | Cloudflare R2 | Created once; objects are mutated by the Worker |
| Firebase Auth | Google | No deploy step — config lives in `firebase-applet-config.json` |

## The migration freeze rule

While the Firestore → D1 migration is in progress, **do not push to `main`**. Vercel auto-deploys on push and would publish an unfinished migration to production users.

The rollback reference is `E:\DnD\Professional\Dev\Pre-Update\Dauligor-main` — a snapshot of the working Firestore-era code. If a deploy breaks production, that's the recovery point.

The freeze ends when the [punchlist in docs/database/README.md](../database/README.md#remaining-firestore-cut-punchlist) is empty AND the app has been validated end-to-end against local D1.

## Frontend + Vercel functions

Once the freeze lifts, deploys are straightforward:

1. `git push origin main` (or merge a PR into `main`).
2. Vercel rebuilds and ships within a few minutes.
3. Watch Vercel's deploy logs for build errors.

Required Vercel env vars (set in the project settings, **not** in source):

- `R2_WORKER_URL` — `https://dauligor-storage.<account>.workers.dev` (or custom domain)
- `R2_API_SECRET` — must match the Worker's `API_SECRET`
- `FIREBASE_SERVICE_ACCOUNT_JSON` — service-account JSON, all on one line
- `FIREBASE_PROJECT_ID`, `FIRESTORE_DATABASE_ID` — only if overriding defaults

## Cloudflare Worker

The Worker is the gateway to D1 and R2. Deploy it whenever you change [worker/index.js](../../worker/index.js) or [worker/wrangler.toml](../../worker/wrangler.toml).

```bash
cd worker
npx wrangler deploy
```

First-time setup of secrets:

```bash
npx wrangler secret put API_SECRET
# paste the production secret value when prompted
```

`R2_PUBLIC_URL` is in `[vars]` in `wrangler.toml` (not a secret) and will deploy with the Worker.

Bindings (`BUCKET` for R2, `DB` for D1) are also defined in `wrangler.toml` and applied on deploy.

## D1 schema migrations

**Always run `--local` first**, validate the app against local D1, then run `--remote`.

```bash
# After validating locally:
cd worker
npx wrangler d1 execute dauligor-db --remote --file=migrations/00NN_*.sql
```

Once a migration has been applied to remote D1, it cannot be cleanly reversed without writing a counter-migration. Treat `--remote` as a one-way door.

### Migrating data from Firestore to remote D1

`scripts/migrate.js` writes to local D1 by default. To target remote, edit the `executeBatch` call to drop the `--local` flag — but only do this once for each table, after the schema is finalised. The migration is non-destructive (Firestore is unchanged), but re-running it on remote with a different schema can leave inconsistent rows.

## R2 bucket

The bucket exists once, in production. `worker/wrangler.toml` references it by name (`dauligor-storage`). Don't recreate or rename — that breaks every public image URL.

If you ever need to reorganise the bucket, do it via the Worker's `/move-folder` endpoint (called from the Image Manager UI). Direct R2 console operations bypass the metadata sync that `imageMetadata` depends on.

## Order of operations for a complete deploy

When you eventually ship the migration, the safe sequence is:

1. **Confirm punchlist is empty** — every Firestore touchpoint is gone or behind a `firebaseFallback: null`.
2. **Local validation** — every editor and read path works against local D1.
3. **Apply remote D1 migrations** in order.
4. **Run `migrate.js` against remote** to copy live Firestore data into remote D1.
5. **Deploy the Worker** (`wrangler deploy`).
6. **Push to `main`** — Vercel deploys the new app.
7. **Verify production** — sign in, exercise critical paths.
8. **Don't delete Firestore yet.** Leave it as a read-only fallback for at least a few days.
9. **After a soak period** with no issues: delete `firestore.rules`, `firebase.json`, `firebase-blueprint.json`, `storage.rules`, the `firebase/firestore` import from `src/lib/firebase.ts`, and the legacy `migration-firebase-side/` reference folder.

## Rolling back

The intended rollback is **branch-level**, not table-level:

- If a deploy fails, revert the merge commit on `main`. Vercel auto-deploys the revert.
- If D1 is corrupt, the local D1 + the Pre-Update reference are both still intact.
- If R2 is unaffected by the deploy, no R2 rollback is needed.

Per-row data loss in D1 is recoverable from the Firestore copy (during the migration window) by re-running `migrate.js`.

## Pre-deploy checklist

For each deploy that touches the migration:

- [ ] Punchlist updated and empty (or this deploy is a non-migration change)
- [ ] All `firebaseFallback` calls reviewed for the affected feature
- [ ] Local D1 has the latest migration applied
- [ ] Local app exercises the affected feature without errors
- [ ] Network tab shows `/api/d1/query` calls returning `200`, no `503` or `401`
- [ ] `[D1]` console logs show successful reads/mutations
- [ ] Vercel env vars present and correct (`R2_WORKER_URL` points to **prod** Worker)
- [ ] Worker is on the latest version (`npx wrangler deploy`)
- [ ] D1 remote has the same schema state as local
- [ ] Production smoke test: sign in, view a class, edit a lore article, upload an image

## Related docs

- [local-dev.md](local-dev.md) — local setup, two-terminal workflow
- [troubleshooting.md](troubleshooting.md) — recovery from deploy mishaps
- [../platform/env-vars.md](../platform/env-vars.md) — every env var, prod-vs-dev values
- [../database/README.md](../database/README.md) — punchlist and phase status
