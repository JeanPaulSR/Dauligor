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

## Frontend + Vercel functions

`git push origin main` (or merge a PR into `main`) triggers an auto-deploy. Vercel rebuilds and ships within a few minutes; watch the deploy logs for build errors.

Required Vercel env vars (set in the project settings, **not** in source):

- `R2_WORKER_URL` — `https://dauligor-storage.<account>.workers.dev` (or a custom domain)
- `R2_API_SECRET` — must match the Worker's `API_SECRET`
- `FIREBASE_SERVICE_ACCOUNT_JSON` — service-account JSON, all on one line. Required by the admin endpoints in `api/admin/*` and the JWT verifier in `api/_lib/firebase-admin.ts`. (See [memory: Firebase Auth exit plan](#) for the queued JWKS-based replacement that drops this dependency.)

### Vercel cross-folder bundling caveat

Vercel's serverless bundler in this project does **not** reliably traverse cross-folder imports from `api/` into `src/lib/`. Two attempts at `import { exportClassSemantic } from "../src/lib/classExport.js"` from `api/module.ts` crashed the function on load with `FUNCTION_INVOCATION_FAILED`. Workaround: keep server-only deps in `api/_lib/` as siblings (e.g. `api/_lib/_classExport.ts` mirrors `src/lib/classExport.ts`). Anything imported by a Vercel function should already live under `api/`.

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

`R2_PUBLIC_URL` is in `[vars]` in `wrangler.toml` (not a secret) and ships with the Worker.

Bindings (`BUCKET` for R2, `DB` for D1) are also defined in `wrangler.toml` and applied on deploy.

## D1 schema migrations

**Always run `--local` first**, validate the app against local D1, then run `--remote`.

```bash
# After validating locally:
cd worker
npx wrangler d1 execute dauligor-db --remote --file=migrations/00NN_*.sql
```

Once a migration has been applied to remote D1, it cannot be cleanly reversed without writing a counter-migration. Treat `--remote` as a one-way door.

### Bulk data ops (rare)

If you ever need to copy local D1 → remote (e.g. after rebuilding local from scratch and wanting remote to match):

```bash
cd worker
npx wrangler d1 export dauligor-db --local --output=./local-dump.sql --no-schema
# Wipe rows you want to overwrite, then:
npx wrangler d1 execute dauligor-db --remote --file=./local-dump.sql
rm ./local-dump.sql
```

Don't commit dumps; they're in `.gitignore` (`worker/*-dump.sql`).

## R2 bucket

The bucket exists once, in production. `worker/wrangler.toml` references it by name (`dauligor-storage`). Don't recreate or rename — that breaks every public image URL.

If you ever need to reorganise the bucket, do it via the Worker's `/move-folder` endpoint (called from the Image Manager UI). Direct R2 console operations bypass the metadata sync that `imageMetadata` depends on.

## Rolling back

The intended rollback is **branch-level**:

- If a deploy fails, revert the offending commit on `main`. Vercel auto-deploys the revert.
- If a Worker deploy regresses behaviour, redeploy the prior commit's `worker/index.js` (`git checkout <hash> -- worker/index.js && cd worker && npx wrangler deploy`).
- If a remote D1 migration introduced a bad column, write a counter-migration that drops/renames it. SQLite has limited `ALTER TABLE` support; sometimes the cleanest path is a follow-up migration that creates a new table, copies rows, drops the old, and renames.

## Pre-deploy checklist

- [ ] `npm run build` clean locally
- [ ] `npx tsc --noEmit` count is at the documented baseline (or lower)
- [ ] If a D1 migration is part of the change: `--local` applied + tested before `--remote`
- [ ] If `worker/index.js` changed: `wrangler deploy` ready to run
- [ ] If the export shape changed: both `src/lib/classExport.ts` AND `api/_lib/_classExport.ts` updated together (drift contract — see [../architecture/foundry-integration.md §6](../architecture/foundry-integration.md#6-how-the-pipeline-is-wired-today))
- [ ] Vercel env vars confirmed (`R2_WORKER_URL` points to the **prod** Worker)
- [ ] Production smoke test: sign in, view a class, edit a lore article, upload an image

## Related docs

- [local-dev.md](local-dev.md) — local setup, two-terminal workflow
- [troubleshooting.md](troubleshooting.md) — recovery from deploy mishaps
- [../platform/env-vars.md](../platform/env-vars.md) — every env var, prod-vs-dev values
- [../database/README.md](../database/README.md) — schema philosophy and migration index
- [../architecture/foundry-integration.md](../architecture/foundry-integration.md) — Foundry export pipeline + drift contract
